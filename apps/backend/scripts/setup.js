// First-time setup of a live database (docs/deploy.md). Safe to run again.
//
//   node scripts/setup.js                                  event categories only
//   node scripts/setup.js --admin you@bantaba.gm --name "Your Name"
//
// Adds the event categories, and with --admin makes (or promotes) that
// account an admin. A new admin gets a random password nobody knows: set
// your own with "Forgot password" on the website, so no password is ever
// typed into a server shell. Unlike `prisma db seed`, nothing else is
// added (no sample events or test accounts).
const { PrismaClient } = require('@prisma/client');
const argon2 = require('argon2');
const { randomBytes } = require('crypto');

const CATEGORIES = [
  { name: 'Concerts', slug: 'concerts', position: 1 },
  { name: 'Parties & nightlife', slug: 'parties-nightlife', position: 2 },
  { name: 'Football', slug: 'football', position: 3 },
  { name: 'Other sports', slug: 'sports', position: 4 },
  { name: 'Festivals', slug: 'festivals', position: 5 },
  { name: 'Comedy', slug: 'comedy-shows', position: 6 },
  { name: 'Theatre & dance', slug: 'theatre', position: 7 },
  { name: 'Movies', slug: 'movies', position: 8 },
  { name: 'Arts & exhibitions', slug: 'arts', position: 9 },
  { name: 'Games & hobbies', slug: 'games-hobbies', position: 10 },
  { name: 'Classes & workshops', slug: 'classes-workshops', position: 11 },
  { name: 'Conferences & business', slug: 'conferences', position: 12 },
  { name: 'Community', slug: 'community', position: 13 },
  { name: 'Faith', slug: 'faith', position: 14 },
  { name: 'Family & kids', slug: 'family-kids', position: 15 },
  { name: 'Food & drink', slug: 'food-drink', position: 16 },
  { name: 'Other', slug: 'other', position: 99 },
];

function arg(name) {
  const i = process.argv.indexOf(`--${name}`);
  return i > 0 ? process.argv[i + 1] : undefined;
}

(async () => {
  const prisma = new PrismaClient();
  try {
    for (const c of CATEGORIES) await prisma.eventCategory.upsert({ where: { slug: c.slug }, update: { position: c.position }, create: c });
    console.log(`Categories: ${CATEGORIES.length} ready`);

    const email = arg('admin')?.trim().toLowerCase();
    if (!email) return;
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) throw new Error(`Not an email address: ${email}`);
    const fullName = arg('name')?.trim() || null;
    const existing = await prisma.user.findUnique({ where: { email } });
    if (existing) {
      if (existing.role === 'ADMIN') return console.log(`${email} is already an admin`);
      if (existing.role !== 'CUSTOMER') throw new Error(`${email} is a ${existing.role} account; use another email for the admin`);
      await prisma.user.update({ where: { id: existing.id }, data: { role: 'ADMIN', ...(fullName ? { fullName } : {}) } });
      await prisma.auditLog.create({ data: { action: 'admin_created', entityType: 'User', entityId: existing.id, metadata: { by: 'scripts/setup.js', promoted: true } } }).catch(() => undefined);
      return console.log(`${email} is now an admin (sign in with your usual password)`);
    }
    const user = await prisma.user.create({
      data: {
        email,
        fullName,
        role: 'ADMIN',
        emailVerifiedAt: new Date(),
        passwordHash: await argon2.hash(randomBytes(32).toString('hex'), { type: argon2.argon2id, memoryCost: 19456, timeCost: 2, parallelism: 1 }),
      },
    });
    await prisma.auditLog.create({ data: { action: 'admin_created', entityType: 'User', entityId: user.id, metadata: { by: 'scripts/setup.js' } } }).catch(() => undefined);
    const site = process.env.FRONTEND_URL || 'the website';
    console.log(`Admin ${email} created. Set its password: open ${site}/forgot-password and enter this email.`);
  } catch (e) {
    console.error(e.message);
    process.exitCode = 1;
  } finally {
    await prisma.$disconnect();
  }
})();
