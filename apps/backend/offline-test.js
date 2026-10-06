// Phase 21 offline scanning (docs/scanner.md, "Offline"): the ticket list a
// gate phone keeps, sending scans made without signal, a ticket let in at
// two gates without signal, a refund the phone didn't know about, sending
// twice, the organizer's "Gate phones", and who may sync.
// node offline-test.js   (backend running with RATE_LIMITS=off, seed data loaded)
const { PrismaClient } = require('@prisma/client');
const { randomBytes, createHash } = require('crypto');
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
const uniq = (t) => `offline-${t}-${Date.now()}-${tag}@example.com`;
const PW = 'a-long-enough-password';
const iso = (h) => new Date(Date.now() + h * 3600e3).toISOString();

async function mint(ticketTypeId, ownerId, seatId = null) {
  const token = randomBytes(32).toString('hex');
  await prisma.ticket.create({ data: { ticketTypeId, ownerId, seatId, qrCredentialHash: createHash('sha256').update(token).digest('hex'), status: 'ACTIVE' } });
  return token;
}

(async () => {
  // Setup: an approved, trusted host; their venue with North (Gate 1) and South (Gate 2); an event starting in an hour
  const reg = await api('POST', '/auth/register-organizer', null, { email: uniq('host'), password: PW, businessName: `Offline Host ${tag}` });
  await prisma.organizer.update({ where: { id: reg.data.organizer.id }, data: { verificationStatus: 'APPROVED', trustLevel: 'TRUSTED' } });
  const host = reg.data.accessToken;
  const v = (await api('POST', '/organizer/venues', host, { name: `Offline Park ${tag}`, address: 'Serrekunda', city: 'Serrekunda' })).data;
  const g1 = (await api('POST', `/organizer/venues/${v.id}/gates`, host, { name: 'Gate 1' })).data;
  const g2 = (await api('POST', `/organizer/venues/${v.id}/gates`, host, { name: 'Gate 2' })).data;
  const after = (await api('POST', `/organizer/venues/${v.id}/sections`, host, { name: 'North' })).data;
  await api('POST', `/organizer/venues/${v.id}/sections`, host, { name: 'South' });
  const secs = (await api('GET', `/organizer/venues/${v.id}`, host)).data.sections;
  const north = secs.find((s) => s.name === 'North').id;
  const south = secs.find((s) => s.name === 'South').id;
  await api('PUT', `/organizer/venue-sections/${north}`, host, { rows: 1, perRow: 10, removed: [], gateId: g1.id });
  await api('PUT', `/organizer/venue-sections/${south}`, host, { rows: 1, perRow: 10, removed: [], gateId: g2.id });
  const cat = (await api('GET', '/categories')).data[0].id;
  const ev = (await api('POST', '/events', host, { name: `Offline Night ${tag}`, categoryId: cat, venueId: v.id, startDate: iso(1), endDate: iso(5) })).data;
  const seated = (await api('POST', '/ticket-types', host, { eventId: ev.id, name: 'Seated', price: 30000, quantityTotal: 20 })).data;
  const terrace = (await api('POST', '/ticket-types', host, { eventId: ev.id, name: 'Terrace', price: 15000, quantityTotal: 100 })).data;
  await api('PUT', `/events/${ev.id}/seating/sections/${north}`, host, { ticketTypeId: seated.id, closedSeatIds: [] });
  await api('POST', `/events/${ev.id}/publish`, host);

  const buyer = (await api('POST', '/auth/register', null, { email: uniq('buyer'), password: PW, fullName: 'Awa Jallow' })).data;
  const seats = await prisma.seat.findMany({ where: { sectionId: north }, orderBy: { number: 'asc' } });
  const t = [];
  for (let i = 0; i < 6; i++) t.push(await mint(seated.id, buyer.user.id, seats[i].id));
  const s1 = await mint(terrace.id, buyer.user.id);
  const s2 = await mint(terrace.id, buyer.user.id);
  const s3 = await mint(terrace.id, buyer.user.id);

  // Staff: one at the door, one manager
  const staffEmail = uniq('door'); const mgrEmail = uniq('mgr');
  await api('POST', `/events/${ev.id}/staff`, host, { email: staffEmail, role: 'GATE_STAFF', fullName: 'Lamin Door', password: PW });
  await api('POST', `/events/${ev.id}/staff`, host, { email: mgrEmail, role: 'MANAGER', fullName: 'Isatou Boss', password: PW });
  const door = await login(staffEmail, PW);
  const mgr = await login(mgrEmail, PW);
  const scan = (tok, qrToken, gateId, extra = {}) => api('POST', '/check-ins', tok, { qrToken, eventId: ev.id, ...(gateId ? { gateId } : {}), ...extra });

  const h = (tok) => createHash('sha256').update(tok).digest('hex');
  const { randomUUID } = require('crypto');
  const sync = (tok, body) => api('POST', `/scanner/events/${ev.id}/sync`, tok, { deviceId: body.deviceId ?? 'phone-door-1', platform: 'test', scans: [], ...body });
  const at = (minAgo) => new Date(Date.now() - minAgo * 60_000).toISOString();

  // A — the first sync: the whole list, no names, no QR codes; rules for deciding without signal
  await new Promise((r) => setTimeout(r, 6000)); // so the delta in B doesn't overlap the tickets made above
  const a = await sync(door, { gateId: g2.id });
  const row = a.data?.tickets?.find((x) => x.h === h(t[0]));
  const terraceRow = a.data?.tickets?.find((x) => x.h === h(s1));
  const raw = JSON.stringify(a.data ?? {});
  check('A', 'First sync: all 9 tickets with hash, status, type, seat and gate; no names or QR codes; event rules included',
    a.status === 201 && a.data.full === true && a.data.tickets.length === 9 && row?.s === 'A' && row.st?.[0] === 'North' && a.data.gates[row.g[0]].name === 'Gate 1' && !terraceRow.g &&
    !raw.includes('Awa Jallow') && !raw.includes(t[0]) && a.data.event.wrongGate === 'send' && a.data.event.canLetInAnyGate === false && !!a.data.event.opensAt,
    `${a.status}; ${a.data?.tickets?.length} tickets; seat ${row?.st}; gate ${row && a.data.gates[row.g[0]].name}; names leaked ${raw.includes('Awa Jallow')}`);

  // B — online scan elsewhere, then a delta sync carries it (and nothing else)
  await scan(mgr, t[1], g1.id);
  const b = await sync(door, { gateId: g2.id, since: a.data.serverTime });
  check('B', 'Delta sync: only what changed; the other gate’s scan is in "used" with where and when',
    b.status === 201 && b.data.full === false && b.data.used.some((u) => u.h === h(t[1]) && u.gate === 'Gate 1') && b.data.tickets.length <= 1,
    `full ${b.data?.full}; tickets ${b.data?.tickets?.length}; used ${JSON.stringify(b.data?.used?.map((u) => u.gate))}`);

  // C — scans made without signal: one let in, one refused at the wrong gate; both logged as offline with the phone's time
  const c1 = randomUUID(); const c2 = randomUUID();
  const c = await sync(door, { gateId: g2.id, pending: 0, scans: [
    { id: c1, h: h(s1), gateId: g2.id, at: at(10), result: 'VALID', letIn: true },
    { id: c2, h: h(t[2]), gateId: g2.id, at: at(9), result: 'WRONG_GATE', letIn: false },
  ] });
  const r1 = await prisma.checkIn.findUnique({ where: { clientScanId: c1 } });
  const r2 = await prisma.checkIn.findUnique({ where: { clientScanId: c2 } });
  const s1t = await prisma.ticket.findFirst({ where: { qrCredentialHash: h(s1) } });
  check('C', 'Offline scans sent: let in → ticket USED, VALID at the phone’s time; wrong gate logged, ticket still ACTIVE',
    c.data?.accepted?.length === 2 && r1?.result === 'VALID' && r1.offline && r1.letIn && Math.abs(r1.scannedAt - new Date(at(10))) < 5000 && s1t.status === 'USED' && r2?.result === 'WRONG_GATE' && r2.letIn === false && c.data.conflicts.length === 0,
    `accepted ${c.data?.accepted?.length}; ${r1?.result} offline ${r1?.offline}; ticket ${s1t.status}; ${r2?.result}`);

  // D — sending the same scans again changes nothing
  const d = await sync(door, { gateId: g2.id, scans: [{ id: c1, h: h(s1), gateId: g2.id, at: at(10), result: 'VALID', letIn: true }] });
  const dCount = await prisma.checkIn.count({ where: { ticketId: s1t.id } });
  check('D', 'Sending again is harmless: accepted, still one scan for that ticket, no conflict',
    d.data?.accepted?.[0] === c1 && dCount === 1 && d.data.conflicts.length === 0, `scans ${dCount}`);

  // E — two phones without signal let the same ticket in: the second is a conflict on both the phone and the organizer's list
  const e1 = randomUUID(); const e2 = randomUUID();
  await sync(mgr, { deviceId: 'phone-mgr-1', gateId: g1.id, scans: [{ id: e1, h: h(s2), gateId: g1.id, at: at(6), result: 'VALID', letIn: true }] });
  const e = await sync(door, { gateId: g2.id, scans: [{ id: e2, h: h(s2), gateId: g2.id, at: at(4), result: 'VALID', letIn: true }] });
  const eRow = await prisma.checkIn.findUnique({ where: { clientScanId: e2 } });
  check('E', 'Let in twice without signal: second one logged ALREADY_USED + letIn; the phone is told, with the first gate',
    eRow?.result === 'ALREADY_USED' && eRow.letIn === true && e.data.conflicts.length === 1 && e.data.conflicts[0].reason === 'twice' && e.data.conflicts[0].first?.gate === 'Gate 1' && e.data.conflicts[0].gate === 'Gate 2',
    `${eRow?.result}; conflict ${JSON.stringify(e.data?.conflicts?.[0] && { r: e.data.conflicts[0].reason, first: e.data.conflicts[0].first?.gate, at: e.data.conflicts[0].gate })}`);

  // F — refunded while the phone had no signal: let in anyway → flagged "refunded"
  const s3t = await prisma.ticket.findFirst({ where: { qrCredentialHash: h(s3) } });
  await prisma.ticket.update({ where: { id: s3t.id }, data: { status: 'REFUNDED' } });
  const f1 = randomUUID();
  const f = await sync(door, { gateId: g2.id, since: b.data.serverTime, scans: [{ id: f1, h: h(s3), gateId: g2.id, at: at(2), result: 'VALID', letIn: true }] });
  const fRow = f.data?.tickets?.find((x) => x.h === h(s3));
  check('F', 'Refunded before the phone knew: logged REFUNDED + letIn, conflict "refunded"; the next list says R',
    f.data?.conflicts?.[0]?.reason === 'refunded' && fRow?.s === 'R', `conflict ${f.data?.conflicts?.[0]?.reason}; list ${fRow?.s}`);

  // G — the organizer's Gate phones: both phones, their gates, waiting counts, and the let-in-twice list
  await sync(door, { gateId: g2.id, pending: 3, since: f.data.serverTime });
  const gp = await api('GET', `/events/${ev.id}/gate-phones`, host);
  const doorPhone = gp.data?.phones?.find((p) => p.gate === 'Gate 2');
  const twice = gp.data?.letInTwice?.find((x) => x.reason === 'twice');
  check('G', 'Gate phones: 2 phones with gate, waiting 3 and contact time; 2 problems listed with holder, first and again',
    gp.status === 200 && gp.data.phones.length === 2 && doorPhone?.staff === 'Lamin Door' && doorPhone.pending === 3 && doorPhone.quietFor === 0 && gp.data.waiting === 3 &&
    gp.data.letInTwice.length === 2 && twice?.ticket.holder === 'Awa Jallow' && twice.first?.gate === 'Gate 1' && twice.first.by === 'Isatou Boss' && twice.again.gate === 'Gate 2' && twice.again.by === 'Lamin Door',
    `${gp.status}; phones ${gp.data?.phones?.length}; waiting ${gp.data?.waiting}; problems ${gp.data?.letInTwice?.length}; ${JSON.stringify(twice?.first)}`);

  // H — who may sync and see: other staff 403, customers 403, gate staff can't see Gate phones; a bad clock becomes "now"
  const strangerEmail = uniq('stranger');
  await prisma.user.create({ data: { email: strangerEmail, passwordHash: (await prisma.user.findFirst({ where: { email: staffEmail } })).passwordHash, role: 'STAFF', fullName: 'Not Here' } });
  const stranger = await login(strangerEmail, PW);
  const hs = await sync(stranger, {});
  const hc = await sync(buyer.accessToken, {});
  const hg = await api('GET', `/events/${ev.id}/gate-phones`, door);
  const h1 = randomUUID();
  await sync(door, { gateId: g2.id, scans: [{ id: h1, h: h(t[3]), gateId: g2.id, at: '2020-01-01T00:00:00.000Z', result: 'WRONG_GATE', letIn: false }] });
  const hRow = await prisma.checkIn.findUnique({ where: { clientScanId: h1 } });
  check('H', 'Unassigned staff 403, customer 403, gate staff can’t see Gate phones; a 2020 timestamp is saved as now',
    hs.status === 403 && hc.status === 403 && hg.status === 403 && Date.now() - hRow.scannedAt < 60_000,
    `stranger ${hs.status}, customer ${hc.status}, door→phones ${hg.status}; saved ${hRow?.scannedAt?.toISOString()}`);

  const passed = results.filter((r) => r.pass).length;
  console.log(`\n${passed}/${results.length} passed`);
  await prisma.$disconnect();
  process.exit(passed === results.length ? 0 : 1);
})();
