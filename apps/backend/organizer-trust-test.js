// Organizer trust levels and event review (docs/organizer-trust.md).
// node organizer-trust-test.js   (backend running, seed data loaded)
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
const uniq = (t) => `trust-${t}-${Date.now()}-${Math.random().toString(36).slice(2, 6)}@example.com`;
const PW = 'a-long-enough-password';
const msg = (r) => JSON.stringify(r.data?.message ?? r.data).slice(0, 110);

(async () => {
  const [admin, trusted] = await Promise.all([login('admin@example.com'), login('organizer@example.com')]);
  const run = () => api('POST', '/admin/notifications/run', admin);
  const venue = (await api('GET', '/venues')).data.find((v) => v.name === 'Independence Stadium');
  const cat = (await api('GET', '/categories')).data[0].id;
  const iso = (h) => new Date(Date.now() + h * 3600e3).toISOString();
  const custEmail = uniq('cust');
  const cust = (await api('POST', '/auth/register', null, { email: custEmail, password: PW })).data.accessToken;
  const buy = (ev, tt, provider = 'MOCK') => api('POST', '/orders/checkout', cust, { eventId: ev, provider, items: [{ ticketTypeId: tt, quantity: 1 }] });

  // A — a new organizer: pending until approved; approval emails them; starts as NEW
  const orgEmail = uniq('org');
  const reg = await api('POST', '/auth/register-organizer', null, { email: orgEmail, password: PW, businessName: 'Fresh Promoter' });
  const org = reg.data.accessToken;
  const orgRow = await prisma.organizer.findFirst({ where: { user: { email: orgEmail } } });
  const draft = (await api('POST', '/events', org, { name: 'Trust Gig', categoryId: cat, venueId: venue.id, startDate: iso(240), endDate: iso(244) })).data;
  const tt0 = (await api('POST', '/ticket-types', org, { eventId: draft.id, name: 'GA', price: 20000, quantityTotal: 100 })).data;
  const a1 = await api('POST', `/events/${draft.id}/publish`, org);
  const a2 = await api('PATCH', `/admin/organizers/${orgRow.id}`, admin, { verificationStatus: 'APPROVED', note: 'Checked their business registration' });
  await run();
  const aMail = await prisma.notification.findFirst({ where: { userId: orgRow.userId, type: 'organizer_status' } });
  check('A', 'New organizer: can\'t publish until approved; approval → NEW level with restrictions, organizer emailed',
    a1.status === 403 && a2.status === 200 && a2.data.trustLevel === 'NEW' && a2.data.permissions.requireEventReview === true && a2.data.permissions.canConfirmBankTransfers === false && a2.data.permissions.maxTicketsPerEvent === 300 && aMail?.status === 'SENT',
    `publish before approval ${a1.status}; approve ${a2.status} → ${a2.data?.trustLevel} ${JSON.stringify(a2.data?.permissions)}; email ${aMail?.status}`);

  // B — limits: 300 tickets per event, D2,500 per ticket
  const b1 = await api('POST', '/ticket-types', org, { eventId: draft.id, name: 'Big', price: 10000, quantityTotal: 201 });
  const b2 = await api('POST', '/ticket-types', org, { eventId: draft.id, name: 'OK', price: 250000, quantityTotal: 199 });
  const b3 = await api('POST', '/ticket-types', org, { eventId: draft.id, name: 'Pricey', price: 250001, quantityTotal: 1 });
  const b4 = await api('PUT', `/ticket-types/${tt0.id}`, org, { quantityTotal: 102 });
  const b5 = await api('PUT', `/ticket-types/${tt0.id}`, org, { price: 300000 });
  const b6 = await api('POST', '/ticket-types', trusted, { eventId: (await api('POST', '/events', trusted, { name: 'Trusted big', categoryId: cat, venueId: venue.id, startDate: iso(240), endDate: iso(244) })).data.id, name: 'Huge', price: 900000, quantityTotal: 5000 });
  check('B', 'NEW limits: >300 tickets per event 403, >D2,500 per ticket 403 (create and edit); trusted organizer unlimited',
    b1.status === 403 && /300 tickets/.test(msg(b1)) && b2.status === 201 && b3.status === 403 && /D2,500.00/.test(msg(b3)) && b4.status === 403 && b5.status === 403 && b6.status === 201,
    `301st ticket ${b1.status}, 299 total ok ${b2.status}, price+1 ${b3.status}, edit qty ${b4.status}, edit price ${b5.status}, trusted 5000×D9000 ${b6.status}`);

  // C — publish → review, not on sale; admins emailed
  const c1 = await api('POST', `/events/${draft.id}/publish`, org);
  const c2 = await buy(draft.id, tt0.id);
  const c3 = await api('POST', `/events/${draft.id}/publish`, org);
  await run();
  const adminUser = await prisma.user.findUnique({ where: { email: 'admin@example.com' } });
  const cMail = await prisma.notification.findFirst({ where: { userId: adminUser.id, type: 'event_review_requested', eventId: draft.id } });
  const queue = await api('GET', '/admin/events/review', admin);
  check('C', 'Publish → PENDING_APPROVAL (not on sale), admins emailed, in the review queue; publishing again 400',
    c1.status === 201 && c1.data.status === 'PENDING_APPROVAL' && c2.status >= 400 && c3.status === 400 && cMail?.status === 'SENT' && queue.data.some((e) => e.id === draft.id),
    `publish → ${c1.data?.status}, checkout ${c2.status}, again ${c3.status}, admin email ${cMail?.status}, in queue ${queue.data?.some?.((e) => e.id === draft.id)}`);

  // D — send back with a note, resubmit, approve → on sale
  const d1 = await api('POST', `/admin/events/${draft.id}/reject`, admin, {});
  const d2 = await api('POST', `/admin/events/${draft.id}/reject`, admin, { note: 'Add the full venue address and a contact email' });
  const d3 = await api('GET', `/events/${draft.id}/dashboard`, org);
  const d4 = await api('POST', `/events/${draft.id}/publish`, org);
  const d5 = await api('POST', `/admin/events/${draft.id}/approve`, admin);
  const d6 = await buy(draft.id, tt0.id);
  await run();
  const dMails = await prisma.notification.findMany({ where: { userId: orgRow.userId, type: 'event_reviewed' } });
  check('D', 'Send back needs a note → DRAFT with note shown on the dashboard; resubmit; approve → PUBLISHED and selling; organizer emailed both times',
    d1.status === 400 && d2.status === 201 && d2.data.status === 'DRAFT' && d3.data.event.reviewNote === 'Add the full venue address and a contact email' && d4.data.status === 'PENDING_APPROVAL' && d5.status === 201 && d5.data.status === 'PUBLISHED' && d6.status === 201 && dMails.length === 2 && dMails.every((m) => m.status === 'SENT'),
    `no note ${d1.status}, sent back → ${d2.data?.status}, note on dashboard ${!!d3.data?.event?.reviewNote}, resubmit ${d4.data?.status}, approve ${d5.data?.status}, checkout ${d6.status}, emails ${dMails.length}`);

  // E — bank transfers: NEW organizer can't confirm, admin can; an override allows it
  const e0 = await buy(draft.id, tt0.id, 'BANK_TRANSFER');
  const pay = await prisma.payment.findFirst({ where: { orderId: e0.data.order.id } });
  const e1 = await api('POST', `/payments/${pay.id}/confirm-bank-transfer`, org);
  const e2 = await api('PATCH', `/admin/organizers/${orgRow.id}`, admin, { canConfirmBankTransfers: true });
  const e3 = await api('POST', `/payments/${pay.id}/confirm-bank-transfer`, org);
  const e4 = await api('PATCH', `/admin/organizers/${orgRow.id}`, admin, { canConfirmBankTransfers: null });
  const e5o = await buy(draft.id, tt0.id, 'BANK_TRANSFER');
  const pay2 = await prisma.payment.findFirst({ where: { orderId: e5o.data.order.id } });
  const e5 = await api('POST', `/payments/${pay2.id}/confirm-bank-transfer`, org);
  const e6 = await api('POST', `/payments/${pay2.id}/confirm-bank-transfer`, admin);
  check('E', 'Bank transfers: NEW organizer 403; override → allowed; override cleared → 403 again; admin always',
    e1.status === 403 && e2.data.permissions.canConfirmBankTransfers === true && e3.status === 201 && e4.data.permissions.canConfirmBankTransfers === false && e5.status === 403 && e6.status === 201,
    `organizer ${e1.status} ${msg(e1).slice(0, 60)}, with override ${e3.status}, cleared ${e5.status}, admin ${e6.status}`);

  // F — cancelling: NEW organizer can't choose "I'll handle refunds"; automatic works
  const fEv = (await api('POST', '/events', org, { name: 'Trust Cancel', categoryId: cat, venueId: venue.id, startDate: iso(240), endDate: iso(244) })).data;
  await api('POST', '/ticket-types', org, { eventId: fEv.id, name: 'GA', price: 10000, quantityTotal: 10 });
  await api('POST', `/events/${fEv.id}/publish`, org);
  await api('POST', `/admin/events/${fEv.id}/approve`, admin);
  const f1 = await api('POST', `/events/${fEv.id}/cancel`, org, { refundMode: 'ORGANIZER' });
  const f2 = await api('POST', `/events/${fEv.id}/cancel`, org, { refundMode: 'AUTOMATIC' });
  check('F', 'Cancel: NEW organizer can\'t pick "handle refunds myself" (403); automatic refunds OK', f1.status === 403 && f2.status === 201 && f2.data.cancellationRefundMode === 'AUTOMATIC', `organizer mode ${f1.status}, automatic ${f2.status}`);

  // G — custom limits
  const g1 = await api('PATCH', `/admin/organizers/${orgRow.id}`, admin, { customLimits: true, maxTicketsPerEvent: 1000, maxTicketPrice: null });
  const g2 = await api('POST', '/ticket-types', org, { eventId: draft.id, name: 'VIP', price: 750000, quantityTotal: 500 });
  const g3 = await api('POST', '/ticket-types', org, { eventId: draft.id, name: 'Too many', price: 1000, quantityTotal: 500 });
  const g4 = await api('PATCH', `/admin/organizers/${orgRow.id}`, admin, { customLimits: false, maxTicketsPerEvent: 5 });
  check('G', 'Custom limits: 1000 tickets, no price cap → D7,500 tickets OK, 1,300th ticket 403; limits without customLimits 400',
    g1.data.permissions.maxTicketsPerEvent === 1000 && g1.data.permissions.maxTicketPrice === null && g2.status === 201 && g3.status === 403 && g4.status === 400,
    `limits ${g1.data?.permissions?.maxTicketsPerEvent}/${g1.data?.permissions?.maxTicketPrice}, VIP ${g2.status}, over ${g3.status}, bad patch ${g4.status}`);

  // H — promote to TRUSTED: publishing goes live straight away; can choose to handle refunds; organizer emailed
  const h1 = await api('PATCH', `/admin/organizers/${orgRow.id}`, admin, { trustLevel: 'TRUSTED', customLimits: false });
  const hEv = (await api('POST', '/events', org, { name: 'Trust Live', categoryId: cat, venueId: venue.id, startDate: iso(240), endDate: iso(244) })).data;
  const hTt = (await api('POST', '/ticket-types', org, { eventId: hEv.id, name: 'GA', price: 10000, quantityTotal: 2000 })).data;
  const h2 = await api('POST', `/events/${hEv.id}/publish`, org);
  await run();
  const hMail = await prisma.notification.findFirst({ where: { userId: orgRow.userId, type: 'organizer_status', payload: { path: ['change'], equals: 'trusted' } } });
  check('H', 'TRUSTED: no limits, publish goes live directly, organizer emailed', h1.data.permissions.requireEventReview === false && h1.data.permissions.maxTicketsPerEvent === null && hTt.quantityTotal === 2000 && h2.data.status === 'PUBLISHED' && hMail?.status === 'SENT',
    `perms ${JSON.stringify(h1.data?.permissions)}, publish → ${h2.data?.status}, email ${hMail?.status}`);

  // I — suspension stops sales at once; reinstating resumes them
  const i1 = await api('PATCH', `/admin/organizers/${orgRow.id}`, admin, { verificationStatus: 'SUSPENDED', note: 'Reports of fake event' });
  const i2 = await buy(hEv.id, hTt.id);
  const iEv = (await api('POST', '/events', org, { name: 'Trust While Suspended', categoryId: cat, venueId: venue.id, startDate: iso(240), endDate: iso(244) })).data;
  const i3 = await api('POST', `/events/${iEv?.id}/publish`, org);
  const i4 = await api('PATCH', `/admin/organizers/${orgRow.id}`, admin, { verificationStatus: 'APPROVED' });
  const i5 = await buy(hEv.id, hTt.id);
  await run();
  const iMails = await prisma.notification.findMany({ where: { userId: orgRow.userId, type: 'organizer_status' }, orderBy: { createdAt: 'asc' } });
  check('I', 'Suspend → checkout on their live event 403 "paused", can\'t publish; reinstate → sales resume; emails sent',
    i1.data.permissions.canSell === false && i2.status === 403 && /paused/.test(msg(i2)) && i3.status === 403 && i4.data.permissions.canSell === true && i5.status === 201 && iMails.some((m) => m.payload.change === 'suspended') && iMails.some((m) => m.payload.change === 'reinstated'),
    `suspended checkout ${i2.status} ${msg(i2)}, publish ${i3.status}, reinstated checkout ${i5.status}, emails ${iMails.map((m) => m.payload.change)}`);

  // J — admin only; dashboards show the organizer their permissions; admin publish skips review
  const j1 = await api('GET', '/admin/organizers', org);
  const j2 = await api('PATCH', `/admin/organizers/${orgRow.id}`, trusted, { trustLevel: 'TRUSTED' });
  const j3 = await api('GET', '/organizer/overview', org);
  await api('PATCH', `/admin/organizers/${orgRow.id}`, admin, { trustLevel: 'NEW' });
  const jEv = (await api('POST', '/events', org, { name: 'Trust Admin Publish', categoryId: cat, venueId: venue.id, startDate: iso(240), endDate: iso(244) })).data;
  const j4 = await api('POST', `/events/${jEv.id}/publish`, admin);
  const j5 = await api('GET', `/admin/organizers/${orgRow.id}`, admin);
  check('J', 'Admin endpoints admin-only (403); organizer overview shows permissions; admin publishing skips review; organizer detail has stats',
    j1.status === 403 && j2.status === 403 && j3.data?.organizer?.permissions?.trustLevel === 'TRUSTED' && j4.data.status === 'PUBLISHED' && typeof j5.data.stats?.ticketsSold === 'number',
    `organizer list ${j1.status}, organizer patch ${j2.status}, overview perms ${j3.data?.organizer?.permissions?.trustLevel}, admin publish ${j4.data?.status}, stats ${JSON.stringify(j5.data?.stats)}`);

  const failed = results.filter((r) => !r.pass).length;
  console.log(`\n${results.length - failed}/${results.length} passed`);
  await prisma.$disconnect();
  process.exit(failed ? 1 : 0);
})().catch(async (e) => { console.error('RUN ERROR', e); await prisma.$disconnect(); process.exit(1); });
