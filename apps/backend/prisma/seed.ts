import { PrismaClient } from '@prisma/client';
import * as argon2 from 'argon2';

const prisma = new PrismaClient();

async function main() {
  console.log('Seeding...');

  const seedPasswordHash = await argon2.hash('SeedPassword123!', {
    type: argon2.argon2id,
  });

  // User accounts are always upserted, regardless of whether the sample
  // event below already exists — otherwise re-running this script on an
  // already-seeded database would silently skip creating login-ready
  // accounts, which defeats the point of a re-runnable seed.
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

  const existingEvent = await prisma.event.findUnique({
    where: { slug: 'sample-concert-night' },
  });
  if (existingEvent) {
    console.log(
      'Sample event already exists (slug: sample-concert-night) — skipping venue/event/order creation.',
    );
    console.log('Seed complete.');
    return;
  }

  const category = await prisma.eventCategory.upsert({
    where: { slug: 'concerts' },
    update: {},
    create: { name: 'Concerts', slug: 'concerts' },
  });

  const venue = await prisma.venue.create({
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

  const gate = await prisma.gate.create({
    data: { venueId: venue.id, name: 'Gate 1' },
  });

  const mainZone = await prisma.accessZone.create({
    data: { venueId: venue.id, name: 'Main', level: 0 },
  });

  const event = await prisma.event.create({
    data: {
      organizerId: organizer.id,
      categoryId: category.id,
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

  const order = await prisma.ticketOrder.create({
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

  console.log({
    category: category.slug,
    venue: venue.name,
    gate: gate.name,
    event: event.slug,
    order: order.id,
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
