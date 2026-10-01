// Organizer public profiles (docs/organizer-profiles.md).
// node organizer-profile-test.js   (backend running, seed data loaded)
const sharp = require('sharp');
const { PrismaClient } = require('@prisma/client');
const prisma = new PrismaClient();
const BASE = 'http://localhost:4000/api/v1';
const results = [];
async function api(method, p, token, body) {
  const isForm = body instanceof FormData;
  const res = await fetch(BASE + p, { method, headers: { ...(isForm ? {} : { 'Content-Type': 'application/json' }), ...(token ? { Authorization: `Bearer ${token}` } : {}) }, body: body ? (isForm ? body : JSON.stringify(body)) : undefined });
  let data = null; try { data = await res.json(); } catch {}
  return { status: res.status, data };
}
const login = async (email, password = 'SeedPassword123!') => (await api('POST', '/auth/login', null, { email, password })).data?.accessToken;
const check = (id, name, pass, detail) => { results.push({ id, pass }); console.log(`${pass ? 'PASS' : 'FAIL'}  ${id.padEnd(3)} ${name} — ${detail}`); };
const uniq = (t) => `prof-${t}-${Date.now()}-${Math.random().toString(36).slice(2, 6)}@example.com`;
const PW = 'a-long-enough-password';
const msg = (r) => JSON.stringify(r.data?.message ?? r.data).slice(0, 120);
const png = (w, h) => sharp({ create: { width: w, height: h, channels: 3, background: { r: 200, g: 60, b: 40 } } }).png().toBuffer();
const form = async (buf, name = 'pic.png', type = 'image/png', extra = {}) => {
  const fd = new FormData();
  fd.append('file', new Blob([buf], { type }), name);
  for (const [k, v] of Object.entries(extra)) fd.append(k, String(v));
  return fd;
};
const PUBLIC_KEYS = ['bannerUrl', 'bio', 'businessName', 'contactEmail', 'contactPhone', 'id', 'location', 'logoUrl', 'memberSince', 'past', 'preview', 'slug', 'socialLinks', 'stats', 'upcoming', 'verified', 'website'];

(async () => {
  const admin = await login('admin@example.com');
  const venue = (await api('GET', '/venues')).data[0];
  const cat = (await api('GET', '/categories')).data[0].id;
  const iso = (h) => new Date(Date.now() + h * 3600e3).toISOString();

  // A — the seed organizer's public profile, by URL name and by id; nothing private
  const a1 = await api('GET', '/organizers/sample-events-ltd');
  const a2 = await api('GET', `/organizers/${a1.data.id}`);
  check('A', 'Public profile by slug and id: only public fields (no trust settings, notes, payout details)',
    a1.status === 200 && a2.status === 200 && a2.data.slug === 'sample-events-ltd' && JSON.stringify(Object.keys(a1.data).sort()) === JSON.stringify(PUBLIC_KEYS) && Array.isArray(a1.data.upcoming),
    `${a1.status}/${a2.status}; keys ${Object.keys(a1.data).length}; ${a1.data.upcoming?.length} upcoming`);

  // B — new organizers get a URL name; the same name gets "-2"; hidden until approved except to themselves
  const name = `Kombo Beach Promotions ${Math.random().toString(36).slice(2, 6)}`;
  const e1 = uniq('o1');
  const r1 = await api('POST', '/auth/register-organizer', null, { email: e1, password: PW, businessName: name });
  const r2 = await api('POST', '/auth/register-organizer', null, { email: uniq('o2'), password: PW, businessName: name });
  const org = r1.data.accessToken;
  const row = await prisma.organizer.findFirst({ where: { user: { email: e1 } } });
  const row2 = await prisma.organizer.findFirst({ where: { businessName: name, NOT: { id: row.id } } });
  const b1 = await api('GET', `/organizers/${row.slug}`);
  const b2 = await api('GET', `/organizers/${row.slug}`, org);
  const b3 = await api('GET', `/organizers/${row.slug}`, admin);
  check('B', 'Slug from the name ("…-2" for a repeat); pending profile: 404 to the public, preview for the owner and admins',
    /^kombo-beach-promotions-[a-z0-9]{4}$/.test(row.slug) && row2.slug === `${row.slug}-2` && b1.status === 404 && b2.status === 200 && b2.data.preview === true && b3.status === 200,
    `${row.slug} / ${row2.slug}; public ${b1.status}, owner ${b2.status} preview=${b2.data?.preview}, admin ${b3.status}`);

  // C — editing: links normalised to the platform's own site; bad input refused
  const c1 = await api('PUT', '/organizer/profile', org, {
    bio: 'Beach parties and live music on the Kombo coast.', location: 'Kololi', website: 'kombobeach.gm', contactEmail: 'Hello@KomboBeach.gm', contactPhone: '+220 301 2345',
    socialLinks: { instagram: '@kombobeach', facebook: 'https://m.facebook.com/kombobeach?ref=x', whatsapp: '301 2345', tiktok: 'kombo.beach' },
  });
  const c2 = await api('PUT', '/organizer/profile', org, { socialLinks: { x: 'https://evil.example/kombobeach' } });
  const c3 = await api('PUT', '/organizer/profile', org, { socialLinks: { instagram: 'javascript:alert(1)' } });
  const c4 = await api('PUT', '/organizer/profile', org, { website: 'javascript:alert(1)' });
  const c5 = await api('PUT', '/organizer/profile', org, { bio: 'x'.repeat(1001) });
  const c6 = await api('PUT', '/organizer/profile', org, { contactEmail: 'not-an-email' });
  const c7 = await api('PUT', '/organizer/profile', org, { socialLinks: { tiktok: null } });
  const s = c1.data?.socialLinks ?? {};
  check('C', 'Profile edit: handles → platform links, website https, email lower-cased; links to other sites, javascript:, too-long bio, bad email refused; null removes a link',
    c1.status === 200 && s.instagram === 'https://www.instagram.com/kombobeach' && s.facebook?.startsWith('https://m.facebook.com/kombobeach') && s.whatsapp === 'https://wa.me/2203012345' && s.tiktok === 'https://www.tiktok.com/@kombo.beach' &&
      c1.data.website === 'https://kombobeach.gm/' && c1.data.contactEmail === 'hello@kombobeach.gm' &&
      c2.status === 400 && /X: use a link on x.com/.test(msg(c2)) && c3.status === 400 && c4.status === 400 && c5.status === 400 && c6.status === 400 && c7.status === 200 && !c7.data.socialLinks.tiktok && c7.data.socialLinks.instagram,
    `save ${c1.status} ${JSON.stringify(s)}; other site ${c2.status}; js ${c3.status}/${c4.status}; long ${c5.status}; email ${c6.status}; remove ${c7.status}`);

  // D — images: square picture and wide banner, stored as WebP at fixed sizes; bad files refused; removal deletes the file
  const d1 = await api('POST', '/organizer/profile/images/logo', org, await form(await png(600, 600)));
  const d2 = await api('POST', '/organizer/profile/images/banner', org, await form(await png(1500, 500)));
  const d3 = await api('POST', '/organizer/profile/images/logo', org, await form(Buffer.from('<svg xmlns="http://www.w3.org/2000/svg"/>'), 'x.svg', 'image/svg+xml'));
  const d4 = await api('POST', '/organizer/profile/images/logo', org, await form(await png(120, 120)));
  const d5 = await api('POST', '/organizer/profile/images/logo', org, await form(await png(900, 300), 'wide.png', 'image/png', { mode: 'fit', background: 'color' }));
  const logo = await fetch(d5.data.logoUrl).then((r) => r.arrayBuffer()).then((b) => sharp(Buffer.from(b)).metadata());
  const banner = await fetch(d2.data.bannerUrl).then((r) => r.arrayBuffer()).then((b) => sharp(Buffer.from(b)).metadata());
  const oldLogo = await fetch(d1.data.logoUrl);
  const d6 = await api('DELETE', '/organizer/profile/images/banner', org);
  const goneBanner = await fetch(d2.data.bannerUrl);
  check('D', 'Images: logo 800×800 and banner 1920×640 WebP; SVG and too-small refused; a wide logo fits whole; replaced/removed files deleted',
    d1.status === 201 && d2.status === 201 && d3.status === 400 && d4.status === 400 && /at least 200 × 200/.test(msg(d4)) && d5.status === 201 &&
      logo.format === 'webp' && logo.width === 800 && logo.height === 800 && banner.width === 1920 && banner.height === 640 && oldLogo.status === 404 && d6.status === 200 && d6.data.bannerUrl === null && goneBanner.status === 404,
    `logo ${d1.status}, banner ${d2.status}, svg ${d3.status}, tiny ${d4.status}, fit ${d5.status}; logo ${logo.format} ${logo.width}×${logo.height}; banner ${banner.width}×${banner.height}; old logo ${oldLogo.status}; removed banner ${goneBanner.status}`);

  // E — once approved: public; lists published upcoming events only; event responses link to the profile
  await api('PATCH', `/admin/organizers/${row.id}`, admin, { verificationStatus: 'APPROVED', trustLevel: 'TRUSTED' });
  const live = (await api('POST', '/events', org, { name: 'Kombo Sunset Party', categoryId: cat, venueId: venue.id, startDate: iso(100), endDate: iso(104) })).data;
  await api('POST', '/ticket-types', org, { eventId: live.id, name: 'Entry', price: 30000, quantityTotal: 50 });
  await api('POST', '/ticket-types', org, { eventId: live.id, name: 'VIP', price: 90000, quantityTotal: 10 });
  await api('POST', `/events/${live.id}/publish`, org);
  const draft = (await api('POST', '/events', org, { name: 'Kombo Secret Draft', categoryId: cat, venueId: venue.id, startDate: iso(200), endDate: iso(204) })).data;
  const e2 = await api('GET', `/organizers/${row.slug}`);
  const ev = await api('GET', `/events/${live.id}`);
  check('E', 'Approved: public profile lists the published event (price from D300), not the draft; event shows organizer slug and picture',
    e2.status === 200 && e2.data.preview === false && e2.data.upcoming.length === 1 && e2.data.upcoming[0].id === live.id && e2.data.upcoming[0].priceFrom === 30000 && !e2.data.upcoming.some((x) => x.id === draft.id) &&
      ev.data.organizer.slug === row.slug && ev.data.organizer.logoUrl === d5.data.logoUrl,
    `${e2.status}; upcoming ${e2.data?.upcoming?.map((x) => x.name).join(', ')}; from ${e2.data?.upcoming?.[0]?.priceFrom}; event organizer ${JSON.stringify(ev.data?.organizer)}`);

  // F — admin moderation
  const f1 = await api('PATCH', `/admin/organizers/${row.id}/profile`, admin, { bio: null, socialLinks: { whatsapp: null } });
  const f2 = await api('DELETE', `/admin/organizers/${row.id}/images/logo`, admin);
  const f3 = await api('PATCH', `/admin/organizers/${row.id}/profile`, org, { bio: 'x' });
  const fLog = await prisma.auditLog.findFirst({ where: { action: 'organizer_profile_edited_by_admin', entityId: row.id } });
  check('F', 'Admin can clear text and remove a picture (audited); organizers can\'t use the admin route',
    f1.status === 200 && f1.data.bio === null && !f1.data.socialLinks.whatsapp && f2.status === 200 && f2.data.logoUrl === null && f3.status === 403 && !!fLog,
    `${f1.status} bio=${f1.data?.bio}; image ${f2.status}; organizer ${f3.status}; audit ${!!fLog}`);

  // G — suspended: hidden from the public
  await api('PATCH', `/admin/organizers/${row.id}`, admin, { verificationStatus: 'SUSPENDED' });
  const g1 = await api('GET', `/organizers/${row.slug}`);
  await api('PATCH', `/admin/organizers/${row.id}`, admin, { verificationStatus: 'APPROVED' });
  const g2 = await api('GET', `/organizers/${row.slug}`);
  check('G', 'Suspended organizer\'s profile is hidden (404); back when reinstated', g1.status === 404 && g2.status === 200, `${g1.status} → ${g2.status}`);

  const passed = results.filter((r) => r.pass).length;
  console.log(`\n${passed}/${results.length} passed`);
  await prisma.$disconnect();
  process.exit(passed === results.length ? 0 : 1);
})().catch(async (e) => { console.error(e); await prisma.$disconnect(); process.exit(1); });
