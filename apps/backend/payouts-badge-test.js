// Organizer payouts and the verified badge (docs/payouts.md).
// node payouts-badge-test.js   (backend running, seed data loaded)
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
const uniq = (t) => `pay-${t}-${Date.now()}-${Math.random().toString(36).slice(2, 6)}@example.com`;
const letters = () => Array.from({ length: 4 }, () => 'abcdefghijklmnopqrstuvwxyz'[Math.floor(Math.random() * 26)]).join('');
const PW = 'a-long-enough-password';
const msg = (r) => JSON.stringify(r.data?.message ?? r.data).slice(0, 120);
const DAY = 86400e3;

(async () => {
  const admin = await login('admin@example.com');
  const adminUser = await prisma.user.findUnique({ where: { email: 'admin@example.com' } });
  const run = () => api('POST', '/admin/notifications/run', admin);
  const venue = (await api('GET', '/venues')).data.find((v) => v.name === 'Independence Stadium');
  const cat = (await api('GET', '/categories')).data[0].id;
  const iso = (h) => new Date(Date.now() + h * 3600e3).toISOString();
  const cust = (await api('POST', '/auth/register', null, { email: uniq('cust'), password: PW })).data.accessToken;

  // An approved, trusted organizer with one event and 3 tickets sold at D500
  const orgEmail = uniq('org');
  const reg = await api('POST', '/auth/register-organizer', null, { email: orgEmail, password: PW, businessName: `Payout Promoter ${letters()}` });
  const org = reg.data.accessToken;
  const orgRow = await prisma.organizer.findFirst({ where: { user: { email: orgEmail } } });
  await api('PATCH', `/admin/organizers/${orgRow.id}`, admin, { verificationStatus: 'APPROVED', trustLevel: 'TRUSTED' });
  const ev = (await api('POST', '/events', org, { name: 'Payout Gig', categoryId: cat, venueId: venue.id, startDate: iso(240), endDate: iso(244), refundPolicy: 'ANYTIME' })).data;
  const tt = (await api('POST', '/ticket-types', org, { eventId: ev.id, name: 'GA', price: 50000, quantityTotal: 50 })).data;
  await api('POST', `/events/${ev.id}/publish`, org);
  const order = (await api('POST', '/orders/checkout', cust, { eventId: ev.id, provider: 'MOCK', items: [{ ticketTypeId: tt.id, quantity: 3 }] })).data.order;
  const tickets = await prisma.ticket.findMany({ where: { orderId: order.id }, orderBy: { id: 'asc' } });
  const summary = async () => (await api('GET', '/payouts/summary', org)).data;

  // A — balance: sales count as earned but are held until after the event
  const a = await summary();
  const aEv = a.balance.events.find((e) => e.id === ev.id);
  check('A', 'Balance: D1,500 earned, held until after the event; no payout account yet',
    a.balance.totals.earned === 150000 && a.balance.totals.available === 0 && aEv.state === 'AFTER_EVENT' && a.account === null && /Add where/.test(a.cannotRequestReason),
    `earned ${a.balance.totals.earned}, available ${a.balance.totals.available}, state ${aEv?.state}, reason "${a.cannotRequestReason}"`);

  // B — payout account: needs the password, number validated, starts unverified; organizer + admins emailed
  const b1 = await api('PUT', '/payouts/account', org, { method: 'WAVE', accountName: 'Awa Jallow', accountNumber: '3012345', password: 'wrong' });
  const b2 = await api('PUT', '/payouts/account', org, { method: 'WAVE', accountName: 'Awa Jallow', accountNumber: '12345', password: PW });
  const b3 = await api('PUT', '/payouts/account', org, { method: 'BANK', accountName: 'Awa Jallow', accountNumber: '0011223344', password: PW });
  const b4 = await api('PUT', '/payouts/account', org, { method: 'WAVE', accountName: 'Awa Jallow', accountNumber: '+220 301 2345', password: PW });
  await run();
  const bMails = await prisma.notification.findMany({ where: { type: 'payout_account_changed', payload: { path: ['organizerId'], equals: orgRow.id } } });
  check('B', 'Payout account: wrong password 400, bad Wave number 400, bank needs bank name 400; saved unverified; organizer and admins emailed',
    b1.status === 400 && b2.status === 400 && b3.status === 400 && b4.status === 200 && b4.data.accountNumber === '+2203012345' && b4.data.verified === false &&
      bMails.some((n) => n.userId === orgRow.userId && n.status === 'SENT') && bMails.some((n) => n.userId === adminUser.id && n.status === 'SENT'),
    `${b1.status}/${b2.status}/${b3.status}/${b4.status} → ${b4.data?.accountNumber} verified=${b4.data?.verified}; emails ${bMails.map((n) => n.status).join(',')}`);

  // C — admin verifies the details they saw; a stale view is refused
  const c0 = await api('POST', '/payouts', org, { amount: 10000 });
  const c1 = await api('POST', `/admin/organizers/${orgRow.id}/payout-account/verify`, admin, { updatedAt: new Date(Date.now() - 60000).toISOString() });
  const c2 = await api('POST', `/admin/organizers/${orgRow.id}/payout-account/verify`, admin, { updatedAt: b4.data.updatedAt });
  check('C', 'Unverified account blocks requests (403); verify with stale details 409, current 201',
    c0.status === 403 && /checking your (payout|withdrawal) details/.test(msg(c0)) && c1.status === 409 && c2.status === 201 && c2.data.verified === true,
    `request ${c0.status}; stale ${c1.status}; verify ${c2.status} ${c2.data?.verified}`);

  // D — before the event: nothing to pay out; an admin-set 50% advance releases half
  const d1 = await api('POST', '/payouts', org, { amount: 10000 });
  await api('PATCH', `/admin/organizers/${orgRow.id}`, admin, { payoutAdvancePercent: 50 });
  const d2 = await summary();
  const d3 = await api('POST', '/payouts', org, { amount: 80000 });
  // a pending refund request (1 ticket) is held back from the advance
  const d4 = await api('POST', '/refunds', cust, { orderId: order.id, ticketIds: [tickets[0].id] });
  const d5 = await summary();
  check('D', 'Before the event: request 403; 50% advance → D750 available, D800 refused; pending refund request held back → D500',
    d1.status === 403 && d2.balance.totals.available === 75000 && d3.status === 400 && /D750.00/.test(msg(d3)) && d4.status === 201 && d5.balance.totals.available === 50000,
    `${d1.status}; advance avail ${d2.balance.totals.available}; 800 → ${d3.status} ${msg(d3)}; refund req ${d4.status}; avail ${d5.balance.totals.available}`);

  // E — after the event + hold period: everything (minus refunds) available; rules on the request
  await api('POST', `/refunds/${d4.data.id}/reject`, org, { note: 'No refunds this close' });
  await api('PATCH', `/admin/organizers/${orgRow.id}`, admin, { payoutAdvancePercent: 0 });
  await prisma.event.update({ where: { id: ev.id }, data: { startDate: new Date(Date.now() - 3 * DAY - 4 * 3600e3), endDate: new Date(Date.now() - 3 * DAY) } });
  await api('POST', `/events/${ev.id}/refunds`, org, { ticketIds: [tickets[0].id], reason: 'Goodwill' });
  const e0 = await summary();
  const e1 = await api('POST', '/payouts', org, { amount: 5000 });
  const e2 = await api('POST', '/payouts', org, { amount: 60000, note: 'Venue deposit' });
  const e3 = await api('POST', '/payouts', org, { amount: 10000 });
  const e4 = await api('PUT', '/payouts/account', org, { method: 'WAVE', accountName: 'Someone Else', accountNumber: '7654321', password: PW });
  await run();
  const eMail = await prisma.notification.findFirst({ where: { userId: adminUser.id, type: 'payout_requested', payload: { path: ['payoutId'], equals: e2.data?.id ?? '' } } });
  check('E', 'After the event (+2 days): D1,000 available after a refund; below minimum 400; D600 requested; second request 403; account change while open 409; admins emailed',
    e0.balance.totals.available === 100000 && e0.balance.events[0].state === 'AVAILABLE' && e1.status === 400 && e2.status === 201 && e2.data.status === 'REQUESTED' &&
      e3.status === 403 && e4.status === 409 && eMail?.status === 'SENT',
    `avail ${e0.balance.totals.available}; D50 ${e1.status}; D600 ${e2.status} ${e2.data?.status}; again ${e3.status}; account ${e4.status}; email ${eMail?.status}`);

  // F — admin approves, then records it paid; organizer emailed each time
  const f1 = await api('POST', `/admin/payouts/${e2.data.id}/approve`, admin);
  await run();
  const f2 = await api('POST', `/payouts/${e2.data.id}/cancel`, org);
  const f3 = await api('POST', `/admin/payouts/${e2.data.id}/mark-paid`, admin, { reference: 'WAVE-TX-778899' });
  await run();
  const fMails = await prisma.notification.findMany({ where: { userId: orgRow.userId, type: { in: ['payout_approved', 'payout_paid'] } } });
  const f4 = await summary();
  check('F', 'Approve → APPROVED (organizer can no longer cancel, 409) → mark paid → PAID; both emails; paid out D600, D400 left',
    f1.status === 201 && f1.data.status === 'APPROVED' && f2.status === 409 && f3.status === 201 && f3.data.status === 'PAID' && f3.data.reference === 'WAVE-TX-778899' &&
      fMails.length === 2 && fMails.every((n) => n.status === 'SENT') && f4.balance.totals.paidOut === 60000 && f4.balance.totals.available === 40000,
    `approve ${f1.status} ${f1.data?.status}; cancel ${f2.status}; paid ${f3.status} ${f3.data?.status}; emails ${fMails.map((n) => n.type + ':' + n.status).join(',')}; paidOut ${f4.balance.totals.paidOut} avail ${f4.balance.totals.available}`);

  // G — organizer cancels a request; admin rejection needs a reason; money returns to the balance
  const g1 = await api('POST', '/payouts', org, { amount: 40000 });
  const g2 = await api('POST', `/payouts/${g1.data.id}/cancel`, org);
  const g3 = await api('POST', '/payouts', org, { amount: 40000 });
  const g4 = await api('POST', `/admin/payouts/${g3.data.id}/reject`, admin, {});
  const g5 = await api('POST', `/admin/payouts/${g3.data.id}/reject`, admin, { note: 'Please confirm the event took place' });
  await run();
  const gMail = await prisma.notification.findFirst({ where: { userId: orgRow.userId, type: 'payout_rejected' } });
  const g6 = await summary();
  check('G', 'Cancel own request; reject without a reason 400, with one 201 + email; D400 available again',
    g1.status === 201 && g2.status === 201 && g2.data.status === 'CANCELLED' && g4.status === 400 && g5.status === 201 && g5.data.status === 'REJECTED' && gMail?.status === 'SENT' && g6.balance.totals.available === 40000,
    `${g1.status}, cancel ${g2.data?.status}; reject no note ${g4.status}; reject ${g5.data?.status}; email ${gMail?.status}; avail ${g6.balance.totals.available}`);

  // H — a refund after the request leaves too little: approval refused
  const h1 = await api('POST', '/payouts', org, { amount: 40000 });
  await api('POST', `/events/${ev.id}/refunds`, org, { ticketIds: [tickets[1].id] });
  const h2 = await api('POST', `/admin/payouts/${h1.data.id}/approve`, admin);
  const h3 = await api('POST', `/admin/payouts/${h1.data.id}/mark-paid`, admin, { reference: 'X1' });
  await api('POST', `/admin/payouts/${h1.data.id}/reject`, admin, { note: 'Refunds since' });
  const h4 = await summary();
  check('H', 'Refund after the request: approve and mark-paid refused (409); balance now negative (refunds after a payout)',
    h1.status === 201 && h2.status === 409 && /Refunds since/.test(msg(h2)) && h3.status === 409 && h4.balance.totals.available === -10000,
    `approve ${h2.status} ${msg(h2)}; paid ${h3.status}; avail ${h4.balance.totals.available}`);

  // I — access: other organizers, customers, admin-only endpoints; admin views
  const other = await login('organizer@example.com');
  const i1 = await api('POST', `/payouts/${h1.data.id}/cancel`, other);
  const i2 = await api('GET', '/payouts/summary', cust);
  const i3 = await api('GET', '/admin/payouts', org);
  const i4 = await api('GET', '/admin/payouts?status=PAID', admin);
  const i5 = await api('GET', `/admin/organizers/${orgRow.id}/payouts`, admin);
  check('I', 'Another organizer can\'t touch the payout (404); customer 403; organizer on admin route 403; admin list and per-organizer view',
    i1.status === 404 && i2.status === 403 && i3.status === 403 && i4.status === 200 && i4.data.some((p) => p.id === e2.data.id && p.organizer.id === orgRow.id) && i5.status === 200 && i5.data.payouts.length === 4,
    `${i1.status}/${i2.status}/${i3.status}; admin list ${i4.status}; organizer view ${i5.status} ${i5.data?.payouts?.length} payouts`);

  // J — suspended organizers can't ask, and admin can't pay a pending one
  await api('PATCH', `/admin/organizers/${orgRow.id}`, admin, { payoutAdvancePercent: 0 });
  await prisma.payout.create({ data: { organizerId: orgRow.id, amount: 100, method: 'WAVE', accountName: 'Awa Jallow', accountNumber: '+2203012345', requestedById: orgRow.userId } });
  const jOpen = await prisma.payout.findFirst({ where: { organizerId: orgRow.id, status: 'REQUESTED' } });
  await api('PATCH', `/admin/organizers/${orgRow.id}`, admin, { verificationStatus: 'SUSPENDED' });
  const j1 = await summary();
  const j2 = await api('POST', `/admin/payouts/${jOpen.id}/approve`, admin);
  await api('POST', `/admin/payouts/${jOpen.id}/reject`, admin, { note: 'Suspended' });
  await api('PATCH', `/admin/organizers/${orgRow.id}`, admin, { verificationStatus: 'APPROVED' });
  check('J', 'Suspended: payouts paused for the organizer; admin approval refused (409)',
    /suspended/.test(j1.cannotRequestReason ?? '') && j2.status === 409 && /suspended/.test(msg(j2)),
    `reason "${j1.cannotRequestReason}"; approve ${j2.status}`);

  // K — verified badge: approved organizers only; shown publicly without private fields
  const badgeName = `Kotu Sports Association ${letters()}`;
  const kEmail = uniq('badge');
  const kReg = await api('POST', '/auth/register-organizer', null, { email: kEmail, password: PW, businessName: badgeName });
  const kRow = await prisma.organizer.findFirst({ where: { user: { email: kEmail } } });
  const k1 = await api('PATCH', `/admin/organizers/${kRow.id}`, admin, { verifiedBadge: true });
  await api('PATCH', `/admin/organizers/${kRow.id}`, admin, { verificationStatus: 'APPROVED', trustLevel: 'TRUSTED', note: 'Private note: checked the letterhead' });
  const k2 = await api('PATCH', `/admin/organizers/${kRow.id}`, admin, { verifiedBadge: true });
  const kEv = (await api('POST', '/events', kReg.data.accessToken, { name: 'Official Match', categoryId: cat, venueId: venue.id, startDate: iso(300), endDate: iso(302) })).data;
  await api('POST', '/ticket-types', kReg.data.accessToken, { eventId: kEv.id, name: 'Stand', price: 10000, quantityTotal: 10 });
  await api('POST', `/events/${kEv.id}/publish`, kReg.data.accessToken);
  const k3 = await api('GET', `/events/${kEv.id}`);
  const k4 = await api('GET', `/events?search=Official%20Match&limit=50`);
  await run();
  const kMail = await prisma.notification.findFirst({ where: { userId: kRow.userId, type: 'organizer_status', payload: { path: ['change'], equals: 'verified_badge' } } });
  const kOv = await api('GET', '/organizer/overview', kReg.data.accessToken);
  check('K', 'Badge: pending organizer 400; approved 200 + email; public event shows {id, slug, businessName, logoUrl, verified} only; listed events too; dashboard knows',
    k1.status === 400 && k2.status === 200 && k2.data.verifiedBadge === true && kMail?.status === 'SENT' &&
      JSON.stringify(Object.keys(k3.data.organizer).sort()) === JSON.stringify(['businessName', 'id', 'logoUrl', 'slug', 'verified']) && k3.data.organizer.verified === true &&
      k4.data.items.find((e) => e.id === kEv.id)?.organizer?.verified === true && kOv.data.organizer.verified === true,
    `pending ${k1.status}; approved ${k2.status}; email ${kMail?.status}; public organizer ${JSON.stringify(k3.data?.organizer)}; list ${k4.data?.items?.find((e) => e.id === kEv.id)?.organizer?.verified}; overview ${kOv.data?.organizer?.verified}`);

  // L — suspension hides the tick; impersonation: exact copy refused, near-miss flagged
  await api('PATCH', `/admin/organizers/${kRow.id}`, admin, { verificationStatus: 'SUSPENDED' });
  const l1 = await api('GET', `/events/${kEv.id}`, admin);
  await api('PATCH', `/admin/organizers/${kRow.id}`, admin, { verificationStatus: 'APPROVED' });
  const l2 = await api('POST', '/auth/register-organizer', null, { email: uniq('fake'), password: PW, businessName: `The ${badgeName} Official` });
  const fakeEmail = uniq('fake2');
  const misspelt = badgeName.replace('Association', 'Asociation').replace('Sports', 'Sport');
  const l3 = await api('POST', '/auth/register-organizer', null, { email: fakeEmail, password: PW, businessName: misspelt });
  const fakeRow = await prisma.organizer.findFirst({ where: { user: { email: fakeEmail } } });
  const l4 = await api('GET', `/admin/organizers/${fakeRow?.id}`, admin);
  const l5 = await api('GET', `/admin/organizers/${orgRow.id}`, admin);
  check('L', 'Suspended → no tick; sign-up as "The … Official" 409; misspelt copy allowed but flagged to admins; unrelated name not flagged',
    l1.data.organizer.verified === false && l2.status === 409 && l3.status === 201 && l4.data.lookalikeOf?.id === kRow.id && l5.data.lookalikeOf === null,
    `suspended verified=${l1.data?.organizer?.verified}; copy ${l2.status}; misspelt ${l3.status} flagged ${l4.data?.lookalikeOf?.businessName}; other ${l5.data?.lookalikeOf}`);

  const passed = results.filter((r) => r.pass).length;
  console.log(`\n${passed}/${results.length} passed`);
  await prisma.$disconnect();
  process.exit(passed === results.length ? 0 : 1);
})().catch(async (e) => { console.error(e); await prisma.$disconnect(); process.exit(1); });
