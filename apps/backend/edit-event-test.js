// Edit event + poster/banner upload (roadmap item after Phase 10).
// node edit-event-test.js   (backend running, seed data loaded)
const { PrismaClient } = require('@prisma/client');
const sharp = require('sharp');
const prisma = new PrismaClient();
const ROOT = 'http://localhost:4000';
const BASE = ROOT + '/api/v1';
const results = [];
async function api(method, path, token, body) {
  const res = await fetch(BASE + path, { method, headers: { 'Content-Type': 'application/json', ...(token ? { Authorization: `Bearer ${token}` } : {}) }, body: body ? JSON.stringify(body) : undefined });
  let data = null; try { data = await res.json(); } catch {}
  return { status: res.status, data };
}
async function upload(token, eventId, kind, buf, { type = 'image/jpeg', name = 'photo.jpg', crop } = {}) {
  const fd = new FormData();
  fd.append('file', new Blob([buf], { type }), name);
  if (crop) for (const [k, v] of Object.entries(crop)) fd.append(k, String(v));
  const res = await fetch(`${BASE}/events/${eventId}/images/${kind}`, { method: 'POST', headers: token ? { Authorization: `Bearer ${token}` } : {}, body: fd });
  let data = null; try { data = await res.json(); } catch {}
  return { status: res.status, data };
}
const getFile = async (url) => { const r = await fetch(url); return { status: r.status, type: r.headers.get('content-type'), cache: r.headers.get('cache-control'), nosniff: r.headers.get('x-content-type-options'), buf: Buffer.from(await r.arrayBuffer()) }; };
const login = async (email, password = 'SeedPassword123!') => (await api('POST', '/auth/login', null, { email, password })).data?.accessToken;
const check = (id, name, pass, detail) => { results.push({ id, pass }); console.log(`${pass ? 'PASS' : 'FAIL'}  ${id.padEnd(3)} ${name} — ${detail}`); };
const uniq = (t) => `ee-${t}-${Date.now()}-${Math.random().toString(36).slice(2, 6)}@example.com`;
const msg = (r) => JSON.stringify(r.data?.message ?? r.data).slice(0, 140);

// Test pictures: a photo-like gradient (so it isn't trivially compressible)
const photo = (w, h, format = 'jpeg', extra = (s) => s) =>
  extra(sharp({ create: { width: w, height: h, channels: 3, background: { r: 30, g: 120, b: 200 } } })
    .composite([{ input: Buffer.from(`<svg width="${w}" height="${h}"><defs><linearGradient id="g"><stop offset="0" stop-color="#f60"/><stop offset="1" stop-color="#06f"/></linearGradient></defs><rect width="${w}" height="${h / 2}" fill="url(#g)"/></svg>`), top: 0, left: 0 }]))
    .toFormat(format).toBuffer();

(async () => {
  const [admin, organizer, customer, staff] = await Promise.all(['admin', 'organizer', 'customer', 'staff'].map((u) => login(`${u}@example.com`)));
  const org2 = (await api('POST', '/auth/register-organizer', null, { email: uniq('org2'), password: 'a-long-enough-password', businessName: 'Other Promoter' })).data.accessToken;
  const venues = (await api('GET', '/venues')).data;
  const stadium = venues.find((v) => v.name === 'Independence Stadium');
  const otherVenue = venues.find((v) => v.id !== stadium.id);
  const cats = (await api('GET', '/categories')).data;
  const now = Date.now();
  const iso = (h) => new Date(now + h * 3600e3).toISOString();
  const mk = async (name, extra = {}) => (await api('POST', '/events', organizer, { name, categoryId: cats[0].id, venueId: stadium.id, startDate: iso(24), endDate: iso(28), ...extra })).data;

  // A — the organizer reads their own draft with every editable field
  const ev = await mk('EE Draft', { description: 'First description', contactEmail: 'info@example.com', rules: 'No glass', ageRestriction: 18, socialLinks: { instagram: 'https://instagram.com/x' } });
  const a = await api('GET', `/events/${ev.id}`, organizer);
  check('A', 'Organizer reads own draft with all fields', a.status === 200 && a.data.rules === 'No glass' && a.data.ageRestriction === 18 && a.data.posterUrl === null && a.data.bannerUrl === null, `HTTP ${a.status}, rules "${a.data?.rules}", age ${a.data?.ageRestriction}`);

  // B — edit text fields and dates; slug stays
  const b = await api('PUT', `/events/${ev.id}`, organizer, { name: '  EE Renamed  ', description: 'New description', startDate: iso(48), endDate: iso(52), categoryId: cats[1]?.id ?? cats[0].id });
  check('B', 'Edit name/description/dates/category; slug unchanged', b.status === 200 && b.data.name === 'EE Renamed' && b.data.slug === ev.slug && b.data.description === 'New description' && b.data.startDate === iso(48),
    `HTTP ${b.status}, name "${b.data?.name}", slug ${b.data?.slug === ev.slug ? 'kept' : 'CHANGED'}`);

  // C — clearing optional fields with null; required ones refuse null / blank
  const c1 = await api('PUT', `/events/${ev.id}`, organizer, { description: null, contactEmail: null, rules: null, ageRestriction: null, socialLinks: null });
  const c2 = await api('PUT', `/events/${ev.id}`, organizer, { name: null });
  const c3 = await api('PUT', `/events/${ev.id}`, organizer, { name: '   ' });
  const c4 = await api('PUT', `/events/${ev.id}`, organizer, { startDate: null });
  check('C', 'Optional fields clear with null; required fields refuse null/blank (400, not 500)',
    c1.status === 200 && c1.data.description === null && c1.data.contactEmail === null && c1.data.socialLinks === null && c1.data.ageRestriction === null && c2.status === 400 && c3.status === 400 && c4.status === 400,
    `clear ${c1.status} (social ${JSON.stringify(c1.data?.socialLinks)}), name null ${c2.status}, blank ${c3.status}, start null ${c4.status}`);

  // D — bad values
  const d1 = await api('PUT', `/events/${ev.id}`, organizer, { endDate: iso(40) }); // before start (48)
  const d2 = await api('PUT', `/events/${ev.id}`, organizer, { categoryId: '00000000-0000-4000-8000-000000000000' });
  const d3 = await api('PUT', `/events/${ev.id}`, organizer, { venueId: '00000000-0000-4000-8000-000000000000' });
  const d4 = await api('PUT', `/events/${ev.id}`, organizer, { name: 'x'.repeat(201) });
  const d5 = await api('PUT', `/events/${ev.id}`, organizer, { bannerUrl: 'https://evil.example/x.png' });
  const d6 = await api('POST', '/events', organizer, { name: 'EE poster url', categoryId: cats[0].id, venueId: stadium.id, startDate: iso(1), endDate: iso(2), posterUrl: 'javascript:alert(1)' });
  const d7 = await api('PUT', `/events/${ev.id}`, organizer, { socialLinks: { instagram: 'javascript:alert(1)' } });
  const d8 = await api('POST', '/events', organizer, { name: 'EE bad social', categoryId: cats[0].id, venueId: stadium.id, startDate: iso(1), endDate: iso(2), socialLinks: { site: 'data:text/html,<script>alert(1)</script>' } });
  const d9 = await api('PUT', `/events/${ev.id}`, organizer, { socialLinks: { instagram: 'https://instagram.com/ok', website: 'http://example.com' } });
  check('D', 'Rejects end<start, unknown category/venue, long name, free-text image URLs, non-web social links (400); web links OK',
    [d1, d2, d3, d4, d5, d6, d7, d8].every((r) => r.status === 400) && d9.status === 200, [d1, d2, d3, d4, d5, d6, d7, d8, d9].map((r) => r.status).join(' '));

  // E — who may edit
  const e1 = await api('PUT', `/events/${ev.id}`, org2, { name: 'hijack' });
  const e2 = await api('PUT', `/events/${ev.id}`, customer, { name: 'hijack' });
  const e3 = await api('PUT', `/events/${ev.id}`, staff, { name: 'hijack' });
  const e4 = await api('PUT', `/events/${ev.id}`, admin, { description: 'Admin note' });
  check('E', 'Other organizer/customer/staff 403; admin may edit', e1.status === 403 && e2.status === 403 && e3.status === 403 && e4.status === 200,
    `org2 ${e1.status}, customer ${e2.status}, staff ${e3.status}, admin ${e4.status}`);

  // F — venue changes
  const seated = (await api('GET', '/events/sample-seated-show')).data;
  const f1 = await api('PUT', `/events/${seated.id}`, organizer, { venueId: otherVenue.id });
  const gev = await mk('EE Gated');
  const gate = (await api('GET', `/venues/${stadium.id}`)).data.gates[0];
  await api('POST', `/events/${gev.id}/staff`, organizer, { email: 'staff@example.com', role: 'GATE_STAFF', assignedGateId: gate.id });
  const f2 = await api('PUT', `/events/${gev.id}`, organizer, { venueId: otherVenue.id });
  const f3 = await api('PUT', `/events/${ev.id}`, organizer, { venueId: otherVenue.id });
  check('F', 'Venue change refused with seated types or gate-assigned staff; allowed otherwise',
    f1.status === 400 && f2.status === 400 && /gates/.test(msg(f2)) && f3.status === 200 && f3.data.venueId === otherVenue.id,
    `seated ${f1.status}, gated staff ${f2.status} ${msg(f2)}, plain ${f3.status}`);
  await api('PUT', `/events/${ev.id}`, organizer, { venueId: stadium.id });

  // G — cancelled events are frozen (text and images)
  const cev = await mk('EE Cancel');
  await prisma.event.update({ where: { id: cev.id }, data: { status: 'CANCELLED' } });
  const g1 = await api('PUT', `/events/${cev.id}`, organizer, { name: 'nope' });
  const g2 = await upload(organizer, cev.id, 'banner', await photo(1920, 640));
  check('G', 'Cancelled event: edit and upload refused', g1.status === 400 && g2.status === 400, `edit ${g1.status}, upload ${g2.status}`);

  // H — banner upload with crop; stored file is a 1920×640 WebP with no metadata
  const src = await photo(3000, 2000, 'jpeg', (s) => s.withMetadata({ exif: { IFD0: { Artist: 'Secret Person', Copyright: 'GPS 13.45N 16.57W' } } }));
  const srcMeta = await sharp(src).metadata();
  const h = await upload(organizer, ev.id, 'banner', src, { crop: { cropX: 0.1, cropY: 0.2, cropWidth: 0.8, cropHeight: (0.8 * 3000) / 3 / 2000 } });
  const hf = h.data?.bannerUrl ? await getFile(h.data.bannerUrl) : {};
  const hm = hf.buf ? await sharp(hf.buf).metadata() : {};
  check('H', 'Banner upload: cropped to 1920×640 WebP, EXIF stripped, cacheable, nosniff',
    h.status === 201 && hf.status === 200 && hf.type === 'image/webp' && hm.width === 1920 && hm.height === 640 && !!srcMeta.exif && !hm.exif && /immutable/.test(hf.cache ?? '') && hf.nosniff === 'nosniff',
    `HTTP ${h.status} ${h.status !== 201 ? msg(h) : ''} url ${h.data?.bannerUrl}, file ${hf.status} ${hf.type} ${hm.width}×${hm.height}, source had EXIF ${!!srcMeta.exif}, output EXIF ${!!hm.exif}, ${hf.buf?.length} bytes, cache "${hf.cache}"`);

  // I — poster without crop = centred; PNG and WebP accepted; browser's claimed type ignored
  const i1 = await upload(organizer, ev.id, 'poster', await photo(1200, 1600, 'png'), { type: 'application/octet-stream', name: 'poster.bin' });
  const i1m = i1.data?.posterUrl ? await sharp((await getFile(i1.data.posterUrl)).buf).metadata() : {};
  const i2 = await upload(organizer, ev.id, 'poster', await photo(1000, 1500, 'webp'), { type: 'image/webp', name: 'p.webp' });
  check('I', 'Poster: PNG (wrong claimed type) and WebP accepted, stored 1000×1500', i1.status === 201 && i1m.width === 1000 && i1m.height === 1500 && i2.status === 201,
    `png ${i1.status} → ${i1m.width}×${i1m.height}, webp ${i2.status}`);

  // J — replacing deletes the old file; the event row points at the new one
  const oldPoster = i1.data?.posterUrl;
  const oldGone = oldPoster ? (await getFile(oldPoster)).status : 0;
  const row = await prisma.event.findUnique({ where: { id: ev.id } });
  check('J', 'Replacing an image deletes the previous file', oldGone === 404 && row.posterUrl === i2.data?.posterUrl && row.posterUrl !== oldPoster, `old file ${oldGone}, row → newest`);

  // K — not images / dangerous / broken files
  const svg = Buffer.from('<svg xmlns="http://www.w3.org/2000/svg" width="2000" height="1000" onload="alert(1)"><rect width="2000" height="1000"/></svg>');
  const k1 = await upload(organizer, ev.id, 'banner', svg, { type: 'image/svg+xml', name: 'x.svg' });
  const k2 = await upload(organizer, ev.id, 'banner', Buffer.from('<html><script>alert(1)</script></html>'), { type: 'image/png', name: 'x.png' });
  const gif = await sharp({ create: { width: 2000, height: 700, channels: 3, background: '#888' } }).gif().toBuffer();
  const k3 = await upload(organizer, ev.id, 'banner', gif, { type: 'image/gif', name: 'x.gif' });
  const full = await photo(2000, 700);
  const k4 = await upload(organizer, ev.id, 'banner', full.subarray(0, Math.floor(full.length / 3)));
  const k5 = await upload(organizer, ev.id, 'banner', undefined ?? Buffer.alloc(0));
  check('K', 'SVG, HTML-as-PNG, GIF, truncated JPEG, empty file → 400', [k1, k2, k3, k4, k5].every((r) => r.status === 400),
    [k1, k2, k3, k4, k5].map((r) => `${r.status} ${msg(r).slice(0, 50)}`).join(' | '));

  // L — size, pixel count, minimum size, crop shape/bounds
  const big = Buffer.concat([await photo(2000, 700), Buffer.alloc(11 * 1024 * 1024)]);
  const l1 = await upload(organizer, ev.id, 'banner', big);
  const bomb = await sharp({ create: { width: 12000, height: 12000, channels: 3, background: '#000' } }).png({ compressionLevel: 9, palette: true }).toBuffer();
  const l2 = await upload(organizer, ev.id, 'banner', bomb, { type: 'image/png' });
  const l3 = await upload(organizer, ev.id, 'banner', await photo(400, 150));
  const l3poster = await upload(organizer, ev.id, 'poster', await photo(393, 508)); // 339 × 508 after cropping, allowed
  const l3ok = await upload(organizer, ev.id, 'banner', await photo(857, 360)); // the size from real testing: 857 × 286 after cropping, allowed
  const l4 = await upload(organizer, ev.id, 'banner', await photo(3000, 2000), { crop: { cropX: 0, cropY: 0, cropWidth: 1, cropHeight: 1 } });
  const l5 = await upload(organizer, ev.id, 'banner', await photo(3000, 2000), { crop: { cropX: 0.5, cropY: 0, cropWidth: 0.8, cropHeight: 0.4 } });
  const l6 = await upload(organizer, ev.id, 'banner', await photo(3000, 2000), { crop: { cropX: 0.1 } });
  check('L', 'Over 10 MB 413; 144 MP bomb, too-small image (857×360 allowed), wrong crop shape, crop off the image, partial crop → 400',
    l1.status === 413 && [l2, l3, l4, l5, l6].every((r) => r.status === 400) && l3ok.status === 201 && l3poster.status === 201,
    `big ${l1.status}, bomb ${l2.status} (${bomb.length} bytes) ${msg(l2).slice(0, 40)}, small ${l3.status} ${msg(l3).slice(0, 70)}, 857×360 ${l3ok.status}, poster 393×508 ${l3poster.status}, shape ${l4.status}, off-image ${l5.status}, partial ${l6.status}`);

  // M — phone photo stored sideways with a rotation flag: crop applies to the upright picture
  const sideways = await sharp({ create: { width: 2400, height: 1200, channels: 3, background: '#2a6' } }).jpeg().withMetadata({ orientation: 6 }).toBuffer(); // displays as 1200×2400
  const m = await upload(organizer, ev.id, 'poster', sideways, { crop: { cropX: 0, cropY: 0.1, cropWidth: 1, cropHeight: 0.75 } });
  check('M', 'Rotated phone photo: crop measured on the upright image', m.status === 201, `HTTP ${m.status} ${m.status !== 201 ? msg(m) : ''}`);

  // N — permissions and lookups on uploads
  const pic = await photo(1920, 640);
  const n1 = await upload(org2, ev.id, 'banner', pic);
  const n2 = await upload(customer, ev.id, 'banner', pic);
  const n3 = await upload(null, ev.id, 'banner', pic);
  const n4 = await upload(organizer, '00000000-0000-4000-8000-000000000000', 'banner', pic);
  const n5 = await upload(organizer, ev.id, 'logo', pic);
  const n6 = await upload(admin, ev.id, 'banner', pic);
  check('N', 'Upload: other organizer 403, customer 403, anonymous 401, unknown event 404, unknown kind 400, admin OK',
    n1.status === 403 && n2.status === 403 && n3.status === 401 && n4.status === 404 && n5.status === 400 && n6.status === 201,
    `org2 ${n1.status}, customer ${n2.status}, anon ${n3.status}, unknown ${n4.status}, kind ${n5.status}, admin ${n6.status}`);

  // O — remove
  const before = (await prisma.event.findUnique({ where: { id: ev.id } })).bannerUrl;
  const o1 = await api('DELETE', `/events/${ev.id}/images/banner`, organizer);
  const o2 = before ? (await getFile(before)).status : 0;
  const o3 = await api('DELETE', `/events/${ev.id}/images/banner`, organizer);
  const o4 = await api('DELETE', `/events/${ev.id}/images/banner`, org2);
  check('O', 'Remove banner: field null, file deleted, repeat is harmless, other organizer 403', o1.status === 200 && o1.data.bannerUrl === null && o2 === 404 && o3.status === 200 && o4.status === 403,
    `${o1.status}, file ${o2}, again ${o3.status}, org2 ${o4.status}`);

  // P — published events: images visible publicly and on the dashboard
  const pev = await mk('EE Published');
  await api('POST', '/ticket-types', organizer, { eventId: pev.id, name: 'GA', price: 1000, quantityTotal: 10 });
  await api('POST', `/events/${pev.id}/publish`, organizer);
  const p1 = await upload(organizer, pev.id, 'banner', pic);
  const pub = await api('GET', `/events/${pev.slug}`);
  const dash = await api('GET', `/events/${pev.id}/dashboard`, organizer);
  check('P', 'Published event: banner editable, shown in public event and dashboard', p1.status === 201 && pub.data.bannerUrl === p1.data.bannerUrl && dash.data.event.bannerUrl === p1.data.bannerUrl,
    `upload ${p1.status}, public ${pub.data?.bannerUrl ? 'has banner' : 'missing'}, dashboard ${dash.data?.event?.bannerUrl ? 'has banner' : 'missing'}`);

  // Q — deleting a draft deletes its images
  const dev = await mk('EE Delete me');
  const q1 = await upload(organizer, dev.id, 'poster', await photo(1000, 1500));
  const q2 = await api('DELETE', `/events/${dev.id}`, organizer);
  const q3 = q1.data?.posterUrl ? (await getFile(q1.data.posterUrl)).status : 0;
  check('Q', 'Deleting a draft removes its image files', q1.status === 201 && q2.status === 200 && q3 === 404, `upload ${q1.status}, delete ${q2.status}, file ${q3}`);

  // R — no path tricks through the media route
  const r1 = await fetch(`${ROOT}/media/../.env`).then((r) => r.status);
  const r2 = await fetch(`${ROOT}/media/%2e%2e/%2e%2e/package.json`).then((r) => r.status);
  const r3 = await fetch(`${ROOT}/media/.hidden`).then((r) => r.status);
  check('R', 'Media route serves nothing outside the uploads folder', [r1, r2, r3].every((s) => s === 404 || s === 403 || s === 400), `${r1} ${r2} ${r3}`);

  // S — "Fit whole image": nothing cut off, leftover space blurred or plain colour
  const px = async (url, x, y) => { const { data, info } = await sharp((await getFile(url)).buf).raw().toBuffer({ resolveWithObject: true }); const i = (y * info.width + x) * info.channels; return [data[i], data[i + 1], data[i + 2]]; };
  const near = (a, b, tol = 12) => a.every((v, i) => Math.abs(v - b[i]) <= tol);
  // flyer: red with a 10px green border on every edge, so a crop would cut the border off
  const flyer = (w, h) => sharp({ create: { width: w, height: h, channels: 3, background: '#22aa44' } })
    .composite([{ input: { create: { width: w - 20, height: h - 20, channels: 3, background: '#dd2222' } }, left: 10, top: 10 }]).jpeg({ quality: 95 }).toBuffer();
  const s1 = await upload(organizer, ev.id, 'poster', await flyer(393, 508), { crop: { mode: 'fit' } });
  const s1m = s1.data?.posterUrl ? await sharp((await getFile(s1.data.posterUrl)).buf).metadata() : {};
  // 393×508 scaled ×2.54 → 1000×1292, centred: top/bottom 104px bands are background
  const s1edgeL = s1.data?.posterUrl ? await px(s1.data.posterUrl, 5, 750) : null;  // left border of the flyer: green, kept
  const s1mid = s1.data?.posterUrl ? await px(s1.data.posterUrl, 500, 750) : null;
  const s1band = s1.data?.posterUrl ? await px(s1.data.posterUrl, 500, 20) : null;
  const sq = await sharp({ create: { width: 1200, height: 1200, channels: 3, background: '#3366cc' } }).png().toBuffer();
  const s2 = await upload(organizer, ev.id, 'banner', sq, { type: 'image/png', crop: { mode: 'fit', background: 'color' } });
  const s2side = s2.data?.bannerUrl ? await px(s2.data.bannerUrl, 50, 320) : null; // outside the square: its average colour = the same blue
  const s3 = await upload(organizer, ev.id, 'banner', sq, { crop: { mode: 'fit', cropX: 0, cropY: 0, cropWidth: 1, cropHeight: 0.33 } });
  const s4 = await upload(organizer, ev.id, 'banner', await photo(2000, 700), { crop: { background: 'blur' } });
  const s5 = await upload(organizer, ev.id, 'poster', await flyer(120, 160), { crop: { mode: 'fit' } });
  const s6 = await upload(organizer, ev.id, 'poster', await flyer(393, 508), { crop: { mode: 'stretch' } });
  check('S', 'Fit whole image: whole flyer kept (edges intact), centred on blurred/colour background; bad combos 400',
    s1.status === 201 && s1m.width === 1000 && s1m.height === 1500 && near(s1edgeL, [0x22, 0xaa, 0x44], 40) && near(s1mid, [0xdd, 0x22, 0x22], 20) && !near(s1band, [0xdd, 0x22, 0x22], 20)
      && s2.status === 201 && near(s2side, [0x33, 0x66, 0xcc]) && [s3, s4, s5, s6].every((r) => r.status === 400),
    `poster ${s1.status} ${s1m.width}×${s1m.height}, left edge ${s1edgeL}, middle ${s1mid}, top band ${s1band}; square→banner colour ${s2.status} side ${s2side}; fit+crop ${s3.status}, background w/o fit ${s4.status}, tiny ${s5.status} ${msg(s5).slice(0, 60)}, bad mode ${s6.status}`);

  const failed = results.filter((r) => !r.pass).length;
  console.log(`\n${results.length - failed}/${results.length} passed`);
  await prisma.$disconnect();
  process.exit(failed ? 1 : 0);
})().catch(async (e) => { console.error('RUN ERROR', e); await prisma.$disconnect(); process.exit(1); });
