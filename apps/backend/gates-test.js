// Phase 19 gate checks (docs/scanner.md, "Gate checks"): wrong gate, a
// manager letting them in, standing tickets' gates, "let them in" events,
// gates open time and the organizer's live gate numbers.
// node gates-test.js   (backend running with RATE_LIMITS=off, seed data loaded)
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
const uniq = (t) => `gates-${t}-${Date.now()}-${tag}@example.com`;
const PW = 'a-long-enough-password';
const iso = (h) => new Date(Date.now() + h * 3600e3).toISOString();

async function mint(ticketTypeId, ownerId, seatId = null) {
  const token = randomBytes(32).toString('hex');
  await prisma.ticket.create({ data: { ticketTypeId, ownerId, seatId, qrCredentialHash: createHash('sha256').update(token).digest('hex'), status: 'ACTIVE' } });
  return token;
}

(async () => {
  // Setup: an approved, trusted host; their venue with North (Gate 1) and South (Gate 2); an event starting in an hour
  const reg = await api('POST', '/auth/register-organizer', null, { email: uniq('host'), password: PW, businessName: `Gate Host ${tag}` });
  await prisma.organizer.update({ where: { id: reg.data.organizer.id }, data: { verificationStatus: 'APPROVED', trustLevel: 'TRUSTED' } });
  const host = reg.data.accessToken;
  const v = (await api('POST', '/organizer/venues', host, { name: `Gate Park ${tag}`, address: 'Serrekunda', city: 'Serrekunda' })).data;
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
  const ev = (await api('POST', '/events', host, { name: `Gate Night ${tag}`, categoryId: cat, venueId: v.id, startDate: iso(1), endDate: iso(5) })).data;
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

  // A — a North (Gate 1) ticket at Gate 2: sent to Gate 1; the ticket still works
  const a = await scan(door, t[0], g2.id);
  const aTicket = await prisma.ticket.findFirst({ where: { qrCredentialHash: createHash('sha256').update(t[0]).digest('hex') } });
  const aRow = await prisma.checkIn.findFirst({ where: { ticketId: aTicket.id }, orderBy: { scannedAt: 'desc' } });
  check('A', 'Seated ticket at the wrong gate: WRONG_GATE, sent to Gate 1, ticket still ACTIVE, logged with its gate',
    a.status === 201 && a.data.result === 'WRONG_GATE' && a.data.expectedGates?.[0]?.name === 'Gate 1' && aTicket.status === 'ACTIVE' && aRow.expectedGateId === g1.id && aRow.result === 'WRONG_GATE',
    `${a.data?.result} → ${a.data?.expectedGates?.map((g) => g.name)}; ticket ${aTicket.status}; row expected ${aRow?.expectedGateId === g1.id}`);

  // B — "Let in here": gate staff refused, the manager can, and it's noted
  const bDoor = await scan(door, t[0], g2.id, { override: true });
  const bMgr = await scan(mgr, t[0], g2.id, { override: true });
  const bRow = await prisma.checkIn.findFirst({ where: { ticketId: aTicket.id, result: 'VALID' } });
  check('B', 'Let in here: gate staff 403; manager VALID marked override with their own gate',
    bDoor.status === 403 && bMgr.data?.result === 'VALID' && bMgr.data.override === true && bMgr.data.atOtherGate === true && bRow?.override === true && bRow.expectedGateId === g1.id,
    `door ${bDoor.status}; manager ${bMgr.data?.result} override ${bMgr.data?.override}; row ${bRow?.override}`);

  // C — the right gate, and no gate at all
  const c1 = await scan(door, t[1], g1.id);
  const c2 = await scan(host, t[2], null);
  check('C', 'Right gate → VALID showing Gate 1; scanning with no gate skips the check',
    c1.data?.result === 'VALID' && c1.data.atOtherGate === false && c1.data.expectedGates[0].name === 'Gate 1' && c2.data?.result === 'VALID',
    `right ${c1.data?.result}; no gate ${c2.data?.result}`);

  // D — standing tickets: any gate until given gates; then only theirs
  const d0 = await scan(door, s1, g1.id);
  const setG = await api('PUT', `/ticket-types/${terrace.id}/gates`, host, { gateIds: [g2.id] });
  const d1 = await scan(door, s2, g1.id);
  const d2 = await scan(door, s2, g2.id);
  const seatedGates = await api('PUT', `/ticket-types/${seated.id}/gates`, host, { gateIds: [g2.id] });
  const otherVenueGate = (await prisma.gate.findFirst({ where: { venueId: { not: v.id } } }))?.id;
  const foreign = await api('PUT', `/ticket-types/${terrace.id}/gates`, host, { gateIds: [otherVenueGate] });
  check('D', 'Standing: any gate at first; with Gate 2 set, Gate 1 sends them to Gate 2 and Gate 2 lets in; gates on a seated type or another venue’s gate refused',
    d0.data?.result === 'VALID' && setG.status === 200 && setG.data.ticketTypes.find((x) => x.id === terrace.id).gateIds[0] === g2.id &&
      d1.data?.result === 'WRONG_GATE' && d1.data.expectedGates[0].name === 'Gate 2' && d2.data?.result === 'VALID' && seatedGates.status === 400 && foreign.status === 400,
    `before ${d0.data?.result}; set ${setG.status}; Gate 1 ${d1.data?.result}; Gate 2 ${d2.data?.result}; seated ${seatedGates.status}; foreign ${foreign.status}`);

  // E — "let them in, tell them their gate"
  const rule = await api('PUT', `/events/${ev.id}/gate-rules`, host, { wrongGate: 'allow', gatesOpenAt: null });
  const e1 = await scan(door, t[3], g2.id);
  check('E', 'Event set to "allow": the wrong gate lets them in, says their gate, counts as let in at another gate',
    rule.status === 200 && rule.data.wrongGate === 'allow' && e1.data?.result === 'VALID' && e1.data.atOtherGate === true && e1.data.override === false && e1.data.expectedGates[0].name === 'Gate 1',
    `rule ${rule.status} ${rule.data?.wrongGate}; scan ${e1.data?.result} other ${e1.data?.atOtherGate}`);

  // F — gates open time
  const later = await api('PUT', `/events/${ev.id}/gate-rules`, host, { wrongGate: 'send', gatesOpenAt: iso(0.5) });
  const f1 = await scan(door, t[4], g1.id);
  const tooLate = await api('PUT', `/events/${ev.id}/gate-rules`, host, { wrongGate: 'send', gatesOpenAt: iso(6) });
  const sooner = await api('PUT', `/events/${ev.id}/gate-rules`, host, { wrongGate: 'send', gatesOpenAt: iso(-0.5) });
  const f2 = await scan(door, t[4], g1.id);
  check('F', 'Gates open in 30 minutes: WRONG_DATE with the time; after the end refused; opened → VALID',
    later.status === 200 && f1.data?.result === 'WRONG_DATE' && !!f1.data.gatesOpenAt && tooLate.status === 400 && sooner.status === 200 && f2.data?.result === 'VALID',
    `set ${later.status}; early ${f1.data?.result} ${f1.data?.gatesOpenAt ? 'with time' : 'no time'}; after end ${tooLate.status}; open ${f2.data?.result}`);

  // G — live gate numbers for the organizer only
  const stats = await api('GET', `/events/${ev.id}/gate-stats`, host);
  const gs = (n) => stats.data?.gates.find((g) => g.name === n);
  const otherHost = await login('organizer@example.com');
  const nosy = await api('GET', `/events/${ev.id}/gate-stats`, otherHost);
  const doorStats = await api('GET', `/events/${ev.id}/gate-stats`, door);
  check('G', 'Gate numbers: Gate 1 in 3, Gate 2 in 3 (1 by a manager, 1 allowed), sent away 2, no-gate 1; other organizer and staff refused',
    stats.status === 200 && gs('Gate 1').in === 3 && gs('Gate 2').in === 3 && gs('Gate 2').sentAway === 1 && gs('Gate 1').sentAway === 1 && stats.data.noGate.in === 1 &&
      stats.data.totals.letInOther === 2 && stats.data.totals.byManager === 1 && gs('Gate 1').perMinute > 0 && nosy.status === 403 && doorStats.status === 403,
    `G1 ${JSON.stringify(gs('Gate 1'))}; G2 ${JSON.stringify(gs('Gate 2'))}; none ${stats.data?.noGate.in}; totals ${JSON.stringify(stats.data?.totals)}; other ${nosy.status}; staff ${doorStats.status}`);

  // H — the scanner's event list: what each gate serves, the rule, who can let in anywhere
  const mgrEvents = (await api('GET', '/scanner/events', mgr)).data;
  const doorEvents = (await api('GET', '/scanner/events', door)).data;
  const me = mgrEvents.find((x) => x.id === ev.id);
  const de = doorEvents.find((x) => x.id === ev.id);
  const g2serves = me?.venue.gates.find((g) => g.name === 'Gate 2')?.serves ?? [];
  check('H', 'Scanner list: Gate 2 serves South and Terrace; rule and opening time sent; manager can let in anywhere, gate staff not',
    g2serves.includes('South') && g2serves.includes('Terrace') && me.wrongGate === 'send' && !!me.gatesOpenAt && me.canLetInAnyGate === true && de.canLetInAnyGate === false,
    `serves ${g2serves}; rule ${me?.wrongGate}; manager ${me?.canLetInAnyGate}; door ${de?.canLetInAnyGate}`);

  // I — My tickets shows a standing ticket's gate
  const mine = (await api('GET', '/tickets/mine', buyer.accessToken)).data;
  const terraceTicket = mine.find((x) => x.ticketType.id === terrace.id);
  check('I', 'My tickets: a Terrace ticket carries its gates (Gate 2) and the event its opening time',
    terraceTicket?.ticketType.gates?.[0]?.gate.name === 'Gate 2' && !!terraceTicket.ticketType.event.gatesOpenAt,
    `${JSON.stringify(terraceTicket?.ticketType.gates)} opens ${terraceTicket?.ticketType.event.gatesOpenAt}`);

  // J — the rest of the pipeline is unchanged: used ticket at the wrong gate says "already scanned"
  const j = await scan(door, t[1], g2.id);
  check('J', 'A used ticket at the wrong gate still says ALREADY_USED (status comes first)', j.data?.result === 'ALREADY_USED', j.data?.result);

  const passed = results.filter((r) => r.pass).length;
  console.log(`\n${passed}/${results.length} passed`);
  await prisma.$disconnect();
  process.exit(passed === results.length ? 0 : 1);
})();
