// Phase 26: the event form's API: categories in order, hosts' own venues
// with directions and a map pin, removing unsold ticket types.
// node event-form-test.js   (backend running with RATE_LIMITS=off, seed data loaded)
const { PrismaClient } = require('@prisma/client');
const prisma = new PrismaClient();
const BASE = 'http://localhost:4000/api/v1';
const results = [];
async function api(method, p, token, body) {
  const res = await fetch(BASE + p, { method, headers: { 'Content-Type': 'application/json', ...(token ? { Authorization: `Bearer ${token}` } : {}) }, body: body ? JSON.stringify(body) : undefined });
  let data = null; try { data = await res.json(); } catch {}
  return { status: res.status, data };
}
const login = async (email, password = 'SeedPassword123!') => (await api('POST', '/auth/login', null, { email, password })).data?.accessToken;
const check = (id, name, pass, detail) => { results.push({ id, pass }); console.log(`${pass ? 'PASS' : 'FAIL'}  ${id.padEnd(3)} ${name} — ${detail}`); };
const tag = Math.random().toString(36).slice(2, 7);

(async () => {
  const [org, customer] = await Promise.all([login('organizer@example.com'), login('customer@example.com')]);

  // A — categories
  const cats = (await api('GET', '/categories')).data;
  const names = cats.map((c) => c.name);
  check('A', 'Categories: 17 in order, Concerts first, Other last, Games & hobbies and Faith among them',
    cats.length >= 17 && names[0] === 'Concerts' && names[names.length - 1] === 'Other' && names.includes('Games & hobbies') && names.includes('Faith') && names.includes('Comedy'),
    `${cats.length}: ${names.slice(0, 3).join(', ')} … ${names[names.length - 1]}`);

  // B — a venue with directions and "I'm there now"
  const v1 = await api('POST', '/organizer/venues', org, { name: `City Library ${tag}`, city: 'Banjul', address: 'Independence Drive', directions: 'Opposite the Arch 22 car park.', latitude: 13.4549, longitude: -16.579 });
  const list = (await api('GET', '/organizer/venues', org)).data;
  const row = list.find((v) => v.id === v1.data?.id);
  check('B', 'Host adds a venue with directions and a pin; listed as theirs with both',
    v1.status === 201 && v1.data.directions === 'Opposite the Arch 22 car park.' && v1.data.latitude === 13.4549 && row?.kind === 'yours' && row.longitude === -16.579,
    `${v1.status}; ${v1.data?.directions}; ${v1.data?.latitude},${v1.data?.longitude}; kind ${row?.kind}`);

  // C — Google Maps links
  const place = await api('POST', '/organizer/venues', org, { name: `Bakau Beach ${tag}`, city: 'Bakau', address: 'Bakau', mapsLink: 'https://www.google.com/maps/place/Bakau+Fish+Market/@13.4800,-16.6800,17z/data=!3m1!4b1!4m6!3m5!1s0x0:0x0!8m2!3d13.4789!4d-16.6788' });
  const plain = await api('POST', '/organizer/venues', org, { name: `Pin ${tag}`, city: 'Kololi', address: 'Kololi', mapsLink: '13.4497, -16.7203' });
  const bad = await api('POST', '/organizer/venues', org, { name: `Bad ${tag}`, city: 'Kololi', address: 'Kololi', mapsLink: 'https://example.com/somewhere' });
  const upd = await api('PATCH', `/organizer/venues/${v1.data.id}`, org, { directions: null, latitude: null, longitude: null });
  check('C', 'Maps links: the place’s own pin (not the map centre), plain "lat, lng", a non-map link refused; directions and pin can be cleared',
    place.data?.latitude === 13.4789 && place.data?.longitude === -16.6788 && plain.data?.latitude === 13.4497 && bad.status === 400 && upd.data?.directions === null && upd.data?.latitude === null,
    `place ${place.data?.latitude},${place.data?.longitude}; plain ${plain.data?.latitude}; bad ${bad.status}; cleared ${upd.data?.directions}/${upd.data?.latitude}`);

  // D — buyers see directions and the pin
  const games = cats.find((c) => c.slug === 'games-hobbies');
  const start = new Date(Date.now() + 5 * 864e5);
  const ev = (await api('POST', '/events', org, { name: `Form ${tag}`, categoryId: games.id, venueId: place.data.id, startDate: start.toISOString(), endDate: new Date(start.getTime() + 3 * 3600e3).toISOString() })).data;
  const keep = (await api('POST', '/ticket-types', org, { eventId: ev.id, name: 'Entry', price: 0, quantityTotal: 30 })).data;
  const drop = (await api('POST', '/ticket-types', org, { eventId: ev.id, name: 'Typo', price: 0, quantityTotal: 5 })).data;
  await api('POST', `/events/${ev.id}/publish`, org);
  const pub = await api('GET', `/events/${ev.slug}`);
  check('D', 'Event page: the venue’s directions and pin for the Directions button',
    pub.data?.venue?.latitude === 13.4789 && pub.data.category?.slug === 'games-hobbies', `${pub.data?.venue?.latitude}; ${pub.data?.category?.name}`);

  // E — removing ticket types
  const del = await api('DELETE', `/ticket-types/${drop.id}`, org);
  await api('POST', '/orders/checkout', customer, { eventId: ev.id, items: [{ ticketTypeId: keep.id, quantity: 1 }] });
  const delSold = await api('DELETE', `/ticket-types/${keep.id}`, org);
  const other = await api('DELETE', `/ticket-types/${keep.id}`, customer);
  const left = await prisma.ticketType.count({ where: { eventId: ev.id } });
  check('E', 'An unsold ticket type can be removed; one with tickets out can’t (turn it off instead); not by others',
    del.status === 200 && delSold.status === 400 && [403, 404].includes(other.status) && left === 1,
    `unsold ${del.status}; sold ${delSold.status} "${delSold.data?.message}"; other ${other.status}; left ${left}`);

  const failed = results.filter((r) => !r.pass);
  console.log(`\n${results.length - failed.length}/${results.length} passed`);
  await prisma.$disconnect();
  process.exit(failed.length ? 1 : 0);
})().catch(async (e) => { console.error(e); await prisma.$disconnect(); process.exit(1); });
