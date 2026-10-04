// Phase 18: organizers' own venues, Bantaba venues shared with chosen
// organizers, and event templates (docs/seating.md, docs/templates.md).
// node phase18-test.js   (backend running with RATE_LIMITS=off, seed data loaded)
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
const PW = 'a-long-enough-password';
const iso = (h) => new Date(Date.now() + h * 3600e3).toISOString();

(async () => {
  const [admin, orgA] = await Promise.all([login('admin@example.com'), login('organizer@example.com')]);
  const cat = (await api('GET', '/categories')).data[0].id;
  const emailB = `venue-host-${tag}@example.com`;
  await api('POST', '/auth/register-organizer', null, { email: emailB, password: PW, businessName: `Other Host ${tag}` });
  const orgB = await login(emailB, PW);
  const orgBRow = await prisma.organizer.findFirst({ where: { user: { email: emailB } } });
  const orgARow = await prisma.organizer.findFirst({ where: { user: { email: 'organizer@example.com' } } });
  // Let B hold events, so a refusal below is about the venue.
  await prisma.organizer.update({ where: { id: orgBRow.id }, data: { verificationStatus: 'APPROVED' } });
  const event = (token, venueId, name = `Night ${tag}`) => api('POST', '/events', token, { name, categoryId: cat, venueId, startDate: iso(72), endDate: iso(76) });

  // A — an organizer makes their own venue, sections without a drawing, seats
  const mine = await api('POST', '/organizer/venues', orgA, { name: `Coco Garden ${tag}`, address: 'Bijilo', city: 'Bijilo' });
  const v = mine.data;
  const front = await api('POST', `/organizer/venues/${v.id}/sections`, orgA, { name: 'Front' });
  const dup = await api('POST', `/organizer/venues/${v.id}/sections`, orgA, { name: 'front' });
  await api('POST', `/organizer/venues/${v.id}/sections`, orgA, { name: 'Bar side' });
  const secId = (d, n) => d.sections.find((s) => s.name === n)?.id;
  const frontId = secId(front.data, 'Front');
  const lay = await api('PUT', `/organizer/venue-sections/${frontId}`, orgA, { rows: 3, perRow: 10, removed: [] });
  const list = await api('GET', '/organizer/venues', orgA);
  const row = list.data?.find((x) => x.id === v.id);
  check('A', 'Own venue: made by the organizer (owner set), sections added by name, same name twice refused, 30 seats laid out, listed as "yours"',
    mine.status === 201 && v.owner?.id === orgARow.id && front.status === 201 && dup.status === 400 && lay.status === 200 && lay.data.seats === 30 && row?.kind === 'yours' && row?.seats === 30,
    `${mine.status} owner ${v.owner?.name}; section ${front.status}, dup ${dup.status}; seats ${lay.data?.seats}; kind ${row?.kind}`);

  // B — private: others can't see, use or change it
  const bSee = await api('GET', `/organizer/venues/${v.id}`, orgB);
  const bEdit = await api('PUT', `/organizer/venue-sections/${frontId}`, orgB, { rows: 1, perRow: 1, removed: [] });
  const bEvent = await event(orgB, v.id);
  const bVenues = await api('GET', '/venues', orgB);
  const anon = await api('GET', '/venues');
  check('B', 'Private to its organizer: another organizer gets 404 viewing or editing it, can’t hold an event there, doesn’t see it in /venues; nor do visitors',
    bSee.status === 404 && bEdit.status === 404 && bEvent.status === 400 && !bVenues.data.some((x) => x.id === v.id) && !anon.data.some((x) => x.id === v.id),
    `view ${bSee.status}, edit ${bEdit.status}, event ${bEvent.status} "${bEvent.data?.message}"`);

  // C — Bantaba venues: organizers can view, not change
  const stadium = (await api('POST', '/venues', admin, { name: `Stadium ${tag}`, address: 'Bakau', city: 'Bakau' })).data;
  const st = (await api('POST', `/admin/venues/${stadium.id}/sections`, admin, { name: 'North stand' })).data;
  const northId = secId(st, 'North stand');
  const aView = await api('GET', `/organizer/venues/${stadium.id}`, orgA);
  const aEdit = await api('PUT', `/organizer/venue-sections/${northId}`, orgA, { rows: 1, perRow: 1, removed: [] });
  const aAdd = await api('POST', `/organizer/venues/${stadium.id}/sections`, orgA, { name: 'Mine now' });
  check('C', 'Bantaba venue: organizers see it (editable false) but changing seats or adding sections is 403',
    aView.status === 200 && aView.data.editable === false && aEdit.status === 403 && aAdd.status === 403,
    `view ${aView.status} editable ${aView.data?.editable}; edit ${aEdit.status}; add ${aAdd.status}`);

  // D — sharing with chosen organizers
  const share = await api('PUT', `/admin/venues/${stadium.id}/sharing`, admin, { sharing: 'chosen', organizerIds: [orgARow.id] });
  const aEv = await event(orgA, stadium.id, `Match ${tag}`);
  const bEv = await event(orgB, stadium.id);
  const bList = await api('GET', '/organizer/venues', orgB);
  const aList = await api('GET', '/organizer/venues', orgA);
  const shareOwn = await api('PUT', `/admin/venues/${v.id}/sharing`, admin, { sharing: 'everyone' });
  const adminList = await api('GET', '/admin/venues', admin);
  const adminRow = adminList.data?.find((x) => x.id === stadium.id);
  check('D', 'Shared with A only: A can hold an event there (listed as "shared"), B can’t and doesn’t see it; an organizer’s own venue can’t be shared; admin list shows Bantaba + 1 organizer',
    share.status === 200 && share.data.sharing === 'chosen' && share.data.sharedWith.length === 1 && aEv.status === 201 && bEv.status === 400 &&
      !bList.data.some((x) => x.id === stadium.id) && aList.data.find((x) => x.id === stadium.id)?.kind === 'shared' && shareOwn.status === 400 &&
      adminRow?.owner === null && adminRow?.sharing === 'chosen' && adminRow?.sharedWith === 1,
    `share ${share.status}; A event ${aEv.status}, B event ${bEv.status}; own venue share ${shareOwn.status}; admin row ${adminRow?.sharing}/${adminRow?.sharedWith}`);

  // E — taking A off keeps their event, stops new ones
  await api('PUT', `/admin/venues/${stadium.id}/sharing`, admin, { sharing: 'chosen', organizerIds: [] });
  const keep = await api('GET', `/events/${aEv.data.id}`, orgA);
  const again = await event(orgA, stadium.id, `Match 2 ${tag}`);
  const open = await api('PUT', `/admin/venues/${stadium.id}/sharing`, admin, { sharing: 'everyone' });
  const bAfter = await event(orgB, stadium.id, `Open ${tag}`);
  check('E', 'Taking A off keeps their event at the stadium but refuses a new one; back to "everyone" lets B in',
    keep.status === 200 && keep.data.venueId === stadium.id && again.status === 400 && open.status === 200 && bAfter.status === 201,
    `kept ${keep.status}, new ${again.status}, everyone ${open.status}, B ${bAfter.status}`);

  // F — an event at the own venue, saved as a template
  const ev = (await event(orgA, v.id, `Beach party ${tag}`)).data;
  await api('PUT', `/events/${ev.id}`, orgA, { description: 'Sunset and drums', rules: 'No glass' });
  const tt = async (name, price, quantityTotal, salesStart) => (await api('POST', '/ticket-types', orgA, { eventId: ev.id, name, price, quantityTotal, ...(salesStart ? { salesStart } : {}) })).data;
  const tables = await tt('Tables', 50000, 1, iso(24));
  const floor = await tt('Floor', 25000, 200);
  const seats = (await api('GET', `/events/${ev.id}/seating/sections/${frontId}`, orgA)).data;
  const closeIds = seats.rows[0].seats.slice(0, 2).map((x) => x.id);
  const seatRes = await api('PUT', `/events/${ev.id}/seating/sections/${frontId}`, orgA, { ticketTypeId: tables.id, closedSeatIds: closeIds });
  const saved = await api('POST', `/events/${ev.id}/template`, orgA, { name: 'Beach party' });
  const bSave = await api('POST', `/events/${ev.id}/template`, orgB, { name: 'Steal' });
  check('F', 'Save as template: 2 ticket types (Tables seated), 1 section, 2 closed seats, details kept; another organizer can’t save it',
    seatRes.status === 200 && saved.status === 201 && saved.data.ticketTypes.length === 2 && saved.data.ticketTypes.find((x) => x.name === 'Tables')?.seated === true &&
      saved.data.sections === 1 && saved.data.closedSeats === 2 && saved.data.include.details && bSave.status === 404,
    `${saved.status}: ${saved.data?.ticketTypes?.map((x) => `${x.name}${x.seated ? '*' : ''}`).join(', ')}; sections ${saved.data?.sections}; closed ${saved.data?.closedSeats}; B ${bSave.status}`);

  // G — a new draft from the template
  const start = iso(24 * 14);
  const end = iso(24 * 14 + 5);
  const use = await api('POST', `/templates/${saved.data.id}/events`, orgA, { name: `Beach party II ${tag}`, startDate: start, endDate: end });
  const made = use.data?.eventId ? await prisma.event.findUnique({ where: { id: use.data.eventId }, include: { ticketTypes: true, eventSections: true, closedSeats: true } }) : null;
  const madeTables = made?.ticketTypes.find((t) => t.name === 'Tables');
  const shift = madeTables?.salesStart ? Math.round((new Date(start) - madeTables.salesStart) / 3600e3) : null;
  const tList = await api('GET', '/templates', orgA);
  check('G', 'From the template: a draft with the new name and dates, details, 2 ticket types (Tables = 28 open seats), Front sold as Tables with 2 closed seats, sales start moved with the date (48 h before); used once',
    use.status === 201 && made?.status === 'DRAFT' && made.startDate.toISOString() === start && made.description === 'Sunset and drums' && made.rules === 'No glass' &&
      made.ticketTypes.length === 2 && madeTables?.quantityTotal === 28 && made.eventSections.length === 1 && made.closedSeats.length === 2 && shift === 48 &&
      tList.data?.find((x) => x.id === saved.data.id)?.timesUsed === 1 && use.data.skipped.sections === 0,
    `${use.status} "${use.data?.message ?? ''}" ${made?.status}; types ${made?.ticketTypes.map((t) => `${t.name}:${t.quantityTotal}`).join(',')}; sections ${made?.eventSections.length}; closed ${made?.closedSeats.length}; sales shift ${shift}h`);

  // H — sections, renames, deletes; template guards
  const del = await api('DELETE', `/organizer/venue-sections/${frontId}`, orgA);
  const barId = secId((await api('GET', `/organizer/venues/${v.id}`, orgA)).data, 'Bar side');
  const ren = await api('PATCH', `/organizer/venue-sections/${barId}`, orgA, { name: 'Bar terrace' });
  const delBar = await api('DELETE', `/organizer/venue-sections/${barId}`, orgA);
  const bUse = await api('POST', `/templates/${saved.data.id}/events`, orgB, { name: 'x', startDate: start, endDate: end });
  const badDates = await api('POST', `/templates/${saved.data.id}/events`, orgA, { name: 'x', startDate: end, endDate: start });
  const rename = await api('PATCH', `/templates/${saved.data.id}`, orgA, { name: 'Beach party (sunset)' });
  const drop = await api('DELETE', `/templates/${saved.data.id}`, orgA);
  check('H', 'Front (on sale) can’t be deleted; Bar side renamed then deleted; another organizer can’t use the template (404); end before start refused; rename and delete work',
    del.status === 400 && ren.status === 200 && ren.data.sections.some((s) => s.name === 'Bar terrace') && delBar.status === 200 && bUse.status === 404 && badDates.status === 400 && rename.status === 200 && rename.data.name === 'Beach party (sunset)' && drop.status === 200,
    `delete Front ${del.status} "${del.data?.message}"; rename ${ren.status}; delete bar ${delBar.status}; B use ${bUse.status}; dates ${badDates.status}; rename ${rename.status}; delete ${drop.status}`);

  const failed = results.filter((r) => !r.pass);
  console.log(`\n${results.length - failed.length}/${results.length} passed`);
  await prisma.$disconnect();
  process.exit(failed.length ? 1 : 0);
})().catch(async (e) => {
  console.error(e);
  await prisma.$disconnect();
  process.exit(1);
});
