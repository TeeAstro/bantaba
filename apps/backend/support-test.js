// Phase 25: support messages (docs/support.md).
// node support-test.js   (backend running with RATE_LIMITS=off, seed data loaded)
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

(async () => {
  const [admin, org, buyer, staff] = await Promise.all([login('admin@example.com'), login('organizer@example.com'), login('customer@example.com'), login('staff@example.com')]);
  const buyerRow = await prisma.user.findUnique({ where: { email: 'customer@example.com' } });
  // Keep the buyer under the open limit from earlier runs.
  await prisma.supportThread.updateMany({ where: { userId: buyerRow.id, status: 'OPEN' }, data: { status: 'CLOSED' } });
  const order = await prisma.ticketOrder.findFirst({ where: { customerId: buyerRow.id }, orderBy: { createdAt: 'desc' }, include: { event: true } });
  const otherOrder = await prisma.ticketOrder.findFirst({ where: { customerId: { not: buyerRow.id } } });

  // A — a buyer writes about an order
  const anon = await api('POST', '/support', null, { topic: 'other', message: 'hi' });
  const notMine = await api('POST', '/support', buyer, { topic: 'order', orderId: otherOrder.id, message: 'x' });
  const noOrder = await api('POST', '/support', buyer, { topic: 'order', message: 'x' });
  const hostTopic = await api('POST', '/support', buyer, { topic: 'payouts', message: 'x' });
  const t = await api('POST', '/support', buyer, { topic: 'order', orderId: order.id, message: `I paid with Wave but my tickets haven't come ${tag}\nOrder from yesterday` });
  check('A', 'Buyer writes about their order: ref B-…, subject from the first line, order and event attached; signed out 401, someone else’s order / no order / a host topic refused',
    anon.status === 401 && notMine.status === 400 && noOrder.status === 400 && hostTopic.status === 400 && t.status === 201 && /^B-\d{4,}$/.test(t.data.ref) && t.data.subject === `I paid with Wave but my tickets haven't come ${tag}` && t.data.context.order?.id === order.id && t.data.context.event?.id === order.eventId && t.data.messages.length === 1,
    `anon ${anon.status}, not mine ${notMine.status}, no order ${noOrder.status}, host topic ${hostTopic.status}; ${t.status} ${t.data?.ref} "${t.data?.subject}"`);

  // B — admins are emailed
  const adminMail = await prisma.notification.count({ where: { type: 'support_new', payload: { path: ['threadId'], equals: t.data.id } } });
  const admins = await prisma.user.count({ where: { role: 'ADMIN' } });
  check('B', 'Every admin gets a "Support B-…" email', adminMail === admins && admins > 0, `${adminMail} of ${admins}`);

  // C — the admin inbox
  const list = await api('GET', '/admin/support?status=open', admin);
  const row = list.data?.threads?.find((x) => x.id === t.data.id);
  const count = await api('GET', '/admin/support/count', admin);
  const one = await api('GET', `/admin/support/${t.data.id}`, admin);
  const orgSees = await api('GET', '/admin/support', org);
  check('C', 'Inbox: listed under Open as a buyer, counted; the thread shows the person and the order (status, tickets, payment); hosts can’t open the inbox',
    !!row && row.fromRole === 'buyer' && count.data.open >= 1 && list.data.counts.open === count.data.open && one.data.person.email === 'customer@example.com' && one.data.context.order.status === order.status && one.data.context.order.short.startsWith('#') && orgSees.status === 403,
    `row ${!!row}; open ${count.data?.open}; person ${one.data?.person?.email}; order ${one.data?.context?.order?.short} ${one.data?.context?.order?.status}; host ${orgSees.status}`);

  // D — reply: emailed, waiting, "new reply" mark until read
  const reply = await api('POST', `/admin/support/${t.data.id}/reply`, admin, { message: 'Your Wave payment is still being confirmed. We’ll check it now.' });
  const replyMail = await prisma.notification.findFirst({ where: { type: 'support_reply', userId: buyerRow.id, payload: { path: ['threadId'], equals: t.data.id } } });
  const mine1 = await api('GET', '/support/mine', buyer);
  const read = await api('GET', `/support/${t.data.id}`, buyer);
  const mine2 = await api('GET', '/support/mine', buyer);
  check('D', 'Admin replies: thread Waiting, buyer emailed; "new reply" shows until they open it',
    reply.status === 200 && reply.data.status === 'WAITING' && !!replyMail && mine1.data.find((x) => x.id === t.data.id)?.newReply === true && read.data.messages[1]?.fromBantaba === true && mine2.data.find((x) => x.id === t.data.id)?.newReply === false,
    `reply ${reply.status} ${reply.data?.status}; email ${!!replyMail}; new ${mine1.data?.find((x) => x.id === t.data.id)?.newReply} → ${mine2.data?.find((x) => x.id === t.data.id)?.newReply}`);

  // E — they answer back: open again; closed ones reopen
  const back = await api('POST', `/support/${t.data.id}/messages`, buyer, { message: 'Thanks, it says paid on Wave.' });
  const close = await api('POST', `/admin/support/${t.data.id}/close`, admin);
  const after = await api('POST', `/support/${t.data.id}/messages`, buyer, { message: 'One more thing' });
  const followMail = await prisma.notification.count({ where: { type: 'support_new', payload: { path: ['threadId'], equals: t.data.id } } });
  check('E', 'Their answer opens it again and emails admins; writing to a closed one reopens it',
    back.data?.status === 'OPEN' && close.data?.status === 'CLOSED' && after.data?.status === 'OPEN' && after.data.messages.length === 4 && followMail === admins * 3,
    `back ${back.data?.status}; close ${close.data?.status}; after ${after.data?.status}, ${after.data?.messages?.length} messages; admin emails ${followMail}`);

  // F — privacy
  const other = await api('GET', `/support/${t.data.id}`, org);
  const otherAdd = await api('POST', `/support/${t.data.id}/messages`, org, { message: 'x' });
  const staffNew = await api('POST', '/support', staff, { topic: 'other', message: 'x' });
  check('F', 'Only the writer sees their thread (404 for others); staff accounts can’t write here',
    other.status === 404 && otherAdd.status === 404 && staffNew.status === 403, `view ${other.status}, add ${otherAdd.status}, staff ${staffNew.status}`);

  // G — a host writes about their event; not someone else's
  const ownEvent = await prisma.event.findFirst({ where: { organizer: { user: { email: 'organizer@example.com' } } } });
  const foreignEvent = await prisma.event.findFirst({ where: { organizer: { user: { email: { not: 'organizer@example.com' } } } } });
  const h = await api('POST', '/support', org, { topic: 'event', eventId: ownEvent.id, message: `Still in review ${tag}` });
  const hBad = await api('POST', '/support', org, { topic: 'event', eventId: foreignEvent.id, message: 'x' });
  const hOrder = await api('POST', '/support', org, { topic: 'order', message: 'x' });
  const hRow = (await api('GET', '/admin/support', admin)).data.threads.find((x) => x.id === h.data?.id);
  check('G', 'Host writes about their own event (marked host in the inbox); another host’s event or the buyer-only "order" topic refused',
    h.status === 201 && h.data.context.event.id === ownEvent.id && hRow?.fromRole === 'host' && hBad.status === 400 && hOrder.status === 400,
    `${h.status}; inbox ${hRow?.fromRole}; other event ${hBad.status}; order topic ${hOrder.status}`);

  // H — limits and contacts
  await prisma.supportThread.updateMany({ where: { userId: buyerRow.id, status: 'OPEN' }, data: { status: 'CLOSED' } });
  const made = [];
  for (let i = 0; i < 6; i++) made.push((await api('POST', '/support', buyer, { topic: 'other', message: `q${i} ${tag}` })).status);
  const contacts = await api('GET', '/support/contacts');
  const empty = await api('POST', '/support', buyer, { topic: 'other', message: '   ' });
  await prisma.supportThread.updateMany({ where: { userId: buyerRow.id, status: 'OPEN' }, data: { status: 'CLOSED' } });
  check('H', 'At most 5 waiting at once (the 6th refused); an empty message refused; contacts are public',
    made.slice(0, 5).every((s) => s === 201) && made[5] === 400 && contacts.status === 200 && 'whatsapp' in contacts.data && empty.status === 400,
    `${made.join(',')}; contacts ${contacts.status}; empty ${empty.status}`);

  const failed = results.filter((r) => !r.pass);
  console.log(`\n${results.length - failed.length}/${results.length} passed`);
  await prisma.$disconnect();
  process.exit(failed.length ? 1 : 0);
})().catch(async (e) => { console.error(e); await prisma.$disconnect(); process.exit(1); });
