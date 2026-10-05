// Phase 20 booking fee (docs/payments.md, "Booking fee"): Bantaba's fee per
// order, per ticket or a percentage; free tickets never pay; hosts with
// their own fee; guardrails; the public fee for the event page.
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
      const ev = (await api('POST', '/events', h.token, { name: `${name} ${tag}`, categoryId: cat, venueId: venue.id, startDate: iso(72), endDate: iso(76) })).data;
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
      noFee.status === 200 && own.status === 200 && feeOf(d1) === 0 && feeOf(d2) === 4000 && own.data.hosts.length === 2 && own.data.hosts.find((h) => h.organizer.id === a.id)?.note === 'federation matches',
      `A ${feeOf(d1)}, B ${feeOf(d2)}; hosts ${own.data?.hosts.length}`);

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
      pubA.status === 200 && pubA.data.kind === 'pct' && pubA.data.summary.startsWith('5%') && pubB.data.kind === 'ticket' && pubB.data.amount === 2000 && !('note' in pubB.data),
      `A ${pubA.data?.summary}; B ${pubB.data?.summary}`);
  } finally {
    await prisma.feeRule.deleteMany();
    for (const r of saved) await prisma.feeRule.create({ data: r });
  }
  const passed = results.filter((r) => r.pass).length;
  console.log(`\n${passed}/${results.length} passed`);
  await prisma.$disconnect();
  process.exit(passed === results.length ? 0 : 1);
})();
