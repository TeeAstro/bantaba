// Phase 14 admin dashboard API (docs/admin-dashboard.md).
// node admin-dashboard-test.js   (backend running, seed data loaded)
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
const uniq = (t) => `admin-${t}-${Date.now()}-${tag}@example.com`;
const PW = 'a-long-enough-password';
const iso = (h) => new Date(Date.now() + h * 3600e3).toISOString();

(async () => {
  const [admin, organizer] = await Promise.all([login('admin@example.com'), login('organizer@example.com')]);
  const cust = (await api('POST', '/auth/register', null, { email: uniq('cust'), password: PW })).data.accessToken;
  const venue = (await api('GET', '/venues')).data[0];
  const cat = (await api('GET', '/categories')).data[0].id;
  const attention = async () => (await api('GET', '/admin/attention', admin)).data;

  // A — admin only
  const paths = ['/admin/attention', '/admin/card-flags', '/admin/audit-log', '/admin/audit-log/facets'];
  const denied = await Promise.all(paths.flatMap((p) => [api('GET', p, organizer), api('GET', p, cust), api('GET', p)]));
  const okAdmin = await Promise.all(paths.map((p) => api('GET', p, admin)));
  check('A', 'New admin endpoints: 403 for organizers and customers, 401 signed out, 200 for admins',
    denied.every((r, i) => r.status === (i % 3 === 2 ? 401 : 403)) && okAdmin.every((r) => r.status === 200),
    `${denied.map((r) => r.status).join(',')} / admin ${okAdmin.map((r) => r.status).join(',')}`);

  // B — counts go up as work arrives
  const before = await attention();
  // the seed organizer gets the blue tick, so a similar name becomes a lookalike
  const seedOrg = await prisma.organizer.findFirst({ where: { user: { email: 'organizer@example.com' } } });
  await api('PATCH', `/admin/organizers/${seedOrg.id}`, admin, { verificationStatus: 'APPROVED', verifiedBadge: false });
  // A pending organizer with a name like the seed organizer's. Sign-up refuses
  // names like a *verified* organizer's, so this one registers first and the
  // seed organizer gets the blue tick afterwards.
  const lookEmail = uniq('look');
  const lookName = `${seedOrg.businessName} ${tag}`;
  const lookReg = await api('POST', '/auth/register-organizer', null, { email: lookEmail, password: PW, businessName: lookName });
  const look = await prisma.organizer.findFirst({ where: { user: { email: lookEmail } } });
  const mid = await attention();
  await api('PATCH', `/admin/organizers/${seedOrg.id}`, admin, { verifiedBadge: true });
  const midAfterBadge = await attention();
  // an approved NEW organizer: event goes to review; payout details to check
  const newEmail = uniq('new');
  const newOrgToken = (await api('POST', '/auth/register-organizer', null, { email: newEmail, password: PW, businessName: `Brikama Nights ${tag}` })).data.accessToken;
  const newOrg = await prisma.organizer.findFirst({ where: { user: { email: newEmail } } });
  await api('PATCH', `/admin/organizers/${newOrg.id}`, admin, { verificationStatus: 'APPROVED' });
  const ev = (await api('POST', '/events', newOrgToken, { name: `Review Me ${tag}`, categoryId: cat, venueId: venue.id, startDate: iso(300), endDate: iso(304) })).data;
  await api('POST', '/ticket-types', newOrgToken, { eventId: ev.id, name: 'GA', price: 20000, quantityTotal: 50 });
  const pub = await api('POST', `/events/${ev.id}/publish`, newOrgToken);
  const acct = await api('PUT', '/payouts/account', newOrgToken, { method: 'WAVE', accountName: 'Brikama Nights', accountNumber: '3012345', password: PW });
  // payouts: one waiting for approval, one approved automatically and still to send
  const payoutBase = { organizerId: newOrg.id, method: 'WAVE', accountName: 'Brikama Nights', accountNumber: '+2203012345', requestedById: newOrg.userId };
  await prisma.payout.create({ data: { ...payoutBase, amount: 10000 } });
  await prisma.payout.create({ data: { ...payoutBase, amount: 20000, status: 'APPROVED', autoApproved: true, decidedAt: new Date() } });
  // a failed email
  await prisma.notification.create({ data: { userId: newOrg.userId, channel: 'EMAIL', type: 'test_admin_dashboard', status: 'FAILED', attempts: 5, lastError: 'SMTP said no', toAddress: newEmail, subject: 'Test' } });
  const after = await attention();
  const d = (k) => after.counts[k] - mid.counts[k];
  const badgeFlags = midAfterBadge.counts.lookalikeWarnings - mid.counts.lookalikeWarnings; // every unverified organizer named like the seed one, this test's included
  const dbManual = await prisma.refund.count({ where: { status: 'APPROVED', method: 'MANUAL' } });
  const sumOpen = Object.entries(after.counts).filter(([k]) => k !== 'payoutsToSendAuto').reduce((n, [, v]) => n + v, 0);
  check('B', 'Attention counts: +1 organizer pending; badge turns a similar name into a lookalike warning, +1 event in review, +1 account to check, +1 request, +1 to send (auto), +1 failed email; total = sum; oldest dates',
    pub.data?.status === 'PENDING_APPROVAL' && acct.status === 200 &&
      lookReg.status === 201 && badgeFlags >= 1 && after.counts.organizersPending - before.counts.organizersPending === 1 && d('lookalikeWarnings') === badgeFlags && d('eventsInReview') === 1 && d('payoutAccountsToCheck') === 1 &&
      d('payoutRequests') === 1 && d('payoutsToSend') === 1 && d('payoutsToSendAuto') === 1 && d('failedEmails') === 1 &&
      after.counts.manualRefundsToPay === dbManual && after.total === sumOpen && !!after.oldest.eventsInReview && !!after.oldest.payoutRequests && before.counts !== undefined,
    `signup ${lookReg.status}; badge flags ${badgeFlags}; deltas ${JSON.stringify(Object.fromEntries(Object.keys(after.counts).map((k) => [k, d(k)])))}; total ${after.total}/${sumOpen}; publish ${pub.data?.status}; account ${acct.status}`);

  // C — organizer search and "needs" filters
  const c1 = await api('GET', `/admin/organizers?q=${encodeURIComponent(`brikama nights ${tag}`)}`, admin);
  const c2 = await api('GET', `/admin/organizers?q=${encodeURIComponent(newEmail.toUpperCase())}`, admin);
  const c3 = await api('GET', '/admin/organizers?needs=payout_account', admin);
  const c4 = await api('GET', '/admin/organizers?needs=lookalike', admin);
  const c5 = await api('GET', '/admin/organizers?needs=bogus', admin);
  const c6 = await api('GET', `/admin/organizers?q=${encodeURIComponent(lookEmail)}&verificationStatus=PENDING`, admin);
  const c7 = await api('GET', `/admin/organizers?q=${encodeURIComponent(lookEmail)}&verificationStatus=APPROVED`, admin);
  check('C', 'Organizer search by name/email (any case); needs=payout_account and needs=lookalike; bad filter 400; combines with status',
    c1.data?.length === 1 && c1.data[0].id === newOrg.id && c2.data?.length === 1 && c2.data[0].id === newOrg.id &&
      c3.data.some((o) => o.id === newOrg.id) && c3.data.every((o) => o.payoutAccount && !o.payoutAccount.verified) &&
      c4.data.some((o) => o.id === look.id) && c4.data.every((o) => o.lookalikeOf) && !c4.data.some((o) => o.id === seedOrg.id) &&
      c5.status === 400 && c6.data?.length === 1 && c6.data[0].id === look.id && c7.data?.length === 0,
    `name ${c1.data?.length}, email ${c2.data?.length}, accounts ${c3.data?.length}, lookalikes ${c4.data?.length}, bogus ${c5.status}, pending+q ${c6.data?.length}`);

  // D — card payments charged after the order closed
  const custUser = await prisma.user.findFirst({ where: { role: 'CUSTOMER' }, orderBy: { createdAt: 'desc' } });
  const seedEvent = await prisma.event.findFirst({ where: { status: 'PUBLISHED' } });
  const order = await prisma.ticketOrder.create({ data: { customerId: custUser.id, eventId: seedEvent.id, subtotal: 30000, total: 31500, status: 'CANCELLED' } });
  const flagged = await prisma.payment.create({ data: { orderId: order.id, provider: 'CARD', providerReference: `mp_${tag}_late`, amount: 31500, status: 'SUCCESSFUL', rawPayload: { event: 'charge.succeeded', chargeId: `ch_${tag}`, paidAfterOrderClosed: true, at: new Date().toISOString() } } });
  await prisma.auditLog.create({ data: { action: 'card_paid_after_order_closed', entityType: 'Payment', entityId: flagged.id, metadata: { orderId: order.id, amount: 31500 } } });
  const normal = await prisma.payment.create({ data: { orderId: order.id, provider: 'CARD', providerReference: `mp_${tag}_ok`, amount: 100, status: 'SUCCESSFUL', rawPayload: { event: 'charge.succeeded' } } });
  const att1 = await attention();
  const d1 = await api('GET', '/admin/card-flags', admin);
  const mine = d1.data?.find((f) => f.paymentId === flagged.id);
  const d2 = await api('POST', `/admin/card-flags/${normal.id}/resolve`, admin, { reference: 'MP-REF-1' });
  const d3 = await api('POST', `/admin/card-flags/${flagged.id}/resolve`, admin, { reference: 'x' });
  const d4 = await api('POST', `/admin/card-flags/${flagged.id}/resolve`, organizer, { reference: 'MP-REF-1' });
  const d5 = await api('POST', `/admin/card-flags/${flagged.id}/resolve`, admin, { reference: ' MP-REF-1 ', note: 'Refunded in dashboard' });
  const d6 = await api('POST', `/admin/card-flags/${flagged.id}/resolve`, admin, { reference: 'MP-REF-2' });
  const open = await api('GET', '/admin/card-flags?state=open', admin);
  const resolved = await api('GET', '/admin/card-flags?state=resolved', admin);
  const att2 = await attention();
  const pay = await prisma.payment.findUnique({ where: { id: flagged.id } });
  const dLog = await prisma.auditLog.findFirst({ where: { action: 'card_paid_after_order_closed_resolved', entityId: flagged.id } });
  check('D', 'Flagged card payment listed with customer/event/charge; resolve records the reference (payment REFUNDED, audited, count −1); not-flagged 404, short ref 400, organizer 403, twice 409',
    !!mine && mine.customer.id === custUser.id && mine.event.id === seedEvent.id && mine.chargeId === `ch_${tag}` && mine.status === 'OPEN' && !d1.data.some((f) => f.paymentId === normal.id) &&
      d2.status === 404 && d3.status === 400 && d4.status === 403 && d5.status === 201 && d5.data.status === 'RESOLVED' && d5.data.resolution.reference === 'MP-REF-1' && d6.status === 409 &&
      !open.data.some((f) => f.paymentId === flagged.id) && resolved.data.some((f) => f.paymentId === flagged.id) &&
      att2.counts.cardPaymentsFlagged === att1.counts.cardPaymentsFlagged - 1 && pay.status === 'REFUNDED' && pay.rawPayload.paidAfterOrderClosed === true && dLog?.metadata?.reference === 'MP-REF-1',
    `listed ${!!mine}; normal ${d2.status}; short ${d3.status}; organizer ${d4.status}; resolve ${d5.status} ${d5.data?.status}; again ${d6.status}; count ${att1.counts.cardPaymentsFlagged}→${att2.counts.cardPaymentsFlagged}; payment ${pay.status}; audit ${!!dLog}`);

  // E — audit log viewer
  const e1 = await api('GET', `/admin/audit-log?entityType=Organizer&entityId=${newOrg.id}`, admin);
  const e2 = await api('GET', '/admin/audit-log?action=card_paid_after_order_closed_resolved&pageSize=1', admin);
  const e3 = await api('GET', '/admin/audit-log?pageSize=2&page=2', admin);
  const e4 = await api('GET', '/admin/audit-log?pageSize=500', admin);
  const e5 = await api('GET', '/admin/audit-log/facets', admin);
  const adminUser = await prisma.user.findUnique({ where: { email: 'admin@example.com' } });
  const e6 = await api('GET', `/admin/audit-log?actorId=${adminUser.id}&action=organizer_trust_updated`, admin);
  const trustEntry = e1.data?.items?.find((r) => r.action === 'organizer_trust_updated');
  check('E', 'Audit log: filter by entity/action/actor, newest first, paged, actor email shown; pageSize capped; facets list actions with counts',
    e1.status === 200 && !!trustEntry && trustEntry.actor?.email === 'admin@example.com' && trustEntry.metadata?.changes?.verificationStatus === 'APPROVED' &&
      e2.data.items.length === 1 && e2.data.items[0].entityId === flagged.id && e2.data.items[0].actor.email === 'admin@example.com' &&
      e3.data.page === 2 && e3.data.items.length === 2 && e4.status === 400 &&
      e5.data.actions.some((a) => a.action === 'card_paid_after_order_closed_resolved' && a.count >= 1) && e5.data.entityTypes.some((t) => t.entityType === 'Payment') &&
      e6.data.items.length > 0 && e6.data.items.every((r) => r.actor.id === adminUser.id && r.action === 'organizer_trust_updated') &&
      new Date(e6.data.items[0].createdAt) >= new Date(e6.data.items[e6.data.items.length - 1].createdAt),
    `entity ${e1.data?.total}; action ${e2.data?.total}; page2 ${e3.data?.items?.length}; big page ${e4.status}; facets ${e5.data?.actions?.length}; actor ${e6.data?.total}`);

  // F — acting on items brings counts back down
  await api('POST', `/admin/events/${ev.id}/approve`, admin);
  await api('POST', `/admin/organizers/${newOrg.id}/payout-account/verify`, admin, { updatedAt: acct.data.updatedAt });
  await api('PATCH', `/admin/organizers/${look.id}`, admin, { verificationStatus: 'REJECTED', note: 'Impersonating' });
  const fail = await prisma.notification.findFirst({ where: { userId: newOrg.userId, type: 'test_admin_dashboard' } });
  await prisma.notification.update({ where: { id: fail.id }, data: { status: 'CANCELLED' } });
  const done = await attention();
  const dd = (k) => done.counts[k] - after.counts[k];
  check('F', 'After approving the event, checking the account, rejecting the lookalike and clearing the email: each count back down by 1',
    dd('eventsInReview') === -1 && dd('payoutAccountsToCheck') === -1 && dd('organizersPending') === -1 && dd('lookalikeWarnings') === -1 && dd('failedEmails') === -1,
    JSON.stringify(Object.fromEntries(['eventsInReview', 'payoutAccountsToCheck', 'organizersPending', 'lookalikeWarnings', 'failedEmails'].map((k) => [k, dd(k)]))));

  // tidy up what doesn't belong to this test's own organizers
  await api('PATCH', `/admin/organizers/${seedOrg.id}`, admin, { verifiedBadge: seedOrg.verifiedBadge });
  await prisma.payout.deleteMany({ where: { organizerId: newOrg.id } });

  const passed = results.filter((r) => r.pass).length;
  console.log(`\n${passed}/${results.length} passed`);
  await prisma.$disconnect();
  process.exit(passed === results.length ? 0 : 1);
})().catch(async (e) => { console.error(e); await prisma.$disconnect(); process.exit(1); });
