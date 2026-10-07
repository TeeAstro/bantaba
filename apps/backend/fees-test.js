// Phase 20 booking fee (docs/payments.md, "Booking fee"): Bantaba's fee per
// order, per ticket or a percentage; free tickets never pay; hosts with
// their own fee; guardrails; the public fee for the event page.
// Phase 20b: deals for one event, deals that end, hosts who include the fee
// in their prices, the fee on buyers' refunds, and the earnings report.
// node fees-test.js   (backend running with RATE_LIMITS=off, seed data loaded)
// Puts back whatever fee was set before it ran.
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
const uniq = (t) => `fees-${t}-${Date.now()}-${tag}@example.com`;
const PW = 'a-long-enough-password';
const iso = (h) => new Date(Date.now() + h * 3600e3).toISOString();

(async () => {
  const saved = await prisma.feeRule.findMany();
  try {
    await prisma.feeRule.deleteMany();
    const admin = await login('admin@example.com');
    const venue = (await api('GET', '/venues')).data.find((v) => !v.ownerId) ?? (await api('GET', '/venues')).data[0];
    const cat = (await api('GET', '/categories')).data[0].id;
    const host = async (name) => {
      const reg = await api('POST', '/auth/register-organizer', null, { email: uniq(name.replace(/\s+/g, '').toLowerCase()), password: PW, businessName: `${name} ${tag}` });
      await prisma.organizer.update({ where: { id: reg.data.organizer.id }, data: { verificationStatus: 'APPROVED', trustLevel: 'TRUSTED' } });
      return { token: reg.data.accessToken, id: reg.data.organizer.id };
    };
    const event = async (h, name) => {
      const ev = (await api('POST', '/events', h.token, { name: `${name} ${tag}`, categoryId: cat, venueId: venue.id, startDate: iso(72), endDate: iso(76), refundPolicy: 'ANYTIME' })).data;
      const tt = async (n, price) => (await api('POST', '/ticket-types', h.token, { eventId: ev.id, name: n, price, quantityTotal: 200 })).data;
      const types = { free: await tt('Free', 0), cheap: await tt('Regular', 25000), dear: await tt('VIP', 300000) };
      await api('POST', `/events/${ev.id}/publish`, h.token);
      return { ...ev, types };
    };
    const a = await host('Fee Host A');
    const b = await host('Fee Host B');
    const evA = await event(a, 'Fee Night A');
    const evB = await event(b, 'Fee Night B');
    const buyer = async () => (await api('POST', '/auth/register', null, { email: uniq('buyer'), password: PW, fullName: 'Fee Buyer' })).data.accessToken;
    const order = async (ev, items) => (await api('POST', '/orders/checkout', await buyer(), { eventId: ev.id, items: items.map(([t, q]) => ({ ticketTypeId: ev.types[t].id, quantity: q })) })).data;
    // Paid at once (mock provider), returning the buyer's token too.
    const paid = async (ev, items) => {
      const tok = await buyer();
      const o = (await api('POST', '/orders/checkout', tok, { eventId: ev.id, provider: 'MOCK', items: items.map(([t, q]) => ({ ticketTypeId: ev.types[t].id, quantity: q })) })).data;
      const id = (o.order ?? o).id;
      return { tok, id, order: await prisma.ticketOrder.findUnique({ where: { id }, include: { tickets: true } }) };
    };
    const feeOf = (o) => (o.order ?? o).platformFee;

    // A — nothing saved yet: D50 per order from the environment; free-only orders pay none
    const a1 = await order(evA, [['cheap', 2]]);
    const a2 = await order(evA, [['free', 2]]);
    const view0 = await api('GET', '/admin/fees', admin);
    check('A', 'Before any change: D50 per order (environment); an order of free tickets pays no fee; admin page says so',
      feeOf(a1) === 5000 && feeOf(a2) === 0 && view0.data.fee.summary === 'D50 per order' && view0.data.lastChanged === null,
      `paid ${feeOf(a1)}, free ${feeOf(a2)}; page "${view0.data?.fee.summary}"`);

    // B — per ticket D25: only paid tickets count; logged
    const setB = await api('PUT', '/admin/fees', admin, { kind: 'ticket', amount: 2500 });
    const b1 = await order(evA, [['cheap', 3], ['free', 1]]);
    const audit = await prisma.auditLog.findFirst({ where: { action: 'fee_changed' }, orderBy: { createdAt: 'desc' } });
    check('B', 'D25 per ticket: 3 paid + 1 free → D75; summary and "last changed" shown; audit log has from/to',
      setB.status === 200 && feeOf(b1) === 7500 && setB.data.fee.summary === 'D25 per ticket' && !!setB.data.lastChanged?.at && audit?.metadata?.from === 'D50 per order' && audit.metadata.to === 'D25 per ticket',
      `${setB.status}; fee ${feeOf(b1)}; "${setB.data?.fee.summary}"; audit ${JSON.stringify(audit?.metadata)}`);

    // C — percentage + flat, with a cap per ticket
    const setC = await api('PUT', '/admin/fees', admin, { kind: 'pct', amount: 1000, percentBp: 500, cap: 10000 });
    const c1 = await order(evA, [['cheap', 2]]);
    const c2 = await order(evA, [['dear', 1]]);
    check('C', '5% + D10, at most D100 a ticket: 2 × D250 → D45; 1 × D3,000 → D100 (capped)',
      setC.status === 200 && feeOf(c1) === 4500 && feeOf(c2) === 10000 && setC.data.fee.summary === '5% + D10 per ticket, at most D100 a ticket',
      `${feeOf(c1)}, ${feeOf(c2)}; "${setC.data?.fee.summary}"`);

    // D — a host with no fee, and one with their own per-ticket fee
    const noFee = await api('PUT', `/admin/fees/hosts/${a.id}`, admin, { kind: 'none', amount: 0, note: 'federation matches' });
    const own = await api('PUT', `/admin/fees/hosts/${b.id}`, admin, { kind: 'ticket', amount: 2000 });
    const d1 = await order(evA, [['cheap', 2]]);
    const d2 = await order(evB, [['cheap', 2]]);
    check('D', 'Host A no fee → D0; host B D20 per ticket → D40; both listed with their note',
      noFee.status === 200 && own.status === 200 && feeOf(d1) === 0 && feeOf(d2) === 4000 && own.data.deals.length === 2 && own.data.deals.find((h) => h.organizer?.id === a.id)?.note === 'federation matches',
      `A ${feeOf(d1)}, B ${feeOf(d2)}; deals ${own.data?.deals.length}`);

    // E — back to Bantaba's fee; orders already placed keep theirs
    const rm = await api('DELETE', `/admin/fees/hosts/${a.id}`, admin);
    const rm2 = await api('DELETE', `/admin/fees/hosts/${a.id}`, admin);
    const e1 = await order(evA, [['cheap', 2]]);
    const kept = await prisma.ticketOrder.findUnique({ where: { id: (a1.order ?? a1).id } });
    check('E', 'Removing host A’s fee → Bantaba’s again (D45); removing twice 404; the first order still has D50',
      rm.status === 200 && rm2.status === 404 && feeOf(e1) === 4500 && kept.platformFee === 5000,
      `rm ${rm.status}/${rm2.status}; fee ${feeOf(e1)}; first order ${kept?.platformFee}`);

    // F — guardrails and who can change it
    const tooMuch = await api('PUT', '/admin/fees', admin, { kind: 'order', amount: 60000 });
    const tooPct = await api('PUT', '/admin/fees', admin, { kind: 'pct', amount: 0, percentBp: 2500 });
    const noneGlobal = await api('PUT', '/admin/fees', admin, { kind: 'none', amount: 0 });
    const orgTry = await api('PUT', '/admin/fees', a.token, { kind: 'order', amount: 0 });
    const orgSee = await api('GET', '/admin/fees', a.token);
    check('F', 'Over D500 or 20% refused; "none" only for a host; organizers can’t see or change fees',
      tooMuch.status === 400 && tooPct.status === 400 && noneGlobal.status === 400 && orgTry.status === 403 && orgSee.status === 403,
      `${tooMuch.status} ${tooPct.status} ${noneGlobal.status}; organizer ${orgTry.status}/${orgSee.status}`);

    // G — the public fee for the event page
    const pubA = await api('GET', `/events/${evA.id}/booking-fee`);
    const pubB = await api('GET', `/events/${evB.id}/booking-fee`);
    check('G', 'Event page: A shows Bantaba’s fee, B its own; no note leaks',
      pubA.status === 200 && pubA.data.kind === 'pct' && pubA.data.summary.startsWith('5%') && pubB.data.kind === 'ticket' && pubB.data.amount === 2000 && !('note' in pubB.data) && pubB.data.deal?.for === 'host' && pubA.data.deal === null && pubA.data.included === false,
      `A ${pubA.data?.summary}; B ${pubB.data?.summary} (${JSON.stringify(pubB.data?.deal)})`);

    // H — a deal for one event beats the host's deal; a deal past its date stops counting
    const evB2 = await event(b, 'Fee Night B2');
    const evDeal = await api('PUT', `/admin/fees/events/${evB.id}`, admin, { kind: 'none', amount: 0, note: 'charity night' });
    const h1 = await order(evB, [['cheap', 2]]);
    const h2 = await order(evB2, [['cheap', 2]]);
    const past = await api('PUT', `/admin/fees/hosts/${b.id}`, admin, { kind: 'ticket', amount: 2000, endsAt: iso(-1) });
    const until = await api('PUT', `/admin/fees/hosts/${b.id}`, admin, { kind: 'ticket', amount: 2000, endsAt: iso(240) });
    const pubUntil = await api('GET', `/events/${evB2.id}/booking-fee`);
    await prisma.feeRule.update({ where: { scope: b.id }, data: { endsAt: new Date(Date.now() - 60_000) } });
    const h3 = await order(evB2, [['cheap', 2]]);
    const view = await api('GET', '/admin/fees', admin);
    const endedRow = view.data.deals.find((d) => d.organizer?.id === b.id);
    const evRow = view.data.deals.find((d) => d.event?.id === evB.id);
    check('H', 'Event deal (no fee) beats host B’s D20; B’s other event D40; past end date refused; after it ends → Bantaba’s fee (D45) and the deal shows as ended',
      evDeal.status === 200 && feeOf(h1) === 0 && feeOf(h2) === 4000 && past.status === 400 && until.status === 200 &&
      pubUntil.data.deal?.endsAt && pubUntil.data.deal.then?.summary.startsWith('5%') && feeOf(h3) === 4500 && endedRow?.ended === true && evRow?.for === 'event' && evRow.note === 'charity night',
      `event ${feeOf(h1)}, other ${feeOf(h2)}; past ${past.status}; then "${pubUntil.data?.deal?.then?.summary}"; ended → ${feeOf(h3)}; row ended ${endedRow?.ended}`);

    // I — the host includes the fee in their prices: buyer pays the ticket price, the host gets it less the fee
    const notYours = await api('PUT', `/events/${evA.id}/fee-included`, b.token, { included: true });
    const inc = await api('PUT', `/events/${evA.id}/fee-included`, a.token, { included: true });
    const before = (await api('GET', '/payouts/summary', a.token)).data.balance.totals.earned;
    const i1 = await paid(evA, [['cheap', 2]]);
    const after = (await api('GET', '/payouts/summary', a.token)).data.balance.totals.earned;
    check('I', 'Fees included: 2 × D250 → buyer pays D500, fee D45 inside; host earns D455; only the host can switch it',
      notYours.status === 403 && inc.status === 200 && inc.data.included === true && i1.order.total === 50000 && i1.order.platformFee === 4500 && i1.order.feeIncluded && after - before === 45500,
      `other host ${notYours.status}; total ${i1.order.total}, fee ${i1.order.platformFee}; earned +${after - before}`);

    // J — refunds: the fee stays by default; "give it back" returns this ticket's share only
    await api('PUT', `/events/${evA.id}/fee-included`, a.token, { included: false });
    const j1 = await paid(evA, [['cheap', 2]]);
    const elig = (await api('GET', `/refunds/eligibility?orderId=${j1.id}`, j1.tok)).data.tickets[0];
    const r1 = (await api('POST', '/refunds', j1.tok, { orderId: j1.id, ticketIds: [j1.order.tickets[0].id] })).data;
    const giveBack = await api('PUT', '/admin/fees/refunds', admin, { keepFee: false });
    const j2 = await paid(evA, [['cheap', 2]]);
    const r2 = (await api('POST', '/refunds', j2.tok, { orderId: j2.id, ticketIds: [j2.order.tickets[0].id] })).data;
    const r3 = (await api('POST', '/refunds', i1.tok, { orderId: i1.id, ticketIds: [i1.order.tickets[0].id] })).data;
    await api('PUT', '/admin/fees/refunds', admin, { keepFee: true });
    const r4 = (await api('POST', '/refunds', i1.tok, { orderId: i1.id, ticketIds: [i1.order.tickets[1].id] })).data;
    check('J', 'Keep fee: D250 back, fee kept (screen says D22.50 kept); give back: D272.50 (one ticket’s D22.50, not D45); fees-included order: D250 with fee, D227.50 without',
      elig.amount === 25000 && elig.bookingFee === 2250 && elig.includesBookingFee === false && r1.amount === 25000 && r1.feeAmount === 0 &&
      giveBack.status === 200 && giveBack.data.keepOnRefund === false && r2.amount === 27250 && r2.feeAmount === 2250 && r3.amount === 25000 && r3.feeAmount === 2250 && r4.amount === 22750 && r4.feeAmount === 0,
      `elig ${elig.amount}/${elig.bookingFee}; kept ${r1.amount}/${r1.feeAmount}; back ${r2.amount}/${r2.feeAmount}; included ${r3.amount}/${r3.feeAmount}, ${r4.amount}/${r4.feeAmount}`);

    // K — the earnings report counts these paid orders' fees and the fee given back
    // (the host approves the two refunds that return a fee: D22.50 + D22.50)
    for (const r of [r2, r3]) await api('POST', `/refunds/${r.id}/approve`, a.token);
    const earn = await api('GET', '/admin/fees/earnings?period=today', admin);
    const mine = earn.data.hosts.find((h) => h.organizer.id === a.id);
    const seriesSum = earn.data.series.reduce((n, x) => n + x.fees, 0);
    const orgEarn = await api('GET', '/admin/fees/earnings', a.token);
    check('K', 'Earnings today: host A’s 3 paid orders → D135 in fees on 6 paid tickets; per hour adds up; fee given back counted; changes listed; admins only',
      earn.status === 200 && mine?.fees === 13500 && mine.paidTickets === 6 && mine.includesFee === false && seriesSum === earn.data.totals.charged && earn.data.series.length >= 1 &&
      earn.data.totals.givenBack >= 4500 && earn.data.totals.earned === earn.data.totals.charged - earn.data.totals.givenBack && earn.data.changes.length >= 1 && orgEarn.status === 403,
      `host A ${mine?.fees}/${mine?.paidTickets}; charged ${earn.data?.totals.charged}, back ${earn.data?.totals.givenBack}; changes ${earn.data?.changes.length}; organizer ${orgEarn.status}`);
  } finally {
    await prisma.feeRule.deleteMany();
    for (const r of saved) await prisma.feeRule.create({ data: r });
  }
  const passed = results.filter((r) => r.pass).length;
  console.log(`\n${passed}/${results.length} passed`);
  await prisma.$disconnect();
  process.exit(passed === results.length ? 0 : 1);
})();
