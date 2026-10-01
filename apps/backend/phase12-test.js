// Phase 12: notifications (email outbox).
// node phase12-test.js   (backend running, seed data loaded)
//
// Checks the outbox rows in the database. With MAIL_TRANSPORT=log (the
// default without SMTP_HOST) it also opens the preview files in
// apps/backend/mail-previews and checks what the emails say. With SMTP
// (e.g. Mailpit) those content checks are skipped; look at the emails there.
const { PrismaClient } = require('@prisma/client');
const fs = require('fs');
const path = require('path');
const prisma = new PrismaClient();
const BASE = 'http://localhost:4000/api/v1';
const PREVIEWS = process.env.MAIL_PREVIEW_DIR ?? path.join(__dirname, 'mail-previews');
const results = [];
const started = Date.now();
async function api(method, p, token, body) {
  const res = await fetch(BASE + p, { method, headers: { 'Content-Type': 'application/json', ...(token ? { Authorization: `Bearer ${token}` } : {}) }, body: body ? JSON.stringify(body) : undefined });
  let data = null; try { data = await res.json(); } catch {}
  return { status: res.status, data };
}
const login = async (email, password = 'SeedPassword123!') => (await api('POST', '/auth/login', null, { email, password })).data?.accessToken;
const check = (id, name, pass, detail) => { results.push({ id, pass }); console.log(`${pass ? 'PASS' : 'FAIL'}  ${id.padEnd(3)} ${name} — ${detail}`); };
const uniq = (t) => `p12-${t}-${Date.now()}-${Math.random().toString(36).slice(2, 6)}@example.com`;
const PW = 'a-long-enough-password';
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

// Preview files written since the test started, for one recipient.
function previews(to) {
  if (!fs.existsSync(PREVIEWS)) return [];
  return fs.readdirSync(PREVIEWS)
    .map((f) => path.join(PREVIEWS, f))
    .filter((f) => fs.statSync(f).mtimeMs >= started - 1000)
    .map((f) => ({ file: f, html: fs.readFileSync(f, 'utf8') }))
    .filter((p) => p.html.includes(`To: ${to}<br>`));
}
// Log mode = preview files are being written (decided once, after the first email went out).
let LOG = null;
const logMode = () => {
  if (LOG === null) LOG = fs.existsSync(PREVIEWS) && fs.readdirSync(PREVIEWS).some((f) => fs.statSync(path.join(PREVIEWS, f)).mtimeMs >= started - 1000);
  return LOG;
};

(async () => {
  const [admin, organizer, customer] = await Promise.all(['admin', 'organizer', 'customer'].map((u) => login(`${u}@example.com`)));
  const run = () => api('POST', '/admin/notifications/run', admin);
  const rows = (where) => prisma.notification.findMany({ where, orderBy: { createdAt: 'asc' } });
  const buyer = async (tag) => { const email = uniq(tag); const r = await api('POST', '/auth/register', null, { email, password: PW, fullName: `Buyer ${tag}` }); return { email, tok: r.data.accessToken, id: r.data.user?.id }; };
  const venues = (await api('GET', '/venues')).data;
  const stadium = venues.find((v) => v.name === 'Independence Stadium');
  const other = venues.find((v) => v.id !== stadium.id);
  const cat = (await api('GET', '/categories')).data[0].id;
  const iso = (h) => new Date(Date.now() + h * 3600e3).toISOString();
  const mkEvent = async (name, startH = 72, publish = true) => {
    const e = (await api('POST', '/events', organizer, { name, categoryId: cat, venueId: stadium.id, startDate: iso(startH), endDate: iso(startH + 4), contactEmail: 'promoter@example.com' })).data;
    const tt = (await api('POST', '/ticket-types', organizer, { eventId: e.id, name: 'Regular', price: 25000, quantityTotal: 100 })).data;
    if (publish) await api('POST', `/events/${e.id}/publish`, organizer);
    return { ...e, ttId: tt.id };
  };
  const buy = async (tok, ev, n = 1, provider = 'MOCK') => (await api('POST', '/orders/checkout', tok, { eventId: ev.id, provider, items: [{ ticketTypeId: ev.ttId, quantity: n }] })).data;

  // A — paid order: confirmation queued in the same transaction, sent with one QR image per ticket
  const ev = await mkEvent('P12 Kora <b>Night</b> & <script>alert(1)</script>');
  const b1 = await buyer('b1');
  const co = await buy(b1.tok, ev, 2);
  const a1 = await rows({ orderId: co.order.id });
  await run();
  const a2 = await rows({ orderId: co.order.id });
  const aPrev = previews(b1.email).find((p) => p.html.includes('Subject: Your 2 tickets'));
  const qrCount = aPrev ? (aPrev.html.match(/src="data:image\/png;base64,/g) || []).length : -1;
  check('A', 'Paid order → confirmation queued with the order, sent with 2 inline QR images',
    a1.length === 1 && a1[0].type === 'order_confirmed' && a2[0].status === 'SENT' && a2[0].toAddress === b1.email && (!logMode() || qrCount === 2),
    `queued ${a1.length} (${a1[0]?.type}), then ${a2[0]?.status} to ${a2[0]?.toAddress}, subject "${a2[0]?.subject}", QR images ${logMode() ? qrCount : 'n/a (SMTP mode)'}`);

  // B — event and user text is escaped in the HTML
  check('B', 'Event name with HTML/script is escaped, not rendered', !logMode() || (aPrev && !aPrev.html.includes('<script>alert(1)') && aPrev.html.includes('&lt;script&gt;alert(1)&lt;/script&gt;') && !aPrev.html.includes('<b>Night</b>')),
    logMode() ? (aPrev ? 'escaped' : 'preview not found') : 'n/a (SMTP mode)');

  // C — bank transfer: "complete your payment" email; confirmation after the organizer confirms it
  const b2 = await buyer('b2');
  const bt = await buy(b2.tok, ev, 1, 'BANK_TRANSFER');
  await run();
  const c1 = await rows({ orderId: bt.order.id });
  const pay = await prisma.payment.findFirst({ where: { orderId: bt.order.id } });
  await api('POST', `/payments/${pay.id}/confirm-bank-transfer`, organizer);
  await run();
  const c2 = await rows({ orderId: bt.order.id });
  const cPrev = previews(b2.email).find((p) => p.html.includes('Complete your payment'));
  check('C', 'Bank transfer → payment instructions email; confirmed → tickets email',
    c1.length === 1 && c1[0].type === 'order_awaiting_payment' && c1[0].status === 'SENT' && c2.length === 2 && c2.find((r) => r.type === 'order_confirmed')?.status === 'SENT' && (!logMode() || (cPrev && cPrev.html.includes(bt.order.id.slice(0, 8).toUpperCase()) && cPrev.html.includes(`D${(bt.order.total / 100).toFixed(2)}`))),
    `${c1.map((r) => `${r.type}:${r.status}`)} → ${c2.map((r) => `${r.type}:${r.status}`).join(', ')}`);

  // D — reservation expires: the customer hears about it, and the pending payment email is cancelled if unsent
  const b3 = await buyer('b3');
  const bt2 = await buy(b3.tok, ev, 1, 'BANK_TRANSFER');
  await run();
  await prisma.ticketOrder.update({ where: { id: bt2.order.id }, data: { expiresAt: new Date(Date.now() - 60_000) } });
  await buy(b1.tok, ev, 1); // any checkout releases lapsed reservations (the timer does too, every minute)
  await run();
  const d1 = await rows({ orderId: bt2.order.id });
  check('D', 'Lapsed bank-transfer reservation → "reservation expired" email', d1.some((r) => r.type === 'order_expired' && r.status === 'SENT'), d1.map((r) => `${r.type}:${r.status}`).join(', '));

  // E — event changes: one message per holder, delayed, coalesced across edits, nothing for drafts
  const b4 = await buyer('b4');
  await buy(b4.tok, ev, 1);
  await run();
  const e1 = await api('PUT', `/events/${ev.id}`, organizer, { startDate: iso(96), endDate: iso(100) });
  const e2 = await api('PUT', `/events/${ev.id}`, organizer, { venueId: other.id });
  const pend = await rows({ eventId: ev.id, type: 'event_changed', status: 'PENDING' });
  const holders = new Set((await prisma.ticket.findMany({ where: { ticketType: { eventId: ev.id }, status: 'ACTIVE' }, select: { ownerId: true } })).map((t) => t.ownerId));
  const delayed = pend.every((r) => r.sendAfter.getTime() > Date.now() + 60_000);
  await run();
  const stillPending = (await rows({ eventId: ev.id, type: 'event_changed', status: 'PENDING' })).length;
  await prisma.notification.updateMany({ where: { eventId: ev.id, type: 'event_changed', status: 'PENDING' }, data: { sendAfter: new Date() } });
  await run();
  const sent = await rows({ eventId: ev.id, type: 'event_changed' });
  const ePrev = previews(b4.email).find((p) => p.html.includes('Change to'));
  check('E', 'Time + venue edits → one delayed email per ticket holder, describing both changes',
    e1.status === 200 && e2.status === 200 && pend.length === holders.size && delayed && stillPending === pend.length && sent.every((r) => r.status === 'SENT') && (!logMode() || (ePrev && ePrev.html.includes('Date &amp; time') && ePrev.html.includes('Venue') && ePrev.html.includes(other.name))),
    `${holders.size} holders → ${pend.length} queued (delayed ${delayed}), not sent early (${stillPending} still pending), then ${sent.map((r) => r.status).join(',')}`);

  // F — a change that's undone before it goes out is dropped
  const evF = await mkEvent('P12 Undo');
  const b5 = await buyer('b5');
  await buy(b5.tok, evF, 1);
  await run();
  const origStart = evF.startDate, origEnd = evF.endDate;
  await api('PUT', `/events/${evF.id}`, organizer, { startDate: iso(80), endDate: iso(84) });
  await api('PUT', `/events/${evF.id}`, organizer, { startDate: origStart, endDate: origEnd });
  await prisma.notification.updateMany({ where: { eventId: evF.id, type: 'event_changed', status: 'PENDING' }, data: { sendAfter: new Date() } });
  await run();
  const f1 = await rows({ eventId: evF.id, type: 'event_changed' });
  const draft = await mkEvent('P12 Draft', 72, false);
  await api('PUT', `/events/${draft.id}`, organizer, { startDate: iso(90), endDate: iso(91) });
  const fDraft = await rows({ eventId: draft.id });
  const fName = await api('PUT', `/events/${evF.id}`, organizer, { description: 'Only the description' });
  const fNameRows = await rows({ eventId: evF.id, type: 'event_changed', status: 'PENDING' });
  check('F', 'Undone change → dropped (CANCELLED); draft events and description-only edits → no email',
    f1.length === 1 && f1[0].status === 'CANCELLED' && /undone/.test(f1[0].lastError) && fDraft.length === 0 && fName.status === 200 && fNameRows.length === 0,
    `undone ${f1.map((r) => `${r.status} (${r.lastError})`)}, draft ${fDraft.length}, description-only ${fNameRows.length}`);

  // G — cancellation: pending changes/reminders replaced by one cancellation email per holder
  const evG = await mkEvent('P12 Cancel');
  const b6 = await buyer('b6'); const b7 = await buyer('b7');
  await buy(b6.tok, evG, 2); await buy(b7.tok, evG, 1);
  await run();
  await api('PUT', `/events/${evG.id}`, organizer, { startDate: iso(100), endDate: iso(104) });
  const g0 = await api('POST', `/events/${evG.id}/cancel`, organizer);
  await run();
  const g1 = await rows({ eventId: evG.id, type: { in: ['event_changed', 'event_cancelled'] } });
  const gPrev = previews(b6.email).find((p) => p.html.includes('Subject: Cancelled'));
  check('G', 'Cancel → pending change dropped, one cancellation email per holder (with ticket count)',
    g0.status === 201 && g1.filter((r) => r.type === 'event_changed').every((r) => r.status === 'CANCELLED') && g1.filter((r) => r.type === 'event_cancelled' && r.status === 'SENT').length === 2 && (!logMode() || (gPrev && gPrev.html.includes('2 tickets are'))),
    g1.map((r) => `${r.type}:${r.status}`).join(', '));

  // H — reminders: within 24 h, not for recent buyers, once per event date
  const evH = await mkEvent('P12 Tomorrow', 20);
  const evFar = await mkEvent('P12 Next week', 30);
  const b8 = await buyer('b8'); const b9 = await buyer('b9');
  await buy(b8.tok, evH, 1); await buy(b9.tok, evH, 1); await buy(b8.tok, evFar, 1);
  await run();
  await prisma.ticket.updateMany({ where: { ownerId: b8.id ?? (await prisma.user.findUnique({ where: { email: b8.email } })).id }, data: { purchasedAt: new Date(Date.now() - 5 * 3600e3) } });
  const h1 = await api('POST', '/admin/notifications/scan-reminders', admin);
  const h2 = await api('POST', '/admin/notifications/scan-reminders', admin);
  await run();
  const hRows = await rows({ type: 'event_reminder', eventId: { in: [evH.id, evFar.id] } });
  const hPrev = previews(b8.email).find((p) => p.html.includes('Subject: Tomorrow'));
  check('H', 'Reminder: only events within 24 h, not for people who just bought, never twice; includes the QR',
    hRows.length === 1 && hRows[0].eventId === evH.id && hRows[0].status === 'SENT' && h2.data.queued === 0 && (!logMode() || (hPrev && (hPrev.html.match(/data:image\/png/g) || []).length === 1)),
    `scan 1 queued ≥${h1.data?.queued}, scan 2 queued ${h2.data?.queued}; reminders for these events: ${hRows.map((r) => `${r.eventId === evH.id ? 'tomorrow' : 'next week'}:${r.status}`)}`);

  // I — staff added to an event
  const staffEmail = uniq('staff');
  const i1 = await api('POST', `/events/${ev.id}/staff`, organizer, { email: staffEmail, role: 'GATE_STAFF', fullName: 'Gate Person', password: PW });
  await run();
  const staffUser = await prisma.user.findUnique({ where: { email: staffEmail } });
  const iRows = await rows({ userId: staffUser.id });
  const iPrev = previews(staffEmail)[0];
  check('I', 'Staff assigned → "you\'re on the team" email with the scanner link', i1.status === 201 && iRows.length === 1 && iRows[0].type === 'staff_assigned' && iRows[0].status === 'SENT' && (!logMode() || (iPrev && iPrev.html.includes('/scan') && iPrev.html.includes('gate staff'))),
    `${iRows.map((r) => `${r.type}:${r.status}`)}`);

  // J — password reset by email; no token in the response; rate limited
  const pwUser = await buyer('pw');
  const j1 = await api('POST', '/auth/forgot-password', null, { email: pwUser.email });
  const j0 = await api('POST', '/auth/forgot-password', null, { email: uniq('nobody') });
  await sleep(800);
  let token = null;
  if (logMode()) {
    const jp = previews(pwUser.email).find((p) => p.html.includes('reset-password#token='));
    token = jp ? decodeURIComponent(jp.html.match(/reset-password#token=([^"&<\s]+)/)[1]) : null;
  }
  const j2 = token ? await api('POST', '/auth/reset-password', null, { token, newPassword: 'a-brand-new-password-123' }) : { status: 'n/a' };
  const j3 = token ? await login(pwUser.email, 'a-brand-new-password-123') : 'n/a';
  for (let i = 0; i < 4; i++) await api('POST', '/auth/forgot-password', null, { email: pwUser.email });
  await sleep(800);
  const jRows = await rows({ userId: (await prisma.user.findUnique({ where: { email: pwUser.email } })).id, type: 'password_reset' });
  check('J', 'Password reset: same response for unknown emails, no token in the response, link by email works, max 3 per 15 min',
    (j1.status === 200 || j1.status === 201) && JSON.stringify(j1.data) === JSON.stringify(j0.data) && !('devOnlyResetToken' in (j1.data ?? {})) && jRows.length === 3 && jRows.every((r) => r.status === 'SENT' && r.payload === null) && (!logMode() || ((j2.status === 200 || j2.status === 201) && !!j3)),
    `response ${JSON.stringify(j1.data)}, unknown email identical: ${JSON.stringify(j1.data) === JSON.stringify(j0.data)}, reset via emailed link ${j2.status}, login with new password ${j3 ? 'ok' : 'FAILED'}, emails after 5 requests: ${jRows.length}`);

  // K — idempotent: the same order can't produce two confirmations
  const dup = await prisma.notification.count({ where: { orderId: co.order.id, type: 'order_confirmed' } });
  const k1 = await prisma.$executeRawUnsafe(`INSERT INTO notifications (id, "userId", channel, type, "dedupeKey", "orderId", "updatedAt") VALUES (gen_random_uuid(), $1, 'EMAIL', 'order_confirmed', $2, $3, now()) ON CONFLICT ("dedupeKey") DO NOTHING`, co.order.customerId, `order_confirmed:${co.order.id}`, co.order.id);
  check('K', 'One confirmation per order, even if queued twice (dedupe key)', dup === 1 && k1 === 0, `rows ${dup}, second insert affected ${k1}`);

  // L — admin view: list/summary/retry; others refused
  const l1 = await api('GET', '/admin/notifications?status=SENT&type=order_confirmed&pageSize=5', admin);
  const l2 = await api('GET', '/admin/notifications', organizer);
  const failed = await prisma.notification.create({ data: { userId: co.order.customerId, channel: 'EMAIL', type: 'order_confirmed', dedupeKey: `p12-retry-${Date.now()}`, orderId: co.order.id, eventId: ev.id, status: 'FAILED', attempts: 6, lastError: 'simulated' } });
  const l3 = await api('POST', `/admin/notifications/${failed.id}/retry`, admin);
  await run();
  const l4 = await prisma.notification.findUnique({ where: { id: failed.id } });
  const l5 = await api('POST', `/admin/notifications/${failed.id}/retry`, admin);
  const l6 = await api('GET', '/admin/notifications/summary', admin);
  check('L', 'Admin: list + summary; retry a failed email; organizer 403; retrying a sent one 400',
    l1.status === 200 && l1.data.items.length > 0 && l1.data.items.every((i) => i.status === 'SENT' && i.type === 'order_confirmed') && l2.status === 403 && l3.status === 201 && l4.status === 'SENT' && l5.status === 400 && l6.data.SENT > 0,
    `list ${l1.status} (${l1.data?.total} total), organizer ${l2.status}, retry ${l3.status} → ${l4.status}, again ${l5.status}, summary ${JSON.stringify(l6.data)}`);

  // M — retries with backoff: a message that fails is retried later, not lost
  const ghost = await prisma.notification.create({ data: { userId: co.order.customerId, channel: 'EMAIL', type: 'order_confirmed', dedupeKey: `p12-ghost-${Date.now()}`, orderId: '00000000-0000-4000-8000-000000000000', eventId: ev.id } });
  await run();
  const m1 = await prisma.notification.findUnique({ where: { id: ghost.id } });
  const unknown = await prisma.notification.create({ data: { userId: co.order.customerId, channel: 'EMAIL', type: 'no_such_type', dedupeKey: `p12-unknown-${Date.now()}` } });
  await run();
  const m2 = await prisma.notification.findUnique({ where: { id: unknown.id } });
  check('M', 'Messages whose subject is gone are CANCELLED with a reason (not retried forever)', m1.status === 'CANCELLED' && /not paid/.test(m1.lastError) && m2.status === 'CANCELLED',
    `missing order → ${m1.status} (${m1.lastError}), unknown type → ${m2.status} (${m2.lastError})`);

  // N — dashboard shows the organizer what went out
  const n1 = await api('GET', `/events/${ev.id}/dashboard`, organizer);
  check('N', 'Event dashboard reports emails sent/pending/failed', n1.status === 200 && n1.data.notifications && n1.data.notifications.sent >= 4, `notifications ${JSON.stringify(n1.data?.notifications)}`);

  const failedCount = results.filter((r) => !r.pass).length;
  console.log(`\n${results.length - failedCount}/${results.length} passed${logMode() ? '' : ' (email content checks skipped: SMTP mode)'}`);
  await prisma.$disconnect();
  process.exit(failedCount ? 1 : 0);
})().catch(async (e) => { console.error('RUN ERROR', e); await prisma.$disconnect(); process.exit(1); });
