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
    update: { passwordHash: seedPasswordHash },
    create: {
      email: 'admin@example.com',
      passwordHash: seedPasswordHash,
      role: 'ADMIN',
      fullName: 'Sample Admin',
    },
  });

  const organizerUser = await prisma.user.upsert({
    where: { email: 'organizer@example.com' },
    update: { passwordHash: seedPasswordHash },
    create: {
      email: 'organizer@example.com',
      passwordHash: seedPasswordHash,
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
      verificationStatus: 'APPROVED',
    },
  });

  const customer = await prisma.user.upsert({
    where: { email: 'customer@example.com' },
    update: { passwordHash: seedPasswordHash },
    create: {
      email: 'customer@example.com',
      passwordHash: seedPasswordHash,
      role: 'CUSTOMER',
      fullName: 'Sample Customer',
    },
  });

  console.log('Seeded accounts (password for all three: SeedPassword123!):', {
    admin: admin.email,
    organizer: organizerUser.email,
    customer: customer.email,
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

  console.log({
    venue: venue.name,
    event: event.slug,
    comedyEvent: comedyEvent.slug,
    limitedTicketType: { id: limitedTicketType.id, quantityTotal: limitedTicketType.quantityTotal },
    draftEvent: draftEvent.slug,
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
