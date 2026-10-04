// Phase 17 seating: venue drawings, section seats and gates, per-event
// seating, seat maps and buying seats (docs/seating.md).
// node seating-test.js   (backend running with RATE_LIMITS=off, seed data loaded)
const { PrismaClient } = require('@prisma/client');
const fs = require('fs');
const path = require('path');
const prisma = new PrismaClient();
const BASE = 'http://localhost:4000/api/v1';
const results = [];
async function api(method, p, token, body) {
  const res = await fetch(BASE + p, { method, headers: { 'Content-Type': 'application/json', ...(token ? { Authorization: `Bearer ${token}` } : {}) }, body: body ? JSON.stringify(body) : undefined });
  let data = null; try { data = await res.json(); } catch {}
  return { status: res.status, data };
}
async function upload(method, p, token, name, text) {
  const form = new FormData();
  form.append('file', new Blob([text], { type: 'image/svg+xml' }), name);
  const res = await fetch(BASE + p, { method, headers: token ? { Authorization: `Bearer ${token}` } : {}, body: form });
  let data = null; try { data = await res.json(); } catch {}
  return { status: res.status, data };
}
const login = async (email, password = 'SeedPassword123!') => (await api('POST', '/auth/login', null, { email, password })).data?.accessToken;
const check = (id, name, pass, detail) => { results.push({ id, pass }); console.log(`${pass ? 'PASS' : 'FAIL'}  ${id.padEnd(3)} ${name} — ${detail}`); };
const tag = Math.random().toString(36).slice(2, 7);
const PW = 'a-long-enough-password';
const iso = (h) => new Date(Date.now() + h * 3600e3).toISOString();
const TEMPLATE = fs.readFileSync(path.join(__dirname, '..', 'web', 'public', 'templates', 'independence-stadium.svg'), 'utf8');
const without = (svg, id) => svg.replace(new RegExp(`\\s*<path id="${id}"[^>]*/>`), '');

(async () => {
  const [admin, organizer] = await Promise.all([login('admin@example.com'), login('organizer@example.com')]);
  const cat = (await api('GET', '/categories')).data[0].id;

  // A — admin makes a venue and checks the drawing
  const venue = (await api('POST', '/venues', admin, { name: `Independence Stadium ${tag}`, address: 'Bakau', city: 'Bakau' })).data;
  const chk = await upload('POST', `/admin/venues/${venue.id}/drawing/check`, admin, 'independence-stadium.svg', TEMPLATE);
  const allNew = chk.data?.sections?.every((s) => s.status === 'new');
  check('A', 'Check a drawing: 23 sections, all new, nothing removed, cleaned SVG with section tags and no size',
    chk.status === 201 && chk.data.sections.length === 23 && allNew && chk.data.removed.length === 0 && chk.data.unnamed === 0 &&
      chk.data.svg.includes('data-bt-section="section 5a"') && chk.data.svg.includes('data-bt-map') && !/<svg[^>]* width=/.test(chk.data.svg),
    `${chk.status}, ${chk.data?.sections?.length} sections, removed ${chk.data?.removed?.length}`);

  // B — bad uploads and who may upload
  const notSvg = await upload('POST', `/admin/venues/${venue.id}/drawing/check`, admin, 'notes.txt', 'hello');
  const noGroup = await upload('POST', `/admin/venues/${venue.id}/drawing/check`, admin, 'x.svg', '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 10 10"><g id="stands"><rect id="A" width="1" height="1"/></g></svg>');
  const dup = await upload('POST', `/admin/venues/${venue.id}/drawing/check`, admin, 'x.svg', '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 10 10"><g id="sections"><rect id="A" width="1" height="1"/><rect data-name="a" width="1" height="1"/></g></svg>');
  const evil = await upload('POST', `/admin/venues/${venue.id}/drawing/check`, admin, 'x.svg', '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 10 10" onload="alert(1)"><script>alert(1)</script><g id="sections"><rect id="A" width="1" height="1" onclick="x()"/><image href="https://evil.example/x.png"/></g></svg>');
  const asOrg = await upload('POST', `/admin/venues/${venue.id}/drawing/check`, organizer, 'x.svg', TEMPLATE);
  check('B', 'Refused: not SVG, no "sections" group, two sections with one name; scripts, handlers and outside images stripped; organizers can’t upload',
    notSvg.status === 400 && noGroup.status === 400 && /sections/.test(noGroup.data?.message) && dup.status === 400 && /Two shapes/.test(dup.data?.message) &&
      evil.status === 201 && !/script|onload|onclick|evil\.example/.test(evil.data.svg) && asOrg.status === 403,
    `${notSvg.status} / ${noGroup.status} "${noGroup.data?.message}" / ${dup.status} / evil ${evil.status} / organizer ${asOrg.status}`);

  // C — save it: sections made, numbered sections get their gates
  const applied = await upload('PUT', `/admin/venues/${venue.id}/drawing`, admin, 'independence-stadium.svg', TEMPLATE);
  const d = applied.data;
  const gateName = (sec) => d.gates.find((g) => g.id === sec.gateId)?.name ?? null;
  const s = (name) => d.sections.find((x) => x.name === name);
  check('C', 'Save: 23 sections with no seats yet, Gates 1–8 made, 5A → Gate 5, 3B → Gate 3, VIP Green → none',
    applied.status === 200 && d.sections.length === 23 && d.gates.length === 8 && d.drawing?.fileName === 'independence-stadium.svg' &&
      gateName(s('Section 5A')) === 'Gate 5' && gateName(s('Section 3B')) === 'Gate 3' && gateName(s('VIP Green')) === null && d.seats === 0,
    `${applied.status}, ${d?.sections?.length} sections, gates ${d?.gates?.map((g) => g.name).join(',')}`);

  // D — section seats
  const lay = (name, body) => api('PUT', `/admin/venue-sections/${s(name).id}`, admin, body);
  const l5a = await lay('Section 5A', { rows: 10, perRow: 12, removed: ['1-6', '1-7'] });
  await lay('Section 5B', { rows: 8, perRow: 10, removed: [] });
  await lay('VIP Green', { rows: 4, perRow: 6, removed: [] });
  await lay('Section 3A', { rows: 6, perRow: 8, removed: [] });
  const other = await prisma.gate.create({ data: { venueId: (await prisma.venue.findFirst({ where: { NOT: { id: venue.id } } })).id, name: `Other ${tag}` } });
  const badGate = await lay('Section 3A', { rows: 6, perRow: 8, removed: [], gateId: other.id });
  const vipGate = await api('POST', `/admin/venues/${venue.id}/gates`, admin, { name: 'VIP entrance' });
  const setGate = await lay('VIP Green', { rows: 4, perRow: 6, removed: [], gateId: vipGate.data.id });
  const dupGate = await api('POST', `/admin/venues/${venue.id}/gates`, admin, { name: 'vip ENTRANCE' });
  check('D', 'Section seats: 5A 10 rows × 12 minus A6, A7 = 118; a gate from another venue refused; new gate "VIP entrance" set on VIP Green; same gate name twice refused',
    l5a.status === 200 && l5a.data.seats === 118 && l5a.data.rows === 10 && l5a.data.perRow === 12 && JSON.stringify(l5a.data.removed) === '["1-6","1-7"]' && l5a.data.numbering === 'letters' &&
      badGate.status === 400 && setGate.status === 200 && setGate.data.gateId === vipGate.data.id && dupGate.status === 400,
    `5A ${l5a.data?.seats}, removed ${l5a.data?.removed}; other gate ${badGate.status}; VIP gate ${setGate.status}; dup ${dupGate.status}`);

  // D2 — running numbers: row A 1–30, row B carries on 31–50
  const tail = Array.from({ length: 10 }, (_, i) => `2-${21 + i}`);
  const run = await lay('Section 6C', { rows: 2, perRow: 30, numbering: 'running', removed: tail });
  const seats6c = () => prisma.seat.findMany({ where: { sectionId: s('Section 6C').id }, select: { id: true, row: true, number: true, place: true } });
  const runSeats = await seats6c();
  const at = (list, row, number) => list.find((x) => x.row === row && x.number === String(number));
  const letters6c = await lay('Section 6C', { rows: 2, perRow: 30, numbering: 'letters', removed: tail });
  const letSeats = await seats6c();
  const runAgain = await lay('Section 6C', { rows: 2, perRow: 30, numbering: 'running', removed: tail });
  const tooManyRows = await lay('Section 6C', { rows: 30, perRow: 4, removed: [] });
  check('D2', 'Running numbers: 6C row A 1–30, row B 31–50 (50 seats, B31 in place 1); switched to each row from 1 the same seats are B1–B20; 30 rows refused',
    run.status === 200 && run.data.seats === 50 && run.data.numbering === 'running' && run.data.perRow === 30 && run.data.rows === 2 && run.data.removed.length === 10 &&
      at(runSeats, 'A', 30)?.place === 30 && at(runSeats, 'B', 31)?.place === 1 && at(runSeats, 'B', 50)?.place === 20 && !at(runSeats, 'B', 51) &&
      letters6c.status === 200 && letters6c.data.numbering === 'letters' && at(letSeats, 'B', 1)?.id === at(runSeats, 'B', 31)?.id && at(letSeats, 'B', 20)?.id === at(runSeats, 'B', 50)?.id &&
      runAgain.status === 200 && tooManyRows.status === 400,
    `${run.status}, ${run.data?.seats} seats, ${run.data?.numbering} ${run.data?.rows}×${run.data?.perRow}; B31 place ${at(runSeats, 'B', 31)?.place}; letters ${letters6c.status} B1 same seat ${at(letSeats, 'B', 1)?.id === at(runSeats, 'B', 31)?.id}; 30 rows ${tooManyRows.status}`);

  // D3 — one number per seat, no row letters
  const num = await lay('Section 6B', { rows: 12, perRow: 12, numbering: 'seats', removed: ['2-1'] });
  const seats6b = () => prisma.seat.findMany({ where: { sectionId: s('Section 6B').id }, select: { id: true, row: true, number: true, place: true } });
  const numSeats = await seats6b();
  const nums = numSeats.map((x) => Number(x.number));
  const backToLetters = await lay('Section 6B', { rows: 12, perRow: 12, numbering: 'letters', removed: ['2-1'] });
  const letSeats6b = await seats6b();
  const tallLetters = await lay('Section 6B', { rows: 40, perRow: 4, removed: [] });
  const tallSeats = await lay('Section 6B', { rows: 40, perRow: 4, numbering: 'seats', removed: [] });
  check('D3', 'Seat numbers only: 6B 12 rows of 12 = seats 1–144, place 2-1 out so 13 is missing (143 seats), rows hidden as #1…#12; switching to letters keeps the seats (14 → B2); 40 rows only without letters',
    num.status === 200 && num.data.seats === 143 && num.data.numbering === 'seats' && num.data.rows === 12 && JSON.stringify(num.data.removed) === '["2-1"]' &&
      Math.max(...nums) === 144 && !nums.includes(13) && at(numSeats, '#12', 144)?.place === 12 &&
      backToLetters.status === 200 && at(letSeats6b, 'B', 2)?.id === at(numSeats, '#2', 14)?.id && tallLetters.status === 400 && tallSeats.status === 200 && tallSeats.data.seats === 160,
    `${num.status}, ${num.data?.seats} seats, ${num.data?.numbering}; letters ${backToLetters.status}; 40 rows ${tallLetters.status}/${tallSeats.status}`);

  // D4 — rows that don't start at A, rows of their own length, 380-seat rows
  const fromD = await lay('Section 2B', { rows: 2, firstRow: 'D', perRow: 380, removed: Array.from({ length: 140 }, (_, i) => `2-${241 + i}`) });
  const seats2b = await prisma.seat.findMany({ where: { sectionId: s('Section 2B').id }, select: { row: true } });
  const pastZ = await lay('Section 2B', { rows: 4, firstRow: 'Y', perRow: 4, removed: [] });
  check('D4', '2B rows D (380 seats) and E (240): stored as D and E, read back as first row D; 4 rows from Y refused',
    fromD.status === 200 && fromD.data.seats === 620 && fromD.data.firstRow === 'D' && fromD.data.rows === 2 && [...new Set(seats2b.map((x) => x.row))].sort().join() === 'D,E' && pastZ.status === 400,
    `${fromD.status} ${fromD.data?.seats} seats from ${fromD.data?.firstRow} "${fromD.data?.message ?? ''}"; past Z ${pastZ.status}`);

  // E — an event at the venue; the organizer sees its seating
  const ev = (await api('POST', '/events', organizer, { name: `Cup Final ${tag}`, categoryId: cat, venueId: venue.id, startDate: iso(72), endDate: iso(76) })).data;
  const tt = async (name, price, quantityTotal) => (await api('POST', '/ticket-types', organizer, { eventId: ev.id, name, price, quantityTotal })).data;
  const grand = await tt('Grandstand', 25000, 1);
  const vip = await tt('VIP', 150000, 1);
  const general = await tt('General', 10000, 50);
  const seating0 = await api('GET', `/events/${ev.id}/seating`, organizer);
  check('E', 'Seating page: 23 sections, none on sale; three ticket types, highest price first, none seated',
    seating0.status === 200 && seating0.data.sections.length === 23 && seating0.data.sections.every((x) => x.ticketTypeId === null) &&
      seating0.data.ticketTypes.map((t) => t.name).join() === 'VIP,Grandstand,General' && seating0.data.ticketTypes.every((t) => !t.seated && t.canSeat) && !!seating0.data.svg,
    `${seating0.status}, ${seating0.data?.ticketTypes?.map((t) => `${t.name}:${t.tone}`).join(' ')}`);

  // F — sell sections as ticket types; close seats
  const sec = (name) => seating0.data.sections.find((x) => x.name === name);
  const put = (name, body, tok = organizer) => api('PUT', `/events/${ev.id}/seating/sections/${sec(name).id}`, tok, body);
  await put('Section 5A', { ticketTypeId: grand.id });
  await put('Section 5B', { ticketTypeId: grand.id });
  await put('VIP Green', { ticketTypeId: vip.id });
  const seats5a = (await api('GET', `/events/${ev.id}/seating/sections/${sec('Section 5A').id}`, organizer)).data;
  const seatId = (rows, label) => rows.flatMap((r) => r.seats).find((x) => x.label === label)?.id;
  const closeRes = await put('Section 5A', { ticketTypeId: grand.id, closedSeatIds: [seatId(seats5a.rows, 'A1'), seatId(seats5a.rows, 'A2')] });
  const types = closeRes.data?.ticketTypes ?? [];
  const tq = (id) => types.find((t) => t.id === id);
  check('F', 'Sold as: 5A + 5B as Grandstand = 198 seats, minus 2 closed = 196; VIP Green as VIP = 24; seated types can’t be resized by hand',
    closeRes.status === 200 && tq(grand.id)?.seats === 196 && tq(grand.id)?.seated && tq(vip.id)?.seats === 24 && closeRes.data.sections.find((x) => x.name === 'Section 5A').closed === 2,
    `${closeRes.status}, Grandstand ${tq(grand.id)?.seats}, VIP ${tq(vip.id)?.seats}`);
  const resize = await api('PATCH', `/ticket-types/${grand.id}`, organizer, { quantityTotal: 500 });
  const resizePut = resize.status === 404 ? await api('PUT', `/ticket-types/${grand.id}`, organizer, { quantityTotal: 500 }) : resize;
  const rename = await api(resize.status === 404 ? 'PUT' : 'PATCH', `/ticket-types/${grand.id}`, organizer, { name: 'Grandstand seats' });
  check('F2', 'Resizing a seated ticket type by hand is refused; renaming it is fine', resizePut.status === 400 && rename.status === 200, `${resizePut.status} "${resizePut.data?.message}", rename ${rename.status}`);

  // G — publish; buyers see the map and seats
  await api('POST', `/events/${ev.id}/publish`, organizer);
  const map = await api('GET', `/events/${ev.id}/seat-map`);
  const m5a = map.data?.sections?.find((x) => x.name === 'Section 5A');
  const m3a = map.data?.sections?.find((x) => x.name === 'Section 3A');
  const pub5a = await api('GET', `/events/${ev.id}/seat-map/sections/${sec('Section 5A').id}`);
  const own5a = await api('GET', `/events/${ev.id}/seating/sections/${sec('Section 5A').id}`, organizer);
  const st = (r, label) => r.data.rows.flatMap((row) => row.seats).find((x) => x.label === label)?.status;
  check('G', 'Seat map: drawing, 2 seated ticket types; 5A Grandstand with 116 free and Gate 5; 3A not on sale; A1 BLOCKED for buyers, CLOSED for the organizer; no A6',
    map.status === 200 && !!map.data.svg && map.data.ticketTypes.length === 2 && m5a?.ticketTypeId === grand.id && m5a?.free === 116 && m5a?.gate === 'Gate 5' &&
      m3a?.ticketTypeId === null && st(pub5a, 'A1') === 'BLOCKED' && st(own5a, 'A1') === 'CLOSED' && st(pub5a, 'A6') === undefined && pub5a.data.frontLabel === 'Stage',
    `${map.status}, types ${map.data?.ticketTypes?.length}, 5A free ${m5a?.free}, gate ${m5a?.gate}; A1 ${st(pub5a, 'A1')} / ${st(own5a, 'A1')}`);

  // G2 — a running section's grid: rows labelled with their numbers, seats placed by position
  const own6c = await api('GET', `/events/${ev.id}/seating/sections/${sec('Section 6C').id}`, organizer);
  const row2 = own6c.data?.rows?.[1];
  check('G2', 'Running section on the seat map: row B labelled "B 31–50", its first seat is B31 in place 1; 30 places per row',
    own6c.status === 200 && own6c.data.numbering === 'running' && own6c.data.perRow === 30 && row2?.row === 'B' && row2?.label === 'B 31–50' && row2?.seats[0]?.label === 'B31' && row2?.seats[0]?.col === 1 && row2?.seats.length === 20,
    `${own6c.status}, ${own6c.data?.numbering}, row ${row2?.row} "${row2?.label}", first ${row2?.seats?.[0]?.label} at ${row2?.seats?.[0]?.col}`);

  // H — buying seats
  const buyerEmail = `seat-buyer-${tag}@example.com`;
  await api('POST', '/auth/register', null, { email: buyerEmail, password: PW, fullName: 'Seat Buyer' });
  const buyer = await login(buyerEmail, PW);
  const seats5b = (await api('GET', `/events/${ev.id}/seat-map/sections/${sec('Section 5B').id}`)).data;
  const seats3a = (await api('GET', `/events/${ev.id}/seating/sections/${sec('Section 3A').id}`, organizer)).data;
  const seatsVip = (await api('GET', `/events/${ev.id}/seat-map/sections/${sec('VIP Green').id}`)).data;
  const order = (items) => api('POST', '/orders/checkout', buyer, { eventId: ev.id, provider: 'MOCK', items });
  const closedBuy = await order([{ ticketTypeId: grand.id, quantity: 1, seatIds: [seatId(seats5a.rows, 'A1')] }]);
  const offSale = await order([{ ticketTypeId: grand.id, quantity: 1, seatIds: [seatId(seats3a.rows, 'A1')] }]);
  const wrongType = await order([{ ticketTypeId: grand.id, quantity: 1, seatIds: [seatId(seatsVip.rows, 'A1')] }]);
  const gaSeat = await order([{ ticketTypeId: general.id, quantity: 1, seatIds: [seatId(seats5a.rows, 'C3')] }]);
  const noSeats = await order([{ ticketTypeId: grand.id, quantity: 1 }]);
  const good = await order([{ ticketTypeId: grand.id, quantity: 3, seatIds: [seatId(seats5a.rows, 'B1'), seatId(seats5a.rows, 'B2'), seatId(seats5b.rows, 'A1')] }]);
  const after = await api('GET', `/events/${ev.id}/seat-map/sections/${sec('Section 5A').id}`);
  const goodStatus = good.data?.order?.status ?? good.data?.status;
  check('H', 'Buying: a closed seat 409, an off-sale section 400, another type’s section 400, seats on general admission 400, no seats 400; 3 seats across 5A and 5B paid and SOLD',
    closedBuy.status === 409 && offSale.status === 400 && wrongType.status === 400 && gaSeat.status === 400 && noSeats.status === 400 &&
      good.status === 201 && goodStatus === 'PAID' && st(after, 'B1') === 'SOLD' && st(after, 'B2') === 'SOLD',
    `${closedBuy.status} ${offSale.status} ${wrongType.status} ${gaSeat.status} ${noSeats.status}; good ${good.status} ${goodStatus} "${good.data?.message ?? ''}"; B1 ${st(after, 'B1')}`);

  // I — what organizers can't change once seats are sold
  const swap = await put('Section 5A', { ticketTypeId: vip.id });
  const closeSold = await put('Section 5A', { ticketTypeId: grand.id, closedSeatIds: [seatId(seats5a.rows, 'A1'), seatId(seats5a.rows, 'B1')] });
  const offVip = await put('VIP Green', { ticketTypeId: null });
  const vipAfter = offVip.data?.ticketTypes?.find((t) => t.id === vip.id);
  const gaBuy = await order([{ ticketTypeId: general.id, quantity: 1 }]);
  const gaToSeats = await put('Section 3A', { ticketTypeId: general.id });
  const other2 = await login('organizer@example.com');
  const strangerEmail = `seat-host-${tag}@example.com`;
  const sReg = await api('POST', '/auth/register-organizer', null, { email: strangerEmail, password: PW, businessName: `Other Host ${tag}` });
  const stranger = sReg.status === 201 ? await login(strangerEmail, PW) : null;
  const strangerView = stranger ? await api('GET', `/events/${ev.id}/seating`, stranger) : { status: 'n/a' };
  check('I', 'Sold seats: 5A can’t switch ticket type, a sold seat can’t be closed; VIP Green off sale → VIP back to 0; a type with seatless sales can’t take seats; other organizers get 403',
    swap.status === 400 && closeSold.status === 400 && offVip.status === 200 && vipAfter?.seated === false && vipAfter?.seats === 0 &&
      gaBuy.status === 201 && gaToSeats.status === 400 && /without seats/.test(gaToSeats.data?.message) && strangerView.status === 403 && !!other2,
    `swap ${swap.status}, close sold ${closeSold.status}, off ${offVip.status} (VIP ${vipAfter?.seats}), GA→seats ${gaToSeats.status}, stranger ${strangerView.status}`);
  const vipType = await prisma.ticketType.findUnique({ where: { id: vip.id } });

  // J — admin seat changes keep sold seats and resize ticket types
  const shrink = await lay('Section 5A', { rows: 1, perRow: 12, removed: [] });
  const grow = await lay('Section 5A', { rows: 12, perRow: 12, removed: ['1-6', '1-7'] });
  const grandNow = await prisma.ticketType.findUnique({ where: { id: grand.id } });
  check('J', 'Admin seats: shrinking 5A past sold B1/B2 refused; growing it to 12 rows lifts Grandstand to 220 (142 + 80 − 2 closed)',
    shrink.status === 400 && /B1/.test(shrink.data?.message) && grow.status === 200 && grandNow.quantityTotal === 220 && vipType.quantityTotal === 0,
    `${shrink.status} "${shrink.data?.message}"; grow ${grow.status}; Grandstand ${grandNow.quantityTotal}`);

  // J2 — sold seats keep their numbers
  const renumberSold = await lay('Section 5A', { rows: 12, perRow: 12, numbering: 'running', removed: ['1-6', '1-7'] });
  check('J2', 'Switching 5A to running numbers is refused: sold B1 and B2 would become B11 and B12',
    renumberSold.status === 400 && /B1, B2 have tickets\. Their numbers can.t change/.test(renumberSold.data?.message),
    `${renumberSold.status} "${renumberSold.data?.message}"`);

  // K — re-uploading drawings
  const drop5a = await upload('POST', `/admin/venues/${venue.id}/drawing/check`, admin, 'v2.svg', without(TEMPLATE, 'Section_5A'));
  const drop5aSave = await upload('PUT', `/admin/venues/${venue.id}/drawing`, admin, 'v2.svg', without(TEMPLATE, 'Section_5A'));
  const drop8b = await upload('PUT', `/admin/venues/${venue.id}/drawing`, admin, 'v3.svg', without(TEMPLATE, 'Section_8B'));
  const back = await upload('POST', `/admin/venues/${venue.id}/drawing/check`, admin, 'v4.svg', TEMPLATE);
  const kept5a = drop8b.data?.sections?.find((x) => x.name === 'Section 5A');
  check('K', 'Re-upload: dropping 5A (sold) is flagged and refused; dropping 8B (unused) works and keeps 5A’s seats; adding 8B back shows it as new',
    drop5a.status === 201 && /tickets sold/.test(drop5a.data.removed[0]?.keepReason ?? '') && drop5aSave.status === 400 &&
      drop8b.status === 200 && drop8b.data.sections.length === 22 && kept5a?.seats === 142 &&
      back.data?.sections?.find((x) => x.name === 'Section 8B')?.status === 'new' && back.data.sections.filter((x) => x.status === 'match').length === 22,
    `check ${drop5a.status} "${drop5a.data?.removed?.[0]?.keepReason}"; save ${drop5aSave.status}; drop 8B ${drop8b.status} → ${drop8b.data?.sections?.length}; 5A ${kept5a?.seats}`);

  // L — the rest: venue move refused, gate on tickets, admin list, front label, drafts hidden
  const move = await api('PUT', `/events/${ev.id}`, organizer, { venueId: (await prisma.venue.findFirst({ where: { NOT: { id: venue.id } } })).id });
  const mine = await api('GET', '/tickets/mine', buyer);
  const seatTicket = (mine.data ?? []).find((t) => t.seat && t.ticketType?.eventId === ev.id) ?? (mine.data ?? []).find((t) => t.seat);
  const list = await api('GET', '/admin/venues', admin);
  const row = list.data?.find((v) => v.id === venue.id);
  const front = await api('PATCH', `/admin/venues/${venue.id}`, admin, { frontLabel: 'Pitch' });
  const map2 = await api('GET', `/events/${ev.id}/seat-map/sections/${sec('Section 5B').id}`);
  const draft = (await api('POST', '/events', organizer, { name: `Draft ${tag}`, categoryId: cat, venueId: venue.id, startDate: iso(100), endDate: iso(104) })).data;
  const draftMap = await api('GET', `/events/${draft.id}/seat-map`);
  check('L', 'Moving the event to another venue refused; tickets carry their gate; admin list shows the venue with a drawing; front label "Pitch" shows on seat grids; drafts’ maps are hidden',
    move.status === 400 && seatTicket?.seat?.section?.gate?.name === 'Gate 5' && row?.hasDrawing && row?.sections === 22 && row?.upcomingEvents === 1 &&
      front.status === 200 && map2.data?.frontLabel === 'Pitch' && draftMap.status === 404,
    `move ${move.status}; gate ${seatTicket?.seat?.section?.gate?.name}; list ${row?.sections} sections, ${row?.seats} seats, ${row?.upcomingEvents} events; front ${map2.data?.frontLabel}; draft ${draftMap.status}`);

  const failed = results.filter((r) => !r.pass);
  console.log(`\n${results.length - failed.length}/${results.length} passed`);
  await prisma.$disconnect();
  process.exit(failed.length ? 1 : 0);
})().catch(async (e) => {
  console.error(e);
  await prisma.$disconnect();
  process.exit(1);
});
