// Phase 18d buyer Profile: details, password (set and change), orders (docs/storefront.md, "Profile").
// node profile-test.js   (backend running with RATE_LIMITS=off, seed data loaded)
const { PrismaClient } = require('@prisma/client');
const fs = require('fs');
const path = require('path');
const prisma = new PrismaClient();
const BASE = 'http://localhost:4000/api/v1';
const results = [];
async function api(method, p, token, body) {
  const res = await fetch(BASE + p, { method, headers: { 'Content-Type': 'application/json', ...(token ? { Authorization: `Bearer ${token}` } : {}) }, body: body ? JSON.stringify(body) : undefined });
  let data = null; try { data = await res.json(); } catch {}
  return { status: res.status, data };
}
const login = async (email, password = 'SeedPassword123!') => (await api('POST', '/auth/login', null, { email, password }));
const check = (id, name, pass, detail) => { results.push({ id, pass }); console.log(`${pass ? 'PASS' : 'FAIL'}  ${id.padEnd(3)} ${name} — ${detail}`); };
const tag = Math.random().toString(36).slice(2, 7);
const uniq = (t) => `profile-${t}-${Date.now()}-${tag}@example.com`;
const PW = 'a-long-enough-password';
const iso = (h) => new Date(Date.now() + h * 3600e3).toISOString();
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
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
  // A — a buyer who registered with a password
  const email = uniq('buyer');
  const reg = await api('POST', '/auth/register', null, { email, password: PW, fullName: 'Awa Jallow' });
  const buyer = reg.data.accessToken;
  const me1 = await api('GET', '/me', buyer);
  check('A', 'Profile: name, email, no phone, password set', me1.status === 200 && me1.data.fullName === 'Awa Jallow' && me1.data.email === email && me1.data.phone === null && me1.data.hasPassword === true,
    `${me1.status} ${JSON.stringify(me1.data)}`);

  // B — name and phone saved; the phone is kept as digits
  const phone = `+220 7${String(Date.now()).slice(-6)}`;
  const up = await api('PATCH', '/me', buyer, { fullName: '  Awa Jallow-Ceesay ', phone });
  check('B', 'Name and phone saved (phone kept as digits)', up.status === 200 && up.data.fullName === 'Awa Jallow-Ceesay' && up.data.phone === phone.replace(/[^0-9+]/g, ''), `${up.status} ${up.data?.fullName} ${up.data?.phone}`);

  // C — a phone on another account is refused; a too-short name too; clearing the phone works
  const other = await api('POST', '/auth/register', null, { email: uniq('other'), password: PW, fullName: 'Other' });
  const taken = await api('PATCH', '/me', other.data.accessToken, { fullName: 'Other', phone });
  const short = await api('PATCH', '/me', buyer, { fullName: 'A' });
  const cleared = await api('PATCH', '/me', other.data.accessToken, { fullName: 'Other', phone: '' });
  check('C', 'Phone on another account → 409; one-letter name → 400; empty phone clears it', taken.status === 409 && /another account/.test(taken.data?.message) && short.status === 400 && cleared.status === 200 && cleared.data.phone === null,
    `taken ${taken.status}; short ${short.status}; cleared ${cleared.status} ${cleared.data?.phone}`);

  // D — changing a password needs the current one
  const noCur = await api('PUT', '/me/password', buyer, { password: 'another-long-password' });
  const wrong = await api('PUT', '/me/password', buyer, { password: 'another-long-password', currentPassword: 'nope-nope-nope' });
  const shortPw = await api('PUT', '/me/password', buyer, { password: 'short', currentPassword: PW });
  const ok = await api('PUT', '/me/password', buyer, { password: 'another-long-password', currentPassword: PW });
  const oldLogin = await login(email, PW);
  const newLogin = await login(email, 'another-long-password');
  check('D', 'Change password: missing or wrong current → 400; under 12 → 400; right → new password signs in, old one doesn’t',
    noCur.status === 400 && wrong.status === 400 && shortPw.status === 400 && ok.status === 200 && oldLogin.status === 401 && newLogin.status === 200,
    `none ${noCur.status}, wrong ${wrong.status}, short ${shortPw.status}, ok ${ok.status}; old ${oldLogin.status}, new ${newLogin.status}`);

  // E — a buyer made by an email code has no password and can set one without a current one
  const codeEmail = uniq('code');
  await api('POST', '/auth/email-code', null, { email: codeEmail });
  await sleep(600);
  const code = lastMailTo(codeEmail, 'login_code')?.match(/Your Bantaba code: (\d{6})/)?.[1];
  const signed = await api('POST', '/auth/email-code/verify', null, { email: codeEmail, code });
  const codeTok = signed.data?.accessToken;
  const me2 = await api('GET', '/me', codeTok);
  const setPw = await api('PUT', '/me/password', codeTok, { password: PW });
  const pwLogin = await login(codeEmail, PW);
  check('E', 'Email-code account: "Not set"; setting one needs no current password; then it signs in', me2.data?.hasPassword === false && setPw.status === 200 && setPw.data.hasPassword === true && pwLogin.status === 200,
    `before ${me2.data?.hasPassword}; set ${setPw.status}; login ${pwLogin.status}`);

  // F — Host accounts can't use it
  const org = (await login('organizer@example.com')).data.accessToken;
  const orgMe = await api('GET', '/me', org);
  const anon = await api('GET', '/me');
  check('F', 'Organizer → 403; signed out → 401', orgMe.status === 403 && anon.status === 401, `organizer ${orgMe.status}, anon ${anon.status}`);

  // G — orders: a held order shows as waiting with its ticket count; nobody else's
  const venue = (await api('GET', '/venues')).data[0];
  const cat = (await api('GET', '/categories')).data[0].id;
  const hostReg = await api('POST', '/auth/register-organizer', null, { email: uniq('host'), password: PW, businessName: `Profile Host ${tag}` });
  await prisma.organizer.update({ where: { id: hostReg.data.organizer.id }, data: { verificationStatus: 'APPROVED', trustLevel: 'TRUSTED' } });
  const host = hostReg.data.accessToken;
  const ev = (await api('POST', '/events', host, { name: `Profile Gig ${tag}`, categoryId: cat, venueId: venue.id, startDate: iso(48), endDate: iso(52) })).data;
  const tt = (await api('POST', '/ticket-types', host, { eventId: ev.id, name: 'General', price: 25000, quantityTotal: 50 })).data;
  await api('POST', `/events/${ev.id}/publish`, host);
  const tok = newLogin.data.accessToken;
  const order = await api('POST', '/orders/checkout', tok, { eventId: ev.id, items: [{ ticketTypeId: tt.id, quantity: 2 }] });
  const mine = await api('GET', '/me/orders', tok);
  // Another buyer (a fresh account: since the security review, setting a password
  // in E signs out codeTok's other sessions, this one included).
  const otherBuyer = (await api('POST', '/auth/register', null, { email: uniq('other'), password: PW })).data;
  const theirs = await api('GET', '/me/orders', otherBuyer.accessToken);
  const row = mine.data?.find((o) => o.id === (order.data?.order?.id ?? order.data?.id));
  check('G', 'Orders: the held order is listed (2 tickets, D500 plus fees, PENDING, event slug); another buyer sees none of it',
    order.status === 201 && !!row && row.tickets === 2 && row.total >= 50000 && row.status === 'PENDING' && row.event.slug === ev.slug && !theirs.data.some((o) => o.id === row.id) && !('guestTokenHash' in row),
    `checkout ${order.status}; row ${JSON.stringify(row)}; other ${theirs.data?.length}`);

  // H — a lapsed hold drops off the list
  await prisma.ticketOrder.update({ where: { id: row.id }, data: { expiresAt: new Date(Date.now() - 1000) } });
  const after = await api('GET', '/me/orders', tok);
  check('H', 'A hold that ran out is left out', !after.data.some((o) => o.id === row.id), `${after.data.length} orders`);

  const passed = results.filter((r) => r.pass).length;
  console.log(`\n${passed}/${results.length} passed`);
  await prisma.$disconnect();
  process.exit(passed === results.length ? 0 : 1);
})();
