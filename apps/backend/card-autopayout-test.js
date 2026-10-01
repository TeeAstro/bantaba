// Card payments (Modem Pay) and auto-approved payouts — docs/payments.md, docs/payouts.md.
//
// The card tests need the backend started against this script's fake Modem Pay:
//   MODEMPAY_SECRET_KEY=sk_test_fake MODEMPAY_WEBHOOK_SECRET=whsec_fake \
//   MODEMPAY_API_BASE_URL=http://localhost:4599 npm run start:dev
// Without that, the card tests are skipped (and say so); the payout tests always run.
const http = require('http');
const crypto = require('crypto');
const { PrismaClient } = require('@prisma/client');
const prisma = new PrismaClient();
const BASE = 'http://localhost:4000/api/v1';
const SECRET = 'whsec_fake';
const results = [];
async function api(method, p, token, body) {
  const res = await fetch(BASE + p, { method, headers: { 'Content-Type': 'application/json', ...(token ? { Authorization: `Bearer ${token}` } : {}) }, body: body ? JSON.stringify(body) : undefined });
  let data = null; try { data = await res.json(); } catch {}
  return { status: res.status, data };
}
const login = async (email, password = 'SeedPassword123!') => (await api('POST', '/auth/login', null, { email, password })).data?.accessToken;
const check = (id, name, pass, detail) => { results.push({ id, pass }); console.log(`${pass ? 'PASS' : 'FAIL'}  ${id.padEnd(3)} ${name} — ${detail}`); };
const skip = (id, name, why) => console.log(`SKIP  ${id.padEnd(3)} ${name} — ${why}`);
const uniq = (t) => `card-${t}-${Date.now()}-${Math.random().toString(36).slice(2, 6)}@example.com`;
const PW = 'a-long-enough-password';
const DAY = 86400e3;

// ---- fake Modem Pay ----
const received = [];
const fake = http.createServer((req, res) => {
  let body = '';
  req.on('data', (c) => (body += c));
  req.on('end', () => {
    received.push({ path: req.url, auth: req.headers.authorization, body: JSON.parse(body || '{}') });
    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ status: true, message: 'Payment intent created', data: { intent_secret: 'pi_secret_SHOULD_NOT_BE_STORED', payment_link: `https://checkout.modempay.test/pay/${received.length}`, amount: 1, currency: 'GMD', status: 'requires_payment_method' } }));
  });
});
async function webhook(event, payload, secret = SECRET) {
  const raw = JSON.stringify({ event, payload });
  const sig = crypto.createHmac('sha512', secret).update(raw).digest('hex');
  const res = await fetch(`${BASE}/payments/webhook/card`, { method: 'POST', headers: { 'Content-Type': 'application/json', 'x-modem-signature': sig }, body: raw });
  return { status: res.status, data: await res.json().catch(() => null) };
}

(async () => {
  await new Promise((r) => fake.listen(4599, r));
  const admin = await login('admin@example.com');
  const adminUser = await prisma.user.findUnique({ where: { email: 'admin@example.com' } });
  const run = () => api('POST', '/admin/notifications/run', admin);
  const venue = (await api('GET', '/venues')).data.find((v) => v.name === 'Independence Stadium');
  const cat = (await api('GET', '/categories')).data[0].id;
  const iso = (h) => new Date(Date.now() + h * 3600e3).toISOString();
  const cust = (await api('POST', '/auth/register', null, { email: uniq('cust'), password: PW })).data.accessToken;

  const orgEmail = uniq('org');
  const org = (await api('POST', '/auth/register-organizer', null, { email: orgEmail, password: PW, businessName: `Card Promoter ${Date.now()}` })).data.accessToken;
  const orgRow = await prisma.organizer.findFirst({ where: { user: { email: orgEmail } } });
  await api('PATCH', `/admin/organizers/${orgRow.id}`, admin, { verificationStatus: 'APPROVED', trustLevel: 'TRUSTED' });
  const ev = (await api('POST', '/events', org, { name: 'Card Gig', categoryId: cat, venueId: venue.id, startDate: iso(240), endDate: iso(244) })).data;
  const tt = (await api('POST', '/ticket-types', org, { eventId: ev.id, name: 'GA', price: 75000, quantityTotal: 50 })).data;
  await api('POST', `/events/${ev.id}/publish`, org);
  const cardBuy = (n = 1) => api('POST', '/orders/checkout', cust, { eventId: ev.id, provider: 'CARD', items: [{ ticketTypeId: tt.id, quantity: n }] });
  const sold = async () => (await prisma.ticketType.findUnique({ where: { id: tt.id } })).quantitySold;

  // ---------- card payments ----------
  const a = await cardBuy(2);
  if (a.status === 503) {
    for (const [id, n] of [['A', 'Card checkout'], ['B', 'Webhook checks'], ['C', 'Card paid'], ['D', 'Checkout cancelled'], ['E', 'Paid after the order closed'], ['F', 'Card refunds']]) skip(id, n, 'backend not started with the fake Modem Pay (see the top of this file)');
  } else {
    const pay = await prisma.payment.findFirst({ where: { orderId: a.data.order.id } });
    const sent = received[received.length - 1];
    check('A', 'Card checkout: redirect to the hosted card page; amount in dalasis, cards only, our reference in metadata; the intent secret isn\'t stored; order waits',
      a.status === 201 && /checkout\.modempay\.test/.test(a.data.redirectUrl ?? a.data.payment?.redirectUrl ?? JSON.stringify(a.data)) && sent.auth === 'Bearer sk_test_fake' &&
        sent.body.data.amount === (pay.amount / 100) && JSON.stringify(sent.body.data.payment_methods) === '["card"]' && sent.body.data.metadata.reference === pay.providerReference &&
        !JSON.stringify(pay.rawPayload).includes('SHOULD_NOT') && a.data.order.status === 'PENDING',
      `${a.status}; sent amount ${sent.body.data.amount} for ${pay.amount} butut; methods ${JSON.stringify(sent.body.data.payment_methods)}; ref ok ${sent.body.data.metadata.reference === pay.providerReference}; order ${a.data.order.status}`);

    const ok = { id: 'ch_1', amount: pay.amount / 100, currency: 'GMD', status: 'completed', metadata: { reference: pay.providerReference } };
    const b1 = await webhook('charge.succeeded', ok, 'wrong-secret');
    const b2 = await webhook('charge.succeeded', { ...ok, amount: pay.amount / 100 - 1 });
    const b3 = await webhook('charge.failed', { ...ok, status: 'failed' });
    const bOrder = await prisma.ticketOrder.findUnique({ where: { id: a.data.order.id } });
    check('B', 'Webhook: bad signature 401; wrong amount not completed; a declined card leaves the order open for another try',
      b1.status === 401 && b2.status === 200 && b2.data.reason === 'amount_mismatch' && b3.status === 200 && bOrder.status === 'PENDING',
      `sig ${b1.status}; mismatch ${JSON.stringify(b2.data)}; declined ${JSON.stringify(b3.data)}; order ${bOrder.status}`);

    const c1 = await webhook('charge.succeeded', ok);
    const c2 = await webhook('charge.succeeded', ok);
    const cOrder = await prisma.ticketOrder.findUnique({ where: { id: a.data.order.id }, include: { tickets: true, payments: true } });
    await run();
    const cMail = await prisma.notification.findFirst({ where: { orderId: a.data.order.id, type: 'order_confirmed' } });
    check('C', 'Card paid: order PAID, 2 tickets, confirmation email; repeated webhook adds nothing',
      c1.data.completed === true && cOrder.status === 'PAID' && cOrder.tickets.length === 2 && cOrder.payments[0].status === 'SUCCESSFUL' && cMail?.status === 'SENT' && c2.status === 200,
      `${JSON.stringify(c1.data)}; order ${cOrder.status}, ${cOrder.tickets.length} tickets, payment ${cOrder.payments[0].status}; email ${cMail?.status}`);

    const before = await sold();
    const d = await cardBuy(3);
    const dPay = await prisma.payment.findFirst({ where: { orderId: d.data.order.id } });
    const mid = await sold();
    const d1 = await webhook('payment_intent.cancelled', { id: 'pi_2', metadata: { reference: dPay.providerReference } });
    const dOrder = await prisma.ticketOrder.findUnique({ where: { id: d.data.order.id } });
    check('D', 'Customer cancels the card page: order CANCELLED, the 3 reserved tickets released',
      dOrder.status === 'CANCELLED' && mid === before + 3 && (await sold()) === before,
      `${JSON.stringify(d1.data)}; order ${dOrder.status}; sold ${before} → ${mid} → ${await sold()}`);

    const e1 = await webhook('charge.succeeded', { id: 'ch_late', amount: dPay.amount / 100, currency: 'GMD', metadata: { reference: dPay.providerReference } });
    const ePay = await prisma.payment.findUnique({ where: { id: dPay.id } });
    const eLog = await prisma.auditLog.findFirst({ where: { action: 'card_paid_after_order_closed', entityId: dPay.id } });
    check('E', 'Paid after the order closed: no tickets, payment recorded as paid and flagged for a refund',
      e1.data.reason === 'order_closed' && ePay.status === 'SUCCESSFUL' && ePay.rawPayload.paidAfterOrderClosed === true && !!eLog && (await prisma.ticket.count({ where: { orderId: d.data.order.id } })) === 0,
      `${JSON.stringify(e1.data)}; payment ${ePay.status}; audit ${!!eLog}`);

    const f1 = await api('POST', `/events/${ev.id}/refunds`, org, { ticketIds: [cOrder.tickets[0].id], reason: 'Card refund test' });
    check('F', 'Refunding a card ticket: paid back by hand (no refund API documented)',
      f1.status === 201 && (f1.data.method ?? f1.data[0]?.method) === 'MANUAL',
      `${f1.status} method ${f1.data?.method ?? f1.data?.[0]?.method}`);
  }

  // ---------- auto-approved payouts ----------
  for (let i = 0; i < 2; i++) await api('POST', '/orders/checkout', cust, { eventId: ev.id, provider: 'MOCK', items: [{ ticketTypeId: tt.id, quantity: 1 }] });
  await api('PUT', '/payouts/account', org, { method: 'WAVE', accountName: 'Card Promoter', accountNumber: '7001122', password: PW });
  const acct = (await api('GET', `/admin/organizers/${orgRow.id}`, admin)).data.payoutAccount;
  await api('POST', `/admin/organizers/${orgRow.id}/payout-account/verify`, admin, { updatedAt: acct.updatedAt });
  await prisma.event.update({ where: { id: ev.id }, data: { startDate: new Date(Date.now() - 4 * DAY), endDate: new Date(Date.now() - 4 * DAY + 3600e3) } });
  const avail = (await api('GET', '/payouts/summary', org)).data.balance.totals.available;

  const g0 = await api('PATCH', `/admin/organizers/${orgRow.id}`, admin, { payoutAutoApprove: true, payoutAutoApproveMax: 50000 });
  const gSum = (await api('GET', '/payouts/summary', org)).data;
  const g1 = await api('POST', '/payouts', org, { amount: 40000 });
  await run();
  const gAdmin = await prisma.notification.findFirst({ where: { userId: adminUser.id, type: 'payout_requested', payload: { path: ['payoutId'], equals: g1.data.id } } });
  const gOrg = await prisma.notification.findFirst({ where: { userId: orgRow.userId, type: 'payout_approved', payload: { path: ['payoutId'], equals: g1.data.id } } });
  const gLog = await prisma.auditLog.findFirst({ where: { action: 'payout_auto_approved', entityId: g1.data.id } });
  const g2 = await api('POST', `/admin/payouts/${g1.data.id}/mark-paid`, admin, { reference: 'WAVE-AUTO-1' });
  check('G', 'Auto-approve on (up to D500): D400 request approved at once; admins told to send it, organizer told it\'s approved; admin records it paid',
    g0.status === 200 && g0.data.payoutAutoApprove === true && gSum.autoApprove?.max === 50000 && avail >= 100000 &&
      g1.status === 201 && g1.data.status === 'APPROVED' && g1.data.autoApproved === true && gAdmin?.status === 'SENT' && gOrg?.status === 'SENT' && !!gLog && g2.data.status === 'PAID' && g2.data.autoApproved === true,
    `available ${avail}; request ${g1.status} ${g1.data?.status} auto=${g1.data?.autoApproved}; admin email ${gAdmin?.status}; organizer email ${gOrg?.status}; paid ${g2.data?.status}`);

  const h1 = await api('POST', '/payouts', org, { amount: 60000 });
  await api('POST', `/admin/payouts/${h1.data.id}/reject`, admin, { note: 'test' });
  await api('PATCH', `/admin/organizers/${orgRow.id}`, admin, { payoutAutoApproveMax: null });
  const h2 = await api('POST', '/payouts', org, { amount: 60000 });
  await api('POST', `/admin/payouts/${h2.data.id}/reject`, admin, { note: 'test' });
  check('H', 'Above the limit (D600 > D500) waits for an admin; with no limit it\'s approved at once',
    h1.status === 201 && h1.data.status === 'REQUESTED' && h1.data.autoApproved === false && h2.data.status === 'APPROVED' && h2.data.autoApproved === true,
    `D600 → ${h1.data?.status}; no limit → ${h2.data?.status}`);

  await api('PUT', '/payouts/account', org, { method: 'WAVE', accountName: 'Someone Else', accountNumber: '7009999', password: PW });
  const i1 = await api('POST', '/payouts', org, { amount: 10000 });
  const acct2 = (await api('GET', `/admin/organizers/${orgRow.id}`, admin)).data.payoutAccount;
  await api('POST', `/admin/organizers/${orgRow.id}/payout-account/verify`, admin, { updatedAt: acct2.updatedAt });
  await api('PATCH', `/admin/organizers/${orgRow.id}`, admin, { payoutAutoApprove: false });
  const i2 = await api('POST', '/payouts', org, { amount: 10000 });
  check('I', 'Auto-approval keeps the safety checks (changed payout details block requests until confirmed); switched off → back to admin approval',
    i1.status === 403 && /checking your payout details/.test(JSON.stringify(i1.data)) && i2.status === 201 && i2.data.status === 'REQUESTED',
    `after details change ${i1.status}; auto off → ${i2.data?.status}`);

  const passed = results.filter((r) => r.pass).length;
  console.log(`\n${passed}/${results.length} passed`);
  fake.close();
  await prisma.$disconnect();
  process.exit(passed === results.length ? 0 : 1);
})().catch(async (e) => { console.error(e); fake.close(); await prisma.$disconnect(); process.exit(1); });
