// Phase 13: refunds and ticket transfers.
// node phase13-test.js   (backend running, seed data loaded)
// Email-content checks (and the transfer flow, which reads the accept link
// from the email) need MAIL_TRANSPORT=log, the default without SMTP_HOST.
const { PrismaClient } = require('@prisma/client');
const fs = require('fs');
const path = require('path');
const sharp = require('sharp');
let jsQR = null;
try { jsQR = require('../web/node_modules/jsqr'); } catch {}
const prisma = new PrismaClient();
const BASE = 'http://localhost:4000/api/v1';
const PREVIEWS = process.env.MAIL_PREVIEW_DIR ?? path.join(__dirname, 'mail-previews');
const started = Date.now();
const results = [];
async function api(method, p, token, body) {
  const res = await fetch(BASE + p, { method, headers: { 'Content-Type': 'application/json', ...(token ? { Authorization: `Bearer ${token}` } : {}) }, body: body ? JSON.stringify(body) : undefined });
  let data = null; try { data = await res.json(); } catch {}
  return { status: res.status, data };
}
const login = async (email, password = 'SeedPassword123!') => (await api('POST', '/auth/login', null, { email, password })).data?.accessToken;
const check = (id, name, pass, detail) => { results.push({ id, pass }); console.log(`${pass ? 'PASS' : 'FAIL'}  ${id.padEnd(3)} ${name} — ${detail}`); };
const uniq = (t) => `p13-${t}-${Date.now()}-${Math.random().toString(36).slice(2, 6)}@example.com`;
const PW = 'a-long-enough-password';
const msg = (r) => JSON.stringify(r.data?.message ?? r.data).slice(0, 120);
function previews(to, contains) {
  if (!fs.existsSync(PREVIEWS)) return [];
  return fs.readdirSync(PREVIEWS).map((f) => path.join(PREVIEWS, f)).filter((f) => fs.statSync(f).mtimeMs >= started - 1000)
    .map((f) => fs.readFileSync(f, 'utf8')).filter((h) => h.includes(`To: ${to}<br>`) && (!contains || h.includes(contains)));
}
let LOG = null;
const logMode = () => (LOG ??= fs.existsSync(PREVIEWS) && fs.readdirSync(PREVIEWS).some((f) => fs.statSync(path.join(PREVIEWS, f)).mtimeMs >= started - 1000));
async function qrFromHtml(html) {
  const b64 = html.match(/data:image\/png;base64,([^"]+)/)?.[1];
  if (!b64 || !jsQR) return null;
  const { data, info } = await sharp(Buffer.from(b64, 'base64')).ensureAlpha().raw().toBuffer({ resolveWithObject: true });
  return jsQR(new Uint8ClampedArray(data), info.width, info.height)?.data ?? null;
}

(async () => {
  const [admin, organizer] = await Promise.all(['admin', 'organizer'].map((u) => login(`${u}@example.com`)));
  const run = async () => { await api('POST', '/admin/refunds/run', admin); await api('POST', '/admin/notifications/run', admin); };
  const buyer = async (tag) => { const email = uniq(tag); const r = await api('POST', '/auth/register', null, { email, password: PW, fullName: `Buyer ${tag}` }); return { email, tok: r.data.accessToken, id: r.data.user.id }; };
  const venue = (await api('GET', '/venues')).data.find((v) => v.name === 'Independence Stadium');
  const cat = (await api('GET', '/categories')).data[0].id;
  const iso = (h) => new Date(Date.now() + h * 3600e3).toISOString();
  const mkEvent = async (name, extra = {}, startH = 24 * 10) => {
    const e = (await api('POST', '/events', organizer, { name, categoryId: cat, venueId: venue.id, startDate: iso(startH), endDate: iso(startH + 4), ...extra })).data;
    const tt = (await api('POST', '/ticket-types', organizer, { eventId: e.id, name: 'Regular', price: 20000, quantityTotal: 100 })).data;
    await api('POST', `/events/${e.id}/publish`, organizer);
    return { ...e, ttId: tt.id };
  };
  const buy = async (b, ev, n = 1, provider = 'MOCK') => (await api('POST', '/orders/checkout', b.tok, { eventId: ev.id, provider, items: [{ ticketTypeId: ev.ttId, quantity: n }] })).data;
  const scan = async (qrToken, ev) => (await api('POST', '/check-ins', organizer, { qrToken, eventId: ev.id })).data?.result;
  const sold = async (ev) => (await prisma.ticketType.findUnique({ where: { id: ev.ttId } })).quantitySold;

  // A — refund policy settings
  const a1 = await api('POST', '/events', organizer, { name: 'P13 bad policy', categoryId: cat, venueId: venue.id, startDate: iso(100), endDate: iso(101), refundPolicy: 'UNTIL_DAYS_BEFORE' });
  const evA = await mkEvent('P13 Anytime', { refundPolicy: 'UNTIL_DAYS_BEFORE', refundDaysBefore: 3 });
  const a2 = await api('PUT', `/events/${evA.id}`, organizer, { refundPolicy: 'ANYTIME' });
  const a3 = await api('PUT', `/events/${evA.id}`, organizer, { refundPolicy: 'BOGUS' });
  check('A', 'Refund policy: days required for UNTIL_DAYS_BEFORE, editable, validated', a1.status === 400 && evA.refundPolicy === 'UNTIL_DAYS_BEFORE' && evA.refundDaysBefore === 3 && a2.status === 200 && a2.data.refundPolicy === 'ANYTIME' && a2.data.refundDaysBefore === null && a3.status === 400,
    `missing days ${a1.status}, created ${evA.refundPolicy}/${evA.refundDaysBefore}, edit → ${a2.data?.refundPolicy}/${a2.data?.refundDaysBefore}, bogus ${a3.status}`);

  // B — eligibility: NONE refuses, ANYTIME allows
  const evNone = await mkEvent('P13 No refunds');
  const c1 = await buyer('c1');
  const oNone = await buy(c1, evNone, 1);
  const b1 = await api('POST', '/refunds', c1.tok, { orderId: oNone.order.id });
  const b2 = await api('GET', `/refunds/eligibility?orderId=${oNone.order.id}`, c1.tok);
  check('B', 'Policy NONE: request refused with the reason; eligibility explains', b1.status === 400 && /doesn’t offer refunds/.test(msg(b1)) && b2.data.tickets[0].allowed === false && /No refunds on request/.test(b2.data.policy.text),
    `request ${b1.status} ${msg(b1)}; eligibility ${JSON.stringify(b2.data?.tickets?.[0])}`);

  // C — request 2 of 3 tickets on an ANYTIME event
  const o3 = await buy(c1, evA, 3);
  const soldBefore = await sold(evA);
  const t = o3.order.tickets;
  const c2 = await api('POST', '/refunds', c1.tok, { orderId: o3.order.id, ticketIds: [t[0].id, t[1].id], reason: 'Two friends can’t come' });
  const orgUser = await prisma.user.findUnique({ where: { email: 'organizer@example.com' } });
  await run();
  const reqMail = await prisma.notification.findFirst({ where: { type: 'refund_requested', payload: { path: ['refundId'], equals: c2.data?.id } } });
  check('C', 'Customer requests 2 of 3 tickets → REQUESTED (ticket price only), organizer emailed, tickets still valid',
    c2.status === 201 && c2.data.status === 'REQUESTED' && c2.data.amount === 40000 && c2.data.feeAmount === 0 && c2.data.tickets.every((x) => x.status === 'ACTIVE') && reqMail?.userId === orgUser.id && reqMail.status === 'SENT',
    `${c2.status} ${c2.data?.status} amount ${c2.data?.amount} fee ${c2.data?.feeAmount}; organizer email ${reqMail?.status}`);

  // D — no double claims
  const d1 = await api('POST', '/refunds', c1.tok, { orderId: o3.order.id, ticketIds: [t[1].id] });
  const d2 = await api('POST', `/tickets/${t[0].id}/transfer`, c1.tok, { email: uniq('x') });
  const c9 = await buyer('c9');
  const d3 = await api('POST', '/refunds', c9.tok, { orderId: o3.order.id });
  const d4 = await api('POST', '/refunds', organizer, { orderId: o3.order.id });
  check('D', 'Same ticket twice 409; transfer during refund 409; someone else\'s order 404; organizer can\'t request 403', d1.status === 409 && d2.status === 409 && d3.status === 404 && d4.status === 403,
    `${d1.status} ${d2.status} ${d3.status} ${d4.status}`);

  // E — reject (needs a reason), then the customer can ask again
  const e1 = await api('POST', `/refunds/${c2.data.id}/reject`, organizer, {});
  const e2 = await api('POST', `/refunds/${c2.data.id}/reject`, organizer, { note: 'Refunds for this show need a doctor’s note' });
  await run();
  const e3 = await api('POST', '/refunds', c1.tok, { orderId: o3.order.id, ticketIds: [t[0].id, t[1].id] });
  const rejMail = previews(c1.email, 'Refund request declined')[0];
  const org2 = (await api('POST', '/auth/register-organizer', null, { email: uniq('org2'), password: PW, businessName: 'Other' })).data.accessToken;
  const e4 = await api('POST', `/refunds/${e3.data.id}/approve`, org2, {});
  check('E', 'Reject needs a note; rejected → email, tickets still valid, may ask again; other organizer can\'t decide (404)',
    e1.status === 400 && e2.status === 201 && e2.data.status === 'REJECTED' && e2.data.tickets.every((x) => x.status === 'ACTIVE') && e3.status === 201 && e4.status === 404 && (!logMode() || (rejMail && rejMail.includes('doctor'))),
    `no note ${e1.status}, reject ${e2.data?.status}, again ${e3.status}, other organizer ${e4.status}`);

  // F — approve → tickets void + back on sale; MOCK refunds by API → PROCESSED; refunded ticket can't get in
  const f1 = await api('POST', `/refunds/${e3.data.id}/approve`, organizer, { note: 'Sorry they can’t make it' });
  await run();
  const f2 = await prisma.refund.findUnique({ where: { id: e3.data.id } });
  const order = await prisma.ticketOrder.findUnique({ where: { id: o3.order.id } });
  const scanRefunded = await scan(t[0].qrToken, evA);
  const scanKept = (await prisma.ticket.findUnique({ where: { id: t[2].id } })).status; // the event is days away, so the gate would say WRONG_DATE
  const procMail = previews(c1.email, 'Refund sent')[0];
  const f3 = await api('POST', `/refunds/${e3.data.id}/approve`, organizer, {});
  check('F', 'Approve → tickets REFUNDED and back on sale, Mock refund PROCESSED, "refund sent" email; refunded QR → REFUNDED at the gate, the third ticket still valid',
    f1.status === 201 && f1.data.method === 'PROVIDER' && f2.status === 'PROCESSED' && order.status === 'PARTIALLY_REFUNDED' && (await sold(evA)) === soldBefore - 2 && scanRefunded === 'REFUNDED' && scanKept === 'ACTIVE' && f3.status === 409 && (!logMode() || (procMail && procMail.includes('D400.00'))),
    `approve ${f1.status} (${f1.data?.method}) → ${f2.status}, order ${order.status}, sold ${soldBefore}→${await sold(evA)}, scans: refunded ${scanRefunded}, kept ${scanKept}, approve again ${f3.status}`);

  // G — a ticket scanned after the request can't be approved
  const c2b = await buyer('c2b');
  const og = await buy(c2b, evA, 1);
  const g1 = await api('POST', '/refunds', c2b.tok, { orderId: og.order.id });
  // the event starts in 10 days; check-in only works close to the start, so mark it used directly
  await prisma.ticket.update({ where: { id: og.order.tickets[0].id }, data: { status: 'USED' } });
  const g2 = await api('POST', `/refunds/${g1.data.id}/approve`, organizer, {});
  const g3 = await prisma.refund.findUnique({ where: { id: g1.data.id } });
  check('G', 'Ticket used since the request → approve refused (409), request still open', g2.status === 409 && g3.status === 'REQUESTED', `${g2.status} ${msg(g2)} → ${g3.status}`);

  // H — withdraw
  const c3 = await buyer('c3');
  const oh = await buy(c3, evA, 1);
  const h1 = await api('POST', '/refunds', c3.tok, { orderId: oh.order.id });
  const h2 = await api('POST', `/refunds/${h1.data.id}/withdraw`, c3.tok);
  const h3 = await api('POST', `/refunds/${h1.data.id}/approve`, organizer, {});
  check('H', 'Customer withdraws; it can no longer be approved', h2.status === 201 && h2.data.status === 'WITHDRAWN' && h3.status === 409, `${h2.data?.status}, approve after ${h3.status}`);

  // I — date change → earlier buyers may ask whatever the policy; later buyers may not
  const evCh = await mkEvent('P13 Moved');
  const c4 = await buyer('c4');
  const oBefore = await buy(c4, evCh, 1);
  const i0 = await api('POST', '/refunds', c4.tok, { orderId: oBefore.order.id });
  await api('PUT', `/events/${evCh.id}`, organizer, { startDate: iso(24 * 12), endDate: iso(24 * 12 + 4) });
  const c5 = await buyer('c5');
  const oAfter = await buy(c5, evCh, 1);
  const i1 = await api('POST', '/refunds', c4.tok, { orderId: oBefore.order.id, reason: 'New date doesn’t work' });
  const i2 = await api('POST', '/refunds', c5.tok, { orderId: oAfter.order.id });
  const elig = await api('GET', `/refunds/eligibility?orderId=${oBefore.order.id}`, c4.tok);
  check('I', 'No-refund event moved → earlier buyer may request (basis "changed"), later buyer may not', i0.status === 400 && i1.status === 201 && i2.status === 400 && elig.data.tickets[0].allowed === false,
    `before change ${i0.status}, after change: early buyer ${i1.status}, late buyer ${i2.status}`);

  // J — organizer refunds directly across two orders; only admins may include the fee
  const c6 = await buyer('c6'); const c7 = await buyer('c7');
  const oj1 = await buy(c6, evNone, 2); const oj2 = await buy(c7, evNone, 1);
  const j1 = await api('POST', `/events/${evNone.id}/refunds`, organizer, { ticketIds: [oj1.order.tickets[0].id, oj2.order.tickets[0].id], reason: 'Seats double-booked' });
  const j2 = await api('POST', `/events/${evNone.id}/refunds`, organizer, { ticketIds: [oj1.order.tickets[1].id], includeFee: true });
  const j3 = await api('POST', `/events/${evNone.id}/refunds`, admin, { ticketIds: [oj1.order.tickets[1].id], includeFee: true });
  const j4 = await api('POST', `/events/${evNone.id}/refunds`, org2, { ticketIds: [oj1.order.tickets[1].id] });
  await run();
  const oj1Final = await prisma.ticketOrder.findUnique({ where: { id: oj1.order.id } });
  const oj1Refunds = await prisma.refund.findMany({ where: { orderId: oj1.order.id } });
  check('J', 'Organizer refunds 2 tickets from 2 orders (no fee); fee only by admin; other organizer 404; full order adds up to what was paid',
    j1.status === 201 && j1.data.length === 2 && j1.data.every((r) => r.feeAmount === 0 && r.amount === 20000) && j2.status === 403 && j3.status === 201 && j3.data[0].feeAmount === oj1.order.platformFee && j4.status === 404 && oj1Final.status === 'REFUNDED' && oj1Refunds.reduce((s, r) => s + r.amount, 0) === oj1.order.total,
    `2 refunds ${j1.data?.map?.((r) => r.amount)}, organizer fee ${j2.status}, admin fee ${j3.data?.[0]?.feeAmount}, other org ${j4.status}, order ${oj1Final.status}, refunded ${oj1Refunds.reduce((s, r) => s + r.amount, 0)} of ${oj1.order.total}`);

  // K — bank transfer: refund is MANUAL; admin pays it back by hand and marks it paid
  const c8 = await buyer('c8');
  const ob = await buy(c8, evA, 2, 'BANK_TRANSFER');
  const pay = await prisma.payment.findFirst({ where: { orderId: ob.order.id } });
  await api('POST', `/payments/${pay.id}/confirm-bank-transfer`, organizer);
  const k1 = await api('POST', '/refunds', c8.tok, { orderId: ob.order.id, ticketIds: [(await prisma.ticket.findFirst({ where: { orderId: ob.order.id } })).id] });
  const k2 = await api('POST', `/refunds/${k1.data.id}/approve`, organizer, {});
  await run();
  const k3 = await api('GET', '/admin/refunds?status=APPROVED&method=MANUAL', admin);
  const k4 = await api('POST', `/admin/refunds/${k1.data.id}/mark-paid`, admin, { reference: 'TRF-2026-1001' });
  const k5 = await api('POST', `/admin/refunds/${k1.data.id}/mark-paid`, admin, { reference: 'again' });
  const k6 = await api('POST', `/admin/refunds/${k1.data.id}/mark-paid`, organizer, { reference: 'x' });
  await run();
  const kMails = previews(c8.email);
  check('K', 'Bank transfer refund → MANUAL: "approved" email, in the admin payout list, mark-paid → PROCESSED + "sent" email; only once; admin only',
    k2.data.method === 'MANUAL' && k2.data.status === 'APPROVED' && k3.data.items.some((r) => r.id === k1.data.id) && k4.status === 201 && k4.data.status === 'PROCESSED' && k4.data.reference === 'TRF-2026-1001' && k5.status === 409 && k6.status === 403 && (!logMode() || (kMails.some((h) => h.includes('Refund approved')) && kMails.some((h) => h.includes('Refund sent') && h.includes('TRF-2026-1001')))),
    `method ${k2.data?.method}, in payout list ${k3.data?.items?.some((r) => r.id === k1.data.id)}, mark-paid ${k4.data?.status}, again ${k5.status}, organizer ${k6.status}`);

  // L — cancel with automatic refunds: everyone in full, fee included; open requests superseded
  const evX = await mkEvent('P13 Cancel auto', { refundPolicy: 'ANYTIME' });
  const x1 = await buyer('x1'); const x2 = await buyer('x2');
  const ox1 = await buy(x1, evX, 2); const ox2 = await buy(x2, evX, 1, 'BANK_TRANSFER');
  await api('POST', `/payments/${(await prisma.payment.findFirst({ where: { orderId: ox2.order.id } })).id}/confirm-bank-transfer`, organizer);
  const openReq = await api('POST', '/refunds', x1.tok, { orderId: ox1.order.id, ticketIds: [ox1.order.tickets[0].id] });
  const l1 = await api('POST', `/events/${evX.id}/cancel`, organizer, { refundMode: 'AUTOMATIC' });
  await run();
  const lr = await prisma.refund.findMany({ where: { order: { eventId: evX.id } } });
  const lx1 = lr.filter((r) => r.orderId === ox1.order.id && r.kind === 'EVENT_CANCELLED');
  const lx2 = lr.filter((r) => r.orderId === ox2.order.id);
  const superseded = lr.find((r) => r.id === openReq.data.id);
  const cancelMail = previews(x1.email, 'Cancelled:')[0];
  const ticketsLeft = await prisma.ticket.count({ where: { ticketType: { eventId: evX.id }, status: 'ACTIVE' } });
  check('L', 'Cancel (automatic): every order refunded in full incl. fee; Mock PROCESSED, bank MANUAL; open request superseded; email states the amount; no valid tickets left',
    l1.status === 201 && lx1.length === 1 && lx1[0].amount === ox1.order.total && lx1[0].status === 'PROCESSED' && lx2.length === 1 && lx2[0].method === 'MANUAL' && lx2[0].amount === ox2.order.total && superseded.status === 'WITHDRAWN' && ticketsLeft === 0 && (!logMode() || (cancelMail && cancelMail.includes(`full refund of D${(ox1.order.total / 100).toFixed(2)}`))),
    `x1: ${lx1.map((r) => `${r.amount}/${ox1.order.total} ${r.status}`)}, x2 bank: ${lx2.map((r) => `${r.method} ${r.status}`)}, request ${superseded?.status}, valid tickets left ${ticketsLeft}`);

  // M — cancel, organizer handles refunds: nothing automatic; holders may request (fee included) whatever the policy; admin can refund all later
  const evY = await mkEvent('P13 Cancel manual');
  const y1 = await buyer('y1'); const y2 = await buyer('y2');
  const oy1 = await buy(y1, evY, 1); const oy2 = await buy(y2, evY, 2);
  const m1 = await api('POST', `/events/${evY.id}/cancel`, organizer, { refundMode: 'ORGANIZER' });
  await run();
  const m2 = await prisma.refund.count({ where: { order: { eventId: evY.id } } });
  const m3 = await api('POST', '/refunds', y1.tok, { orderId: oy1.order.id });
  const mMail = previews(y2.email, 'Cancelled:')[0];
  const m4 = await api('POST', `/admin/events/${evY.id}/refund-all`, admin);
  await run();
  const my2 = await prisma.refund.findMany({ where: { orderId: oy2.order.id } });
  check('M', 'Cancel (organizer handles): no refunds yet; holder can request incl. fee despite NONE policy; email says so; admin refund-all later',
    m1.status === 201 && m2 === 0 && m3.status === 201 && m3.data.feeAmount === oy1.order.platformFee && m4.status === 201 && my2.length === 1 && my2[0].amount === oy2.order.total && my2[0].status === 'PROCESSED' && (!logMode() || (mMail && mMail.includes('ask for a full refund at any time'))),
    `refunds after cancel ${m2}, request ${m3.status} fee ${m3.data?.feeAmount}, refund-all ${m4.status} → y2 ${my2.map((r) => `${r.amount}/${oy2.order.total} ${r.status}`)}`);

  // N — dashboard: revenue net of refunds, refund counts
  const n1 = await api('GET', `/events/${evA.id}/dashboard`, organizer);
  const evARefunded = (await prisma.refund.aggregate({ where: { order: { eventId: evA.id }, status: { in: ['APPROVED', 'PROCESSED'] } }, _sum: { amount: true } }))._sum.amount;
  check('N', 'Event dashboard: refunded total, open requests, revenue net of refunds', n1.status === 200 && n1.data.refunds.refunded === evARefunded && n1.data.refunds.requests >= 1 && n1.data.settings.refundPolicy === 'ANYTIME',
    `refunds ${JSON.stringify(n1.data?.refunds)}, ticketRevenue ${n1.data?.summary?.ticketRevenue}`);

  // ---------- transfers ----------
  const evT = await mkEvent('P13 Transfers', { refundPolicy: 'ANYTIME' });
  const s1 = await buyer('sender');
  const ot = await buy(s1, evT, 2);
  const tk = ot.order.tickets[0];
  const r1 = await buyer('recipient');
  const of1 = await api('POST', `/tickets/${tk.id}/transfer`, s1.tok, { email: r1.email.toUpperCase() });
  const of2 = await api('POST', `/tickets/${tk.id}/transfer`, s1.tok, { email: uniq('other') });
  const of3 = await api('POST', `/tickets/${ot.order.tickets[1].id}/transfer`, s1.tok, { email: s1.email });
  const of4 = await api('POST', `/tickets/${tk.id}/transfer`, r1.tok, { email: uniq('z') });
  check('O', 'Offer by email (case-insensitive); one open offer per ticket; not to yourself; not someone else\'s ticket',
    of1.status === 201 && of1.data.status === 'PENDING' && of1.data.toEmail === r1.email.toLowerCase() && of1.data.emailed === true && of2.status === 409 && of3.status === 400 && of4.status === 404,
    `offer ${of1.status} to ${of1.data?.toEmail} emailed ${of1.data?.emailed}; second ${of2.status}, self ${of3.status}, not owner ${of4.status}`);

  if (!logMode()) {
    console.log('SKIP  P–S transfer acceptance: needs MAIL_TRANSPORT=log to read the accept link');
  } else {
    const offerMail = previews(r1.email, 'sent you a ticket')[0];
    const token = decodeURIComponent(offerMail.match(/transfer#token=([^"&<\s]+)/)[1]);
    const p1 = await api('POST', '/transfers/preview', null, { token });
    const stranger = await buyer('stranger');
    const p2 = await api('POST', '/transfers/accept', stranger.tok, { token });
    const p3 = await api('POST', '/transfers/accept', r1.tok, { token });
    await run();
    const moved = await prisma.ticket.findUnique({ where: { id: tk.id } });
    const recvMail = previews(r1.email, 'Your ticket for')[0];
    const newQr = recvMail ? await qrFromHtml(recvMail) : null;
    // the event is 10 days away; move it to now so the gate accepts scans
    await prisma.event.update({ where: { id: evT.id }, data: { startDate: new Date(Date.now() - 60_000) } });
    const oldScan = await scan(tk.qrToken, evT);
    const newScan = newQr ? await scan(newQr, evT) : 'no qr';
    await prisma.event.update({ where: { id: evT.id }, data: { startDate: new Date(Date.now() + 10 * 86400e3) } });
    const p4 = await api('POST', '/transfers/accept', r1.tok, { token });
    const senderMail = previews(s1.email, 'accepted your ticket')[0];
    check('P', 'Accept: preview without sign-in; wrong account 403; recipient becomes owner with a NEW QR (old → INVALID, new → VALID); sender told; link single-use',
      p1.status === 200 && p1.data.status === 'PENDING' && p1.data.event.name === 'P13 Transfers' && !JSON.stringify(p1.data).includes(s1.email) && p2.status === 403 && p3.status === 200 && moved.ownerId === r1.id && oldScan === 'INVALID' && newScan === 'VALID' && p4.status === 410 && !!senderMail,
      `preview ${p1.status} ${p1.data?.status}, stranger ${p2.status}, accept ${p3.status}, owner moved ${moved.ownerId === r1.id}, old QR ${oldScan}, new QR ${newScan}, reuse ${p4.status}, sender email ${!!senderMail}`);

    // Q — received tickets can't be refunded to the recipient; the buyer can't refund what they gave away
    const q1 = await api('POST', '/refunds', r1.tok, { orderId: ot.order.id });
    const q2 = await api('POST', '/refunds', s1.tok, { orderId: ot.order.id, ticketIds: [tk.id] });
    const q3 = await api('POST', '/refunds', s1.tok, { orderId: ot.order.id });
    check('Q', 'Transferred ticket: recipient can\'t refund (404, not their order), sender can\'t either (403); sender\'s other ticket still refundable',
      q1.status === 404 && q2.status === 403 && q3.status === 201 && q3.data.tickets.length === 1 && q3.data.tickets[0].id === ot.order.tickets[1].id,
      `recipient ${q1.status}, sender on given ticket ${q2.status}, sender rest ${q3.status} (${q3.data?.tickets?.length} ticket)`);

    // R — decline, cancel, expiry, disabled, organizer refund cancels a pending offer
    const s2 = await buyer('s2');
    const ot2 = await buy(s2, evT, 4);
    const [u1, u2, u3, u4] = ot2.order.tickets;
    const rcp = uniq('rcp');
    await api('POST', `/tickets/${u1.id}/transfer`, s2.tok, { email: rcp });
    const tokD = decodeURIComponent(previews(rcp, 'sent you a ticket')[0].match(/transfer#token=([^"&<\s]+)/)[1]);
    const r1d = await api('POST', '/transfers/decline', null, { token: tokD });
    const t2 = await api('POST', `/tickets/${u2.id}/transfer`, s2.tok, { email: uniq('c') });
    const r2c = await api('POST', `/transfers/${t2.data.id}/cancel`, s2.tok);
    const t3 = await api('POST', `/tickets/${u3.id}/transfer`, s2.tok, { email: rcp });
    await prisma.ticketTransfer.update({ where: { id: t3.data.id }, data: { expiresAt: new Date(Date.now() - 1000) } });
    const tokE = decodeURIComponent(previews(rcp, 'sent you a ticket').find((h) => h !== previews(rcp, 'sent you a ticket')[0])?.match(/transfer#token=([^"&<\s]+)/)?.[1] ?? '');
    const rcpUser = await buyer('rcp2');
    const r3 = tokE ? await api('POST', '/transfers/preview', null, { token: tokE }) : { data: {} };
    const t4 = await api('POST', `/tickets/${u4.id}/transfer`, s2.tok, { email: uniq('d') });
    await api('POST', `/events/${evT.id}/refunds`, organizer, { ticketIds: [u4.id] });
    const t4after = await prisma.ticketTransfer.findUnique({ where: { id: t4.data.id } });
    const evOff = await mkEvent('P13 No transfers', { transfersEnabled: false });
    const ooff = await buy(s2, evOff, 1);
    const r5 = await api('POST', `/tickets/${ooff.order.tickets[0].id}/transfer`, s2.tok, { email: uniq('e') });
    await run();
    const declinedMail = previews(s2.email, 'was declined')[0];
    const u1now = await prisma.ticket.findUnique({ where: { id: u1.id } });
    check('R', 'Decline (sender told, ticket stays theirs); sender cancels; expired link shows EXPIRED; refund cancels a pending offer; transfers off → 400',
      r1d.status === 200 && u1now.ownerId === s2.id && u1now.status === 'ACTIVE' && !!declinedMail && r2c.status === 201 && r2c.data.status === 'CANCELLED' && r3.data.status === 'EXPIRED' && t4after.status === 'CANCELLED' && r5.status === 400,
      `decline ${r1d.status}, ticket still sender's ${u1now.ownerId === s2.id}, cancel ${r2c.data?.status}, expired preview ${r3.data?.status}, offer after refund ${t4after.status}, disabled ${r5.status} ${msg(r5)}`);

    // S — my transfers
    const s3 = await api('GET', '/transfers/mine', s1.tok);
    const s4 = await api('GET', '/transfers/mine', r1.tok);
    check('S', 'GET /transfers/mine lists sent and received', s3.data.sent.some((x) => x.ticketId === tk.id && x.status === 'ACCEPTED') && s4.data.received.some((x) => x.ticketId === tk.id), `sent ${s3.data?.sent?.length}, received ${s4.data?.received?.length}`);
  }

  const failed = results.filter((r) => !r.pass).length;
  console.log(`\n${results.length - failed}/${results.length} passed`);
  await prisma.$disconnect();
  process.exit(failed ? 1 : 0);
})().catch(async (e) => { console.error('RUN ERROR', e); await prisma.$disconnect(); process.exit(1); });
