import { PrismaClient } from '@prisma/client';
import * as argon2 from 'argon2';

const prisma = new PrismaClient();

async function main() {
  console.log('Seeding...');

  const seedPasswordHash = await argon2.hash('SeedPassword123!', {
    type: argon2.argon2id,
  });

  // User accounts are always upserted — independent of everything below —
  // so re-running this script on an already-seeded database never skips
  // creating login-ready accounts.
  const admin = await prisma.user.upsert({
    where: { email: 'admin@example.com' },
    update: { passwordHash: seedPasswordHash, passwordSetAt: new Date() },
    create: {
      email: 'admin@example.com',
      passwordHash: seedPasswordHash,
      passwordSetAt: new Date(),
      role: 'ADMIN',
      fullName: 'Sample Admin',
    },
  });

  const organizerUser = await prisma.user.upsert({
    where: { email: 'organizer@example.com' },
    update: { passwordHash: seedPasswordHash, passwordSetAt: new Date() },
    create: {
      email: 'organizer@example.com',
      passwordHash: seedPasswordHash,
      passwordSetAt: new Date(),
      role: 'ORGANIZER',
      fullName: 'Sample Organizer',
    },
  });

  const organizer = await prisma.organizer.upsert({
    where: { userId: organizerUser.id },
    update: {},
    create: {
      userId: organizerUser.id,
      businessName: 'Sample Events Ltd',
      slug: 'sample-events-ltd', // public profile at /o/sample-events-ltd (docs/organizer-profiles.md)
      bio: 'Concerts, comedy nights and festivals across the Greater Banjul Area since 2019.',
      location: 'Serrekunda',
      verificationStatus: 'APPROVED',
      trustLevel: 'TRUSTED', // docs/organizer-trust.md: the sample organizer has every permission
    },
  });

  const customer = await prisma.user.upsert({
    where: { email: 'customer@example.com' },
    update: { passwordHash: seedPasswordHash, passwordSetAt: new Date() },
    create: {
      email: 'customer@example.com',
      passwordHash: seedPasswordHash,
      passwordSetAt: new Date(),
      role: 'CUSTOMER',
      fullName: 'Sample Customer',
    },
  });

  // Phase 7: a STAFF account for testing POST /check-ins. Phase 9: it
  // belongs to the seeded organizer (staffOrganizerId), so that organizer
  // can assign it to events from the dashboard. Check-in itself still
  // lets any STAFF scan any event until Phase 10 enforces assignments.
  const staff = await prisma.user.upsert({
    where: { email: 'staff@example.com' },
    update: { passwordHash: seedPasswordHash, passwordSetAt: new Date(), staffOrganizerId: organizer.id },
    create: {
      email: 'staff@example.com',
      passwordHash: seedPasswordHash,
      passwordSetAt: new Date(),
      role: 'STAFF',
      fullName: 'Sample Gate Staff',
      staffOrganizerId: organizer.id,
    },
  });

  console.log('Seeded accounts (password for all four: SeedPassword123!):', {
    admin: admin.email,
    organizer: organizerUser.email,
    customer: customer.email,
    staff: staff.email,
  });

  // Categories are upserted by slug — always safe to re-run.
  const categoryDefs = [
    { name: 'Concerts', slug: 'concerts' },
    { name: 'Movies', slug: 'movies' },
    { name: 'Football', slug: 'football' },
    { name: 'Festivals', slug: 'festivals' },
    { name: 'Comedy Shows', slug: 'comedy-shows' },
    { name: 'Theatre', slug: 'theatre' },
    { name: 'Conferences', slug: 'conferences' },
  ];
  const categories: Record<string, Awaited<ReturnType<typeof prisma.eventCategory.upsert>>> = {};
  for (const c of categoryDefs) {
    categories[c.slug] = await prisma.eventCategory.upsert({
      where: { slug: c.slug },
      update: {},
      create: c,
    });
  }

  // Venue has no natural unique key in the schema (by design — two venues
  // could share a name), so idempotency here is done with an explicit
  // find-by-name-and-city check rather than `upsert`. Everything that
  // hangs off the venue (section, seats, gate, zone) is only created the
  // first time, alongside it.
  let venue = await prisma.venue.findFirst({
    where: { name: 'Independence Stadium', city: 'Banjul' },
  });
  let mainZone;

  if (venue) {
    mainZone = await prisma.accessZone.findFirst({
      where: { venueId: venue.id, name: 'Main' },
    });
    console.log('Venue already exists — reusing it instead of creating a duplicate.');
  } else {
    venue = await prisma.venue.create({
      data: {
        name: 'Independence Stadium',
        address: 'Bakau',
        city: 'Banjul',
        country: 'The Gambia',
      },
    });

    const section = await prisma.venueSection.create({
      data: { venueId: venue.id, name: 'Lower Bowl', isVip: false },
    });

    // A handful of seats to prove the seat/section relationship and the
    // (sectionId, row, number) uniqueness constraint.
    await prisma.seat.createMany({
      data: Array.from({ length: 5 }, (_, i) => ({
        sectionId: section.id,
        row: 'A',
        number: String(i + 1),
        place: i + 1,
      })),
    });

    await prisma.gate.create({
      data: { venueId: venue.id, name: 'Gate 1' },
    });

    mainZone = await prisma.accessZone.create({
      data: { venueId: venue.id, name: 'Main', level: 0 },
    });
  }

  if (!mainZone) {
    throw new Error(
      'Venue existed but its "Main" access zone did not — inconsistent seed state, please investigate manually.',
    );
  }

  // Each sample event is checked and created independently, so a database
  // that already has some of these (from an earlier phase's seed run)
  // still ends up with all of them after re-seeding, rather than the
  // whole block being skipped because just one already existed.

  let event = await prisma.event.findUnique({ where: { slug: 'sample-concert-night' } });
  if (!event) {
    event = await prisma.event.create({
      data: {
        organizerId: organizer.id,
        categoryId: categories['concerts'].id,
        venueId: venue.id,
        name: 'Sample Concert Night',
        slug: 'sample-concert-night',
        description: 'A seeded event for Phase 2 testing.',
        startDate: new Date('2026-12-01T20:00:00Z'),
        endDate: new Date('2026-12-01T23:59:00Z'),
        status: 'PUBLISHED',
      },
    });

    const ticketType = await prisma.ticketType.create({
      data: {
        eventId: event.id,
        name: 'General Admission',
        category: 'GENERAL_ADMISSION',
        price: 100000, // D1,000.00 in butut
        currency: 'GMD',
        quantityTotal: 500,
        accessZoneId: mainZone.id,
      },
    });

    await prisma.ticketOrder.create({
      data: {
        customerId: customer.id,
        eventId: event.id,
        subtotal: 100000,
        platformFee: 5000,
        total: 105000,
        currency: 'GMD',
        status: 'PENDING',
        items: {
          create: [{ ticketTypeId: ticketType.id, quantity: 1, unitPrice: 100000 }],
        },
      },
    });
  }

  let comedyEvent = await prisma.event.findUnique({ where: { slug: 'sample-comedy-night' } });
  if (!comedyEvent) {
    comedyEvent = await prisma.event.create({
      data: {
        organizerId: organizer.id,
        categoryId: categories['comedy-shows'].id,
        venueId: venue.id,
        name: 'Sample Comedy Night',
        slug: 'sample-comedy-night',
        description: 'A seeded comedy event for Phase 4 filter testing.',
        startDate: new Date('2026-12-15T20:00:00Z'),
        endDate: new Date('2026-12-15T22:30:00Z'),
        status: 'PUBLISHED',
      },
    });
  }

  // A ticket type with a deliberately tiny quantity, so Phase 5's
  // "sold-out ticket cannot be purchased" test doesn't require buying
  // hundreds of tickets first to trigger it.
  let limitedTicketType = await prisma.ticketType.findFirst({
    where: { eventId: comedyEvent.id, name: 'Front Row (Limited)' },
  });
  if (!limitedTicketType) {
    limitedTicketType = await prisma.ticketType.create({
      data: {
        eventId: comedyEvent.id,
        name: 'Front Row (Limited)',
        category: 'VIP',
        price: 50000, // D500.00
        currency: 'GMD',
        quantityTotal: 2,
      },
    });
  }

  // A DRAFT event — never returned by the public search/list endpoint,
  // and only visible via GET /events/:id to its owning organizer or an
  // admin. Exists specifically so Phase 4's visibility rules have a
  // negative case to test, not just a positive one.
  let draftEvent = await prisma.event.findUnique({ where: { slug: 'draft-tech-conference' } });
  if (!draftEvent) {
    draftEvent = await prisma.event.create({
      data: {
        organizerId: organizer.id,
        categoryId: categories['conferences'].id,
        venueId: venue.id,
        name: 'Draft Tech Conference',
        slug: 'draft-tech-conference',
        description: 'A seeded DRAFT event — should never appear in public search.',
        startDate: new Date('2027-02-01T09:00:00Z'),
        endDate: new Date('2027-02-01T17:00:00Z'),
        status: 'DRAFT',
      },
    });
  }

  // ---------- Phase 8: reserved seating ----------
  //
  // Everything below is find-or-create (and seats use skipDuplicates on
  // the (sectionId, row, number) unique key), so it runs cleanly on a
  // database seeded by any earlier phase as well as on a fresh one.

  const lowerBowl = await prisma.venueSection.findFirst({
    where: { venueId: venue.id, name: 'Lower Bowl' },
  });
  if (!lowerBowl) {
    throw new Error('Venue has no "Lower Bowl" section — inconsistent seed state.');
  }
  // Grow the Phase 2 section (row A, seats 1–5) into rows A–C × 8 seats.
  await prisma.seat.createMany({
    data: ['A', 'B', 'C'].flatMap((row) =>
      Array.from({ length: 8 }, (_, i) => ({ sectionId: lowerBowl.id, row, number: String(i + 1), place: i + 1 })),
    ),
    skipDuplicates: true,
  });

  let vipZone = await prisma.accessZone.findFirst({ where: { venueId: venue.id, name: 'VIP' } });
  if (!vipZone) {
    vipZone = await prisma.accessZone.create({ data: { venueId: venue.id, name: 'VIP', level: 10 } });
  }

  let vipBox = await prisma.venueSection.findFirst({ where: { venueId: venue.id, name: 'VIP Box' } });
  if (!vipBox) {
    vipBox = await prisma.venueSection.create({ data: { venueId: venue.id, name: 'VIP Box', isVip: true } });
  }
  const vipBoxId = vipBox.id;
  await prisma.seat.createMany({
    data: ['A', 'B'].flatMap((row) =>
      Array.from({ length: 4 }, (_, i) => ({ sectionId: vipBoxId, row, number: String(i + 1), place: i + 1 })),
    ),
    skipDuplicates: true,
  });

  let vipGate = await prisma.gate.findFirst({ where: { venueId: venue.id, name: 'VIP Gate' } });
  if (!vipGate) {
    vipGate = await prisma.gate.create({
      data: { venueId: venue.id, name: 'VIP Gate', accessZoneId: vipZone.id },
    });
  }

  // A published reserved-seating event: one seated ticket type per
  // section. The VIP Box type carries the VIP zone, so its tickets get
  // through the VIP Gate; Lower Bowl tickets (Main zone, level 0) don't.
  let seatedEvent = await prisma.event.findUnique({ where: { slug: 'sample-seated-show' } });
  if (!seatedEvent) {
    seatedEvent = await prisma.event.create({
      data: {
        organizerId: organizer.id,
        categoryId: categories['theatre'].id,
        venueId: venue.id,
        name: 'Sample Seated Show',
        slug: 'sample-seated-show',
        description: 'A seeded reserved-seating event for Phase 8 testing.',
        startDate: new Date('2026-12-20T19:00:00Z'),
        endDate: new Date('2026-12-20T22:00:00Z'),
        status: 'PUBLISHED',
      },
    });
  }
  // Since Phase 17 a ticket type is seated by having sections for the
  // event (event_sections); its quantity is the open seats in them.
  const seatedTypes = [
    { name: 'Lower Bowl Reserved', category: 'REGULAR' as const, price: 30000, quantityTotal: 24, sectionId: lowerBowl.id, accessZoneId: mainZone.id },
    { name: 'VIP Box', category: 'VIP' as const, price: 100000, quantityTotal: 8, sectionId: vipBoxId, accessZoneId: vipZone.id },
  ];
  for (const { sectionId, ...t } of seatedTypes) {
    let type = await prisma.ticketType.findFirst({ where: { eventId: seatedEvent.id, name: t.name } });
    if (!type) type = await prisma.ticketType.create({ data: { eventId: seatedEvent.id, currency: 'GMD', ...t } });
    await prisma.eventSection.upsert({
      where: { eventId_sectionId: { eventId: seatedEvent.id, sectionId } },
      create: { eventId: seatedEvent.id, sectionId, ticketTypeId: type.id },
      update: {},
    });
  }

  console.log({
    venue: venue.name,
    event: event.slug,
    comedyEvent: comedyEvent.slug,
    limitedTicketType: { id: limitedTicketType.id, quantityTotal: limitedTicketType.quantityTotal },
    draftEvent: draftEvent.slug,
    seatedEvent: seatedEvent.slug,
    vipGate: { id: vipGate.id, zone: vipZone.name },
  });
  console.log('Seed complete.');
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
