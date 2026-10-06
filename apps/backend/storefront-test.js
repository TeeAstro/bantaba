// Phase 16 storefront: Discover by host, price labels, Trending, guest checkout,
// the 5-minute hold and email-code sign-in (docs/storefront.md).
// node storefront-test.js   (backend running with TRENDING_CACHE_SECONDS=0 RATE_LIMITS=off, seed data loaded)
const { PrismaClient } = require('@prisma/client');
const fs = require('fs');
const path = require('path');
const { priceLabel } = require('./dist/storefront/price-label');
const prisma = new PrismaClient();
const BASE = 'http://localhost:4000/api/v1';
const results = [];
async function api(method, p, token, body, headers = {}) {
  const res = await fetch(BASE + p, { method, headers: { 'Content-Type': 'application/json', ...(token ? { Authorization: `Bearer ${token}` } : {}), ...headers }, body: body ? JSON.stringify(body) : undefined });
  let data = null; try { data = await res.json(); } catch {}
  return { status: res.status, data };
}
const login = async (email, password = 'SeedPassword123!') => (await api('POST', '/auth/login', null, { email, password })).data?.accessToken;
const check = (id, name, pass, detail) => { results.push({ id, pass }); console.log(`${pass ? 'PASS' : 'FAIL'}  ${id.padEnd(3)} ${name} — ${detail}`); };
const tag = Math.random().toString(36).slice(2, 7);
const uniq = (t) => `store-${t}-${Date.now()}-${tag}@example.com`;
const PW = 'a-long-enough-password';
const iso = (h) => new Date(Date.now() + h * 3600e3).toISOString();
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const near = (d, ms, slack = 60_000) => Math.abs(new Date(d).getTime() - (Date.now() + ms)) < slack;

// The newest sign-in email to that address (MAIL_TRANSPORT=log writes previews).
function lastMailTo(email, type) {
  const dir = path.join(__dirname, 'mail-previews');
  const files = fs.readdirSync(dir).filter((f) => f.includes(type)).sort().reverse();
  for (const f of files.slice(0, 50)) {
    const html = fs.readFileSync(path.join(dir, f), 'utf8');
    if (html.includes(`To: ${email}`)) return html;
  }
  return null;
}

(async () => {
  const [admin, organizer] = await Promise.all([login('admin@example.com'), login('organizer@example.com')]);
  const venue = (await api('GET', '/venues')).data[0];
  const cat = (await api('GET', '/categories')).data[0].id;
  const seedOrg = await prisma.organizer.findFirst({ where: { user: { email: 'organizer@example.com' } } });

  // A second host, approved and trusted (publishes without review), no blue tick yet.
  const hostEmail = uniq('host');
  const reg = await api('POST', '/auth/register-organizer', null, { email: hostEmail, password: PW, businessName: `Kololi Nights ${tag}` });
  await prisma.organizer.update({ where: { id: reg.data.organizer.id }, data: { verificationStatus: 'APPROVED', trustLevel: 'TRUSTED', location: 'Kololi' } });
  const host2 = await login(hostEmail, PW);
  const host2Id = reg.data.organizer.id;

  const makeEvent = async (token, name, startH, types) => {
    const ev = (await api('POST', '/events', token, { name: `${name} ${tag}`, categoryId: cat, venueId: venue.id, startDate: iso(startH), endDate: iso(startH + 4) })).data;
    const tts = [];
    for (const t of types) tts.push((await api('POST', '/ticket-types', token, { eventId: ev.id, ...t })).data);
    const pub = await api('POST', `/events/${ev.id}/publish`, token);
    return { ...ev, tts, published: pub.status };
  };

  // A — price label rule (unit)
  const T = (price, total = 10, sold = 0, extra = {}) => ({ price, currency: 'GMD', quantityTotal: total, quantitySold: sold, isActive: true, salesStart: null, salesEnd: null, ...extra });
  const labels = [
    priceLabel([T(25000)]).label,
    priceLabel([T(20000), T(50000)]).label,
    priceLabel([T(25000), T(25000)]).label,
    priceLabel([T(0), T(30000)]).label,
    priceLabel([T(20000, 5, 5), T(30000, 5, 5)]).label,
    priceLabel([T(20000, 5, 5), T(30000)]).label,
    priceLabel([T(20000, 5, 0, { salesStart: new Date(Date.now() + 86400e3) })]).label,
    priceLabel([T(125000)]).label,
    priceLabel([T(1250)]).label,
  ];
  check('A', 'Price labels: one price, several (cheapest on sale), same price twice, free, sold out, cheapest sold out, not open yet, thousands, butut',
    JSON.stringify(labels) === JSON.stringify(['D250', 'From D200', 'D250', 'Free', 'Sold out', 'D300', 'On sale soon', 'D1,250', 'D12.50']),
    labels.join(' | '));

  // Events: host 2 has three (24h, 48h, 240h); the seed organizer one at 30h
  const e1 = await makeEvent(host2, 'Sunset Jam', 24, [{ name: 'General', price: 30000, quantityTotal: 200 }, { name: 'VIP', price: 75000, quantityTotal: 50 }]);
  const e2 = await makeEvent(host2, 'Beach Party', 48, [{ name: 'General', price: 25000, quantityTotal: 200 }]);
  const e3 = await makeEvent(host2, 'New Year', 240, [{ name: 'General', price: 50000, quantityTotal: 100 }]);
  const e4 = await makeEvent(organizer, 'Comedy Night', 30, [{ name: 'Seat', price: 15000, quantityTotal: 100 }]);

  // B — Discover groups by host, two each, with total and labels
  const d = (await api('GET', `/storefront/discover?q=${tag}&limit=50`)).data;
  const h2 = d.hosts.find((h) => h.id === host2Id);
  const hs = d.hosts.find((h) => h.id === seedOrg.id);
  check('B', 'Discover: a host shows its next 2 of 3 events (soonest first) with total 3, town and labels; hosts ordered by next event; search has no Trending',
    [e1, e2, e3, e4].every((e) => e.published === 201 || e.published === 200) && h2 && h2.total === 3 && h2.events.length === 2 && h2.events[0].id === e1.id && h2.events[1].id === e2.id &&
      h2.location === 'Kololi' && h2.events[0].price.label === 'From D300' && h2.events[1].price.label === 'D250' && hs && d.hosts.indexOf(h2) < d.hosts.indexOf(hs) && d.trending.length === 0,
    `hosts ${d.hosts.length}; host2 ${h2?.total}/${h2?.events.map((e) => e.price.label).join(',')}; order ${d.hosts.map((h) => h.businessName).join(' > ')}`);

  // C — date buttons
  const in10 = new Date(Date.now() + 240 * 3600e3).toISOString().slice(0, 10);
  const wk = (await api('GET', `/storefront/discover?when=week&q=${tag}&limit=50`)).data;
  const day = (await api('GET', `/storefront/discover?when=date&date=${in10}&q=${tag}&limit=50`)).data;
  const bad = await api('GET', '/storefront/discover?when=date');
  const ids = (r) => r.hosts.flatMap((h) => h.events.map((e) => e.id));
  check('C', 'Next 7 days leaves out the event in 10 days; that date shows only it; a date button without a date is refused',
    ids(wk).includes(e1.id) && !ids(wk).includes(e3.id) && ids(day).length === 1 && ids(day)[0] === e3.id && bad.status === 400,
    `week ${ids(wk).length} events; date ${ids(day).length}; no date ${bad.status}`);

  // Sales for the best sellers: e1 12 tickets, e2 8 (same host), e4 4
  const buyer = async () => (await api('POST', '/auth/register', null, { email: uniq('b'), password: PW })).data.accessToken;
  const buy = async (ev, qty) => (await api('POST', '/orders/checkout', await buyer(), { eventId: ev.id, provider: 'MOCK', items: [{ ticketTypeId: ev.tts[0].id, quantity: qty }] })).status;
  const bought = [await buy(e1, 6), await buy(e1, 6), await buy(e2, 8), await buy(e4, 4)];

  // D — best sellers, one per host
  await api('PATCH', '/admin/trending/settings', admin, { count: 8, onePerHost: true });
  const v1 = (await api('GET', '/admin/trending', admin)).data;
  const inRow = (v, id) => v.row.some((c) => c.id === id);
  const e2next = v1.next.find((n) => n.id === e2.id);
  const e1card = v1.row.find((c) => c.id === e1.id);
  check('D', 'Best sellers: Sunset Jam (12 sold) in the row tagged "12 sold this week"; Beach Party (8, same host) next in line marked Same host',
    bought.every((s) => s === 201) && e1card && e1card.tag === '12 sold this week' && !e1card.picked && !inRow(v1, e2.id) && e2next?.reason === 'Same host',
    `buys ${bought.join(',')}; row ${v1.row.map((c) => `${c.name.split(' ')[0]}:${c.soldLast7Days}`).join(' ')}; next ${v1.next.map((n) => `${n.name.split(' ')[0]}:${n.reason}`).join(' ')}`);

  // E — settings: one per host off; 5 cards refused
  await api('PATCH', '/admin/trending/settings', admin, { onePerHost: false });
  const v2 = (await api('GET', '/admin/trending', admin)).data;
  const five = await api('PATCH', '/admin/trending/settings', admin, { count: 5 });
  const notAdmin = await api('GET', '/admin/trending', organizer);
  await api('PATCH', '/admin/trending/settings', admin, { onePerHost: true });
  check('E', 'One event per host off: both host events in the row; 5 cards refused; organizers can’t open admin Trending',
    inRow(v2, e1.id) && inRow(v2, e2.id) && v2.settings.onePerHost === false && five.status === 400 && notAdmin.status === 403,
    `both ${inRow(v2, e1.id) && inRow(v2, e2.id)}; count 5 → ${five.status}; organizer ${notAdmin.status}`);

  // F — hide and show again
  const hide = await api('POST', '/admin/trending/hidden', admin, { eventId: e1.id });
  const v3 = (await api('GET', '/admin/trending', admin)).data;
  const pub3 = (await api('GET', '/storefront/discover')).data;
  const unhide = await api('DELETE', `/admin/trending/hidden/${e1.id}`, admin);
  const v4 = (await api('GET', '/admin/trending', admin)).data;
  check('F', 'Hide: out of the row (admin and public), listed as hidden; Show again puts it back',
    hide.status === 200 && !inRow(v3, e1.id) && v3.hidden.some((h) => h.eventId === e1.id) && !pub3.trending.some((c) => c.id === e1.id) && unhide.status === 200 && inRow(v4, e1.id),
    `hide ${hide.status}, hidden list ${v3.hidden.length}; unhide ${unhide.status}`);

  // G — picks: blue tick only, up to 3, order, until, remove
  const noTick = await api('POST', '/admin/trending/picks', admin, { eventId: e3.id });
  await prisma.organizer.update({ where: { id: host2Id }, data: { verifiedBadge: true, verifiedBadgeAt: new Date() } });
  const search = (await api('GET', `/admin/trending/search?q=${tag}`, admin)).data;
  const p1 = await api('POST', '/admin/trending/picks', admin, { eventId: e3.id });
  const p2 = await api('POST', '/admin/trending/picks', admin, { eventId: e2.id, until: new Date(Date.now() + 86400e3).toISOString().slice(0, 10) });
  const dup = await api('POST', '/admin/trending/picks', admin, { eventId: e3.id });
  const late = await api('PATCH', `/admin/trending/picks/${p1.data.id}`, admin, { until: '2099-01-01' });
  const v5 = (await api('GET', '/admin/trending', admin)).data;
  const pub5 = (await api('GET', '/storefront/discover')).data;
  check('G', 'Picks: refused without a blue tick, then allowed; picks lead the row in order, tagged "Bantaba pick"; a later "until" is cut to the event’s end; picking twice refused; public cards hide admin fields',
    noTick.status === 400 && search.find((s) => s.id === e3.id)?.canPick === true && search.find((s) => s.id === e4.id)?.canPick === false && p1.status === 201 && p2.status === 201 && dup.status === 409 &&
      v5.row[0].id === e3.id && v5.row[1].id === e2.id && v5.row[0].tag === 'Bantaba pick' && v5.row[0].picked &&
      new Date(late.data.until).getTime() === new Date(e3.endDate).getTime() && pub5.trending[0].id === e3.id && !('soldLast7Days' in pub5.trending[0]) && !('pickId' in pub5.trending[0]),
    `no tick ${noTick.status}; picks ${p1.status},${p2.status}; dup ${dup.status}; row ${v5.row.slice(0, 2).map((c) => c.tag).join(', ')}; until clamped ${new Date(late.data?.until).getTime() === new Date(e3.endDate).getTime()}`);

  // H — reorder, the 3-pick limit, remove
  const ro = await api('PUT', '/admin/trending/picks/order', admin, { ids: [p2.data.id, p1.data.id] });
  const roBad = await api('PUT', '/admin/trending/picks/order', admin, { ids: [p2.data.id] });
  const v6 = (await api('GET', '/admin/trending', admin)).data;
  const e5 = await makeEvent(host2, 'Jazz', 72, [{ name: 'General', price: 20000, quantityTotal: 50 }]);
  const e6 = await makeEvent(host2, 'Film', 96, [{ name: 'General', price: 10000, quantityTotal: 50 }]);
  const p3 = await api('POST', '/admin/trending/picks', admin, { eventId: e5.id });
  const p4 = await api('POST', '/admin/trending/picks', admin, { eventId: e6.id });
  const audit = await prisma.auditLog.count({ where: { entityType: 'Trending', action: { startsWith: 'trending_' }, createdAt: { gt: new Date(Date.now() - 600e3) } } });
  for (const p of [p1, p2, p3]) await api('DELETE', `/admin/trending/picks/${p.data.id}`, admin);
  const v7 = (await api('GET', '/admin/trending', admin)).data;
  check('H', 'Reorder: needs every pick once; new order shown; a 4th pick refused; removing clears them; changes are in the audit log',
    ro.status === 200 && roBad.status === 400 && v6.picks[0].id === p2.data.id && p3.status === 201 && p4.status === 409 && v7.picks.length === 0 && audit >= 8,
    `reorder ${ro.status}/${roBad.status}; 3rd ${p3.status}, 4th ${p4.status}; left ${v7.picks.length}; audit rows ${audit}`);

  // I — guest checkout holds for 5 minutes and gives a private key
  const gEmail = uniq('guest');
  const g = await api('POST', '/orders/guest-checkout', null, { eventId: e2.id, fullName: 'Awa Jallow', email: gEmail.toUpperCase(), phone: '+220 301 2345', items: [{ ticketTypeId: e2.tts[0].id, quantity: 2 }] });
  const gUser = await prisma.user.findFirst({ where: { email: gEmail } });
  const withKey = await api('GET', `/orders/${g.data.order?.id}`, null, null, { 'X-Order-Token': g.data.orderToken });
  const noKey = await api('GET', `/orders/${g.data.order?.id}`);
  const wrongKey = await api('GET', `/orders/${g.data.order?.id}`, null, null, { 'X-Order-Token': 'nope' });
  const pwLogin = await api('POST', '/auth/login', null, { email: gEmail, password: PW });
  check('I', 'Guest checkout: order held (PENDING, ~5 minutes), account made in lower case with name and phone but no usable password; key opens the order, no key or a wrong key gets 404; no key hash in replies',
    g.status === 201 && g.data.order.status === 'PENDING' && near(g.data.order.expiresAt, 5 * 60e3) && typeof g.data.orderToken === 'string' && gUser?.fullName === 'Awa Jallow' && gUser?.phone === '+2203012345' &&
      withKey.status === 200 && noKey.status === 404 && wrongKey.status === 404 && pwLogin.status === 401 && !('guestTokenHash' in g.data.order) && !('guestTokenHash' in withKey.data),
    `guest ${g.status}; expires in ${Math.round((new Date(g.data.order?.expiresAt) - Date.now()) / 1000)}s; key ${withKey.status}, none ${noKey.status}, wrong ${wrongKey.status}; password ${pwLogin.status}`);

  // J — one hold per buyer per event; at most 10 tickets; Host emails refused
  const soldBefore = (await prisma.ticketType.findUnique({ where: { id: e2.tts[0].id } })).quantitySold;
  const g2 = await api('POST', '/orders/guest-checkout', null, { eventId: e2.id, fullName: 'Awa Jallow', email: gEmail, items: [{ ticketTypeId: e2.tts[0].id, quantity: 1 }] });
  const first = await prisma.ticketOrder.findUnique({ where: { id: g.data.order.id } });
  const soldAfter = (await prisma.ticketType.findUnique({ where: { id: e2.tts[0].id } })).quantitySold;
  const tooMany = await api('POST', '/orders/guest-checkout', null, { eventId: e1.id, fullName: 'Big Group', email: uniq('big'), items: [{ ticketTypeId: e1.tts[0].id, quantity: 11 }] });
  const hostMail = await api('POST', '/orders/guest-checkout', null, { eventId: e1.id, fullName: 'Organizer', email: 'organizer@example.com', items: [{ ticketTypeId: e1.tts[0].id, quantity: 1 }] });
  // Since the security review (Phase 21b) a guest checkout doesn't replace an
  // earlier hold (anyone can type an email); it runs out after 5 minutes.
  // A signed-in buyer choosing again still replaces theirs (security-test.js I).
  check('J', 'A second guest checkout leaves the first hold alone (it runs out); 11 tickets refused; a Bantaba Host email can’t buy as a guest',
    g2.status === 201 && first.status === 'PENDING' && soldAfter === soldBefore + 1 && tooMany.status === 400 && hostMail.status === 409,
    `second ${g2.status}; first ${first.status}; held ${soldBefore} → ${soldAfter}; 11 → ${tooMany.status}; host email ${hostMail.status}`);

  // K — paying: Wave not set up keeps the hold; bank transfer holds 24 hours; mock pays
  const key = { 'X-Order-Token': g2.data.orderToken };
  const wave = await api('POST', `/orders/${g2.data.order.id}/pay`, null, { provider: 'WAVE' }, key);
  const afterWave = await prisma.ticketOrder.findUnique({ where: { id: g2.data.order.id } });
  const noKeyPay = await api('POST', `/orders/${g2.data.order.id}/pay`, null, { provider: 'MOCK' });
  const bank = await api('POST', `/orders/${g2.data.order.id}/pay`, null, { provider: 'BANK_TRANSFER' }, key);
  const afterBank = await prisma.ticketOrder.findUnique({ where: { id: g2.data.order.id } });
  const mock = await api('POST', `/orders/${g2.data.order.id}/pay`, null, { provider: 'MOCK' }, key);
  const payments = await prisma.payment.findMany({ where: { orderId: g2.data.order.id }, orderBy: { createdAt: 'asc' } });
  const again = await api('POST', `/orders/${g2.data.order.id}/pay`, null, { provider: 'MOCK' }, key);
  const paidView = await api('GET', `/orders/${g2.data.order.id}`, null, null, key);
  check('K', 'Pay: Wave not set up → 503 and the hold stays; no key → 404; bank transfer extends the hold to ~24 h; switching to another way cancels the bank payment; paid with 1 ticket (QR, venue); paying again → 409',
    wave.status === 503 && afterWave.status === 'PENDING' && noKeyPay.status === 404 && bank.status === 200 && near(afterBank.expiresAt, 24 * 3600e3) &&
      mock.status === 200 && mock.data.order.status === 'PAID' && payments.map((p) => p.status).join(',') === 'CANCELLED,SUCCESSFUL' && again.status === 409 &&
      paidView.data.tickets.length === 1 && !!paidView.data.tickets[0].qrCodeSvg && paidView.data.event.venue?.name === venue.name,
    `wave ${wave.status} (${afterWave.status}); no key ${noKeyPay.status}; bank ${bank.status} +${Math.round((new Date(afterBank.expiresAt) - Date.now()) / 3600e3)}h; mock ${mock.status} ${mock.data?.order?.status}; payments ${payments.map((p) => `${p.provider}:${p.status}`).join(',')}; again ${again.status}`);

  // L — the hold runs out
  const g3 = await api('POST', '/orders/guest-checkout', null, { eventId: e1.id, fullName: 'Late Buyer', email: uniq('late'), items: [{ ticketTypeId: e1.tts[0].id, quantity: 1 }] });
  await prisma.ticketOrder.update({ where: { id: g3.data.order.id }, data: { expiresAt: new Date(Date.now() - 1000) } });
  const late3 = await api('POST', `/orders/${g3.data.order.id}/pay`, null, { provider: 'MOCK' }, { 'X-Order-Token': g3.data.orderToken });
  const g3o = await prisma.ticketOrder.findUnique({ where: { id: g3.data.order.id } });
  check('L', 'A hold that ran out can’t be paid: 409 and the order is cancelled',
    late3.status === 409 && g3o.status === 'CANCELLED', `${late3.status} ${late3.data?.message}; ${g3o.status}`);

  // M — signed-in: hold first, then pay with the session
  const cust = await buyer();
  const held = await api('POST', '/orders/checkout', cust, { eventId: e4.id, items: [{ ticketTypeId: e4.tts[0].id, quantity: 1 }] });
  const paidM = await api('POST', `/orders/${held.data.order.id}/pay`, cust, { provider: 'MOCK' });
  const otherCust = await buyer();
  const peek = await api('GET', `/orders/${held.data.order.id}`, otherCust);
  check('M', 'Signed in: checkout without a payment method only holds; paying with the session works; another buyer can’t see the order',
    held.status === 201 && held.data.order.status === 'PENDING' && held.data.order.payments.length === 0 && paidM.status === 200 && paidM.data.order.status === 'PAID' && peek.status === 404,
    `hold ${held.status} ${held.data.order?.status}; pay ${paidM.status} ${paidM.data?.order?.status}; other buyer ${peek.status}`);

  // N — email-code sign-in
  const codeReq = await api('POST', '/auth/email-code', null, { email: gEmail });
  const tooSoon = await api('POST', '/auth/email-code', null, { email: gEmail });
  await sleep(600);
  const mail = lastMailTo(gEmail, 'login_code');
  const code = mail?.match(/Your Bantaba code: (\d{6})/)?.[1];
  const wrongCode = await api('POST', '/auth/email-code/verify', null, { email: gEmail, code: code === '000000' ? '111111' : '000000' });
  const right = await api('POST', '/auth/email-code/verify', null, { email: gEmail, code });
  const reuse = await api('POST', '/auth/email-code/verify', null, { email: gEmail, code });
  const mine = await api('GET', '/tickets/mine', right.data?.accessToken);
  const codeRow = await prisma.emailLoginCode.findFirst({ where: { email: gEmail }, orderBy: { createdAt: 'desc' } });
  check('N', 'Email code: sent; again within a minute → 429; wrong code refused; right code signs the guest in (their ticket from checkout listed with venue); used code refused; only the hash is stored',
    codeReq.status === 200 && tooSoon.status === 429 && !!code && wrongCode.status === 400 && right.status === 200 && right.data.user.role === 'CUSTOMER' && right.data.created === false &&
      reuse.status === 400 && mine.data.length === 1 && mine.data[0].ticketType.event.venue?.name === venue.name && codeRow.codeHash !== code && !!codeRow.usedAt,
    `request ${codeReq.status}, again ${tooSoon.status}; code ${code ? 'found' : 'missing'}; wrong ${wrongCode.status}; right ${right.status}; reuse ${reuse.status}; tickets ${mine.data?.length}`);

  // O — a new email signs up with a code; Host accounts get no code; five wrong tries end it
  const newEmail = uniq('new');
  await api('POST', '/auth/email-code', null, { email: newEmail });
  await sleep(600);
  const newCode = lastMailTo(newEmail, 'login_code')?.match(/Your Bantaba code: (\d{6})/)?.[1];
  const signup = await api('POST', '/auth/email-code/verify', null, { email: newEmail, code: newCode });
  const orgReq = await api('POST', '/auth/email-code', null, { email: 'organizer@example.com' });
  await sleep(600);
  const orgMail = lastMailTo('organizer@example.com', 'login_code');
  const tries = [];
  const triesEmail = uniq('tries');
  await api('POST', '/auth/email-code', null, { email: triesEmail });
  for (let i = 0; i < 6; i++) tries.push((await api('POST', '/auth/email-code/verify', null, { email: triesEmail, code: String(100000 + i) })).data?.message?.slice(0, 12));
  check('O', 'A new email signs up with a code (created: true); an organizer email gets "use your password" and no code; after 5 wrong tries even more are refused',
    signup.status === 200 && signup.data.created === true && orgReq.status === 200 && !!orgMail && !/Your Bantaba code/.test(orgMail) && /password/.test(orgMail) && tries[5].startsWith('Too many'),
    `signup ${signup.status} created ${signup.data?.created}; organizer mail ${orgMail ? 'password note' : 'missing'}; 6th try "${tries[5]}"`);

  // P — the host's public page has price labels
  const prof = (await api('GET', `/organizers/${reg.data.organizer.slug}`)).data;
  const p1c = prof.upcoming.find((e) => e.id === e1.id);
  check('P', 'Host page: each event has the storefront price label',
    p1c?.price?.label === 'From D300' && p1c.priceFrom === 30000, `${p1c?.price?.label}`);

  // Back to the default row (6 cards, one per host).
  await api('PATCH', '/admin/trending/settings', admin, { count: 6, onePerHost: true });

  const failed = results.filter((r) => !r.pass).length;
  console.log(`\n${results.length - failed}/${results.length} passed`);
  await prisma.$disconnect();
  process.exit(failed ? 1 : 0);
})().catch(async (e) => { console.error('RUN ERROR', e); await prisma.$disconnect(); process.exit(1); });
