// Security review (Phase 21b, docs/security.md): one check per fix.
// node security-test.js   (backend running with RATE_LIMITS=off and ALLOW_MOCK_PAYMENTS=true,
// seed data loaded, built with `npm run build`). It also starts a second
// backend on port 4001 the way production runs (limits on, no test payments).
const { PrismaClient } = require('@prisma/client');
const { spawn } = require('child_process');
const crypto = require('crypto');
const fs = require('fs');
const path = require('path');
const prisma = new PrismaClient();
const BASE = 'http://localhost:4000/api/v1';
const PROD = 'http://localhost:4001/api/v1';
const results = [];
async function api(method, p, token, body, base = BASE, headers = {}) {
  const res = await fetch(base + p, { method, headers: { 'Content-Type': 'application/json', ...(token ? { Authorization: `Bearer ${token}` } : {}), ...headers }, body: body ? JSON.stringify(body) : undefined });
  let data = null; try { data = await res.json(); } catch {}
  return { status: res.status, data, headers: res.headers };
}
const login = async (email, password = 'SeedPassword123!') => (await api('POST', '/auth/login', null, { email, password })).data;
const check = (id, name, pass, detail) => { results.push({ id, pass }); console.log(`${pass ? 'PASS' : 'FAIL'}  ${id.padEnd(3)} ${name} — ${detail}`); };
const tag = Math.random().toString(36).slice(2, 7);
const uniq = (t) => `sec-${t}-${Date.now()}-${tag}@example.com`;
const PW = 'a-long-enough-password';
const iso = (h) => new Date(Date.now() + h * 3600e3).toISOString();
const h = (t) => crypto.createHash('sha256').update(t).digest('hex');
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function startProdLike() {
  const env = { ...process.env, PORT: '4001', RATE_LIMITS: '', ALLOW_MOCK_PAYMENTS: '', TRUST_PROXY: '', MODEMPAY_SECRET_KEY: 'sk_test_fake', MODEMPAY_WEBHOOK_SECRET: 'whsec_fake' };
  delete env.RATE_LIMITS; delete env.ALLOW_MOCK_PAYMENTS; delete env.TRUST_PROXY;
  const child = spawn('node', ['dist/main.js'], { cwd: __dirname, env, stdio: 'ignore' });
  for (let i = 0; i < 60; i++) {
    await sleep(500);
    try { if ((await fetch(PROD + '/health')).ok) return child; } catch {}
  }
  child.kill();
  throw new Error('second backend did not start');
}

(async () => {
  const prod = await startProdLike();
  try {
    const admin = (await login('admin@example.com')).accessToken;
    const reg = await api('POST', '/auth/register-organizer', null, { email: uniq('host'), password: PW, businessName: `Sec Host ${tag}` });
    await prisma.organizer.update({ where: { id: reg.data.organizer.id }, data: { verificationStatus: 'APPROVED', trustLevel: 'TRUSTED' } });
    const host = reg.data.accessToken;
    const venue = (await api('GET', '/venues')).data.find((v) => !v.ownerId);
    const cat = (await api('GET', '/categories')).data[0].id;
    const mkEvent = async (name, extra = {}) => {
      const ev = (await api('POST', '/events', host, { name: `${name} ${tag}`, categoryId: cat, venueId: venue.id, startDate: iso(1), endDate: iso(5), refundPolicy: 'ANYTIME', ...extra })).data;
      const tt = (await api('POST', '/ticket-types', host, { eventId: ev.id, name: 'Regular', price: 20000, quantityTotal: 200 })).data;
      return { ev, tt };
    };
    const { ev, tt } = await mkEvent('Sec Night');
    await api('POST', `/events/${ev.id}/publish`, host);
    const buy = async (tok, n = 1, extra = {}) => (await api('POST', '/orders/checkout', tok, { eventId: ev.id, provider: 'MOCK', items: [{ ticketTypeId: tt.id, quantity: n }], ...extra })).data;

    // A — a transferred ticket's new QR isn't on the sender's order any more
    const a1 = (await api('POST', '/auth/register', null, { email: uniq('sender'), password: PW, fullName: 'Awa Sender' })).data;
    const bEmail = uniq('friend');
    const b1 = (await api('POST', '/auth/register', null, { email: bEmail, password: PW, fullName: 'Bai Friend' })).data;
    const o = await buy(a1.accessToken, 1);
    const orderId = (o.order ?? o).id;
    const ticket = await prisma.ticket.findFirst({ where: { orderId } });
    const offer = await api('POST', `/tickets/${ticket.id}/transfer`, a1.accessToken, { email: bEmail });
    const token = (await prisma.ticketTransfer.findFirst({ where: { ticketId: ticket.id }, orderBy: { createdAt: 'desc' } }));
    // Accept as the friend: the transfer token is only in the email, so take the row and swap in a known token.
    const raw = crypto.randomBytes(32).toString('hex');
    await prisma.ticketTransfer.update({ where: { id: token.id }, data: { tokenHash: h(raw) } });
    const acc = await api('POST', '/transfers/accept', b1.accessToken, { token: raw });
    const after = await api('GET', `/orders/${orderId}`, a1.accessToken);
    const shown = after.data?.tickets?.[0] ?? {};
    check('A', 'After a transfer the sender’s order shows no QR and no QR hash for that ticket',
      offer.status === 201 && acc.status < 300 && after.status === 200 && !shown.qrCodeSvg && !('qrCredentialHash' in shown) && shown.transferred === true,
      `offer ${offer.status}, accept ${acc.status}; qr ${shown.qrCodeSvg ? 'SHOWN' : 'hidden'}, hash ${'qrCredentialHash' in shown ? 'SHOWN' : 'hidden'}`);

    // B — the organizer's check-in log has no QR images or hashes
    await api('POST', '/check-ins', host, { qrToken: 'x'.repeat(64), eventId: ev.id });
    const t2 = await buy(a1.accessToken, 1);
    const t2ticket = await prisma.ticket.findFirst({ where: { orderId: (t2.order ?? t2).id } });
    await prisma.checkIn.create({ data: { eventId: ev.id, ticketId: t2ticket.id, result: 'WRONG_DATE' } });
    const log = await api('GET', `/events/${ev.id}/check-ins`, host);
    const row = log.data?.[0]?.ticket ?? {};
    check('B', 'Check-in log: ticket type and holder, no qrCodeSvg / qrCredentialHash',
      log.status === 200 && !!row.ticketType?.name && !!row.owner && !('qrCodeSvg' in row) && !('qrCredentialHash' in row), `keys ${Object.keys(row).join(',')}`);

    // C — someone registers a buyer's email first; the buyer's guest purchase clears that account
    const victim = uniq('victim');
    const squat = (await api('POST', '/auth/register', null, { email: victim, password: PW, fullName: 'Squatter' })).data;
    const gc = await api('POST', '/orders/guest-checkout', null, { eventId: ev.id, provider: 'MOCK', fullName: 'Real Owner', email: victim, items: [{ ticketTypeId: tt.id, quantity: 1 }] });
    const squatLogin = await api('POST', '/auth/login', null, { email: victim, password: PW });
    const squatOld = await api('GET', '/tickets/mine', squat.accessToken);
    const squatRefresh = await api('POST', '/auth/refresh', null, { refreshToken: squat.refreshToken });
    check('C', 'Guest buy on an unconfirmed password account: the password stops working, old sign-in refused at once, refresh refused',
      gc.status === 201 && squatLogin.status === 401 && squatOld.status === 401 && squatRefresh.status === 401,
      `guest ${gc.status}; login ${squatLogin.status}; old token ${squatOld.status}; refresh ${squatRefresh.status}`);

    // D — the real owner proving the email by code takes the account back (another squatter case)
    const victim2 = uniq('victim2');
    const squat2 = (await api('POST', '/auth/register', null, { email: victim2, password: PW })).data;
    await api('POST', '/auth/email-code', null, { email: victim2 });
    const codeRow = await prisma.emailLoginCode.findFirst({ where: { email: victim2 }, orderBy: { createdAt: 'desc' } });
    const code = String(Array.from({ length: 1e6 }, (_, i) => i).find((n) => h(`${victim2}:${String(n).padStart(6, '0')}`) === codeRow.codeHash)).padStart(6, '0');
    const owner = await api('POST', '/auth/email-code/verify', null, { email: victim2, code });
    const sq2 = await api('GET', '/auth/me', squat2.accessToken);
    const sq2Login = await api('POST', '/auth/login', null, { email: victim2, password: PW });
    check('D', 'Email code by the owner: signed in; the squatter’s session and password stop working',
      owner.status === 200 && sq2.status === 401 && sq2Login.status === 401, `owner ${owner.status}; squatter token ${sq2.status}; squatter login ${sq2Login.status}`);

    // E — emails are one account whatever the capitals
    const mixed = `Sec.Mixed.${tag}@Example.com`;
    const r1 = await api('POST', '/auth/register', null, { email: mixed, password: PW });
    const r2 = await api('POST', '/auth/register', null, { email: mixed.toLowerCase(), password: PW });
    const l2 = await api('POST', '/auth/login', null, { email: mixed.toUpperCase(), password: PW });
    check('E', 'Email case: stored lower case, a second sign-up in other capitals is refused, sign-in works in any case',
      r1.status === 201 && r1.data.user.email === mixed.toLowerCase() && r2.status === 409 && l2.status === 200, `${r1.status} ${r1.data?.user?.email}; again ${r2.status}; login ${l2.status}`);

    // F — changing the password signs out other devices; this one stays
    const pwUser = (await api('POST', '/auth/register', null, { email: uniq('pw'), password: PW })).data;
    const other = await api('POST', '/auth/login', null, { email: pwUser.user.email, password: PW });
    await sleep(1100);
    const ch = await api('PUT', '/me/password', pwUser.accessToken, { password: 'another-long-password', currentPassword: PW, keepRefreshToken: pwUser.refreshToken });
    const otherAccess = await api('GET', '/auth/me', other.data.accessToken);
    const otherRefresh = await api('POST', '/auth/refresh', null, { refreshToken: other.data.refreshToken });
    const mine = await api('POST', '/auth/refresh', null, { refreshToken: pwUser.refreshToken });
    check('F', 'Password change: other device’s sign-in and refresh refused; this device refreshes',
      ch.status === 200 && otherAccess.status === 401 && otherRefresh.status === 401 && mine.status === 200, `change ${ch.status}; other ${otherAccess.status}/${otherRefresh.status}; this ${mine.status} ${mine.data?.message ?? ''}`);

    // G — two refreshes with the same token at once: only one works
    const rUser = await api('POST', '/auth/login', null, { email: pwUser.user.email, password: 'another-long-password' });
    const [g1, g2] = await Promise.all([api('POST', '/auth/refresh', null, { refreshToken: rUser.data.refreshToken }), api('POST', '/auth/refresh', null, { refreshToken: rUser.data.refreshToken })]);
    check('G', 'Same refresh token twice at once: one works, one 401', [g1.status, g2.status].sort().join(',') === '200,401', `${g1.status}, ${g2.status}`);

    // H — production-like server: login limited per email and address; spoofed X-Forwarded-For doesn't help; no test payments; security headers
    const target = uniq('target');
    const hs = [];
    for (let i = 0; i < 12; i++) hs.push((await api('POST', '/auth/login', null, { email: target, password: 'wrong-password-123' }, PROD, { 'X-Forwarded-For': `10.0.0.${i}` })).status);
    const mock = await api('POST', '/orders/guest-checkout', null, { eventId: ev.id, provider: 'MOCK', fullName: 'Free Rider', email: uniq('free'), items: [{ ticketTypeId: tt.id, quantity: 1 }] }, PROD);
    const health = await fetch(PROD + '/health');
    check('H', 'Prod-like: 11th wrong login 429 even with a new X-Forwarded-For each time; test payments refused; helmet headers',
      hs.slice(0, 10).every((s) => s === 401) && hs[10] === 429 && mock.status === 403 && health.headers.get('x-content-type-options') === 'nosniff' && /frame-ancestors 'none'/.test(health.headers.get('content-security-policy') ?? ''),
      `logins ${hs.join(',')}; MOCK ${mock.status}; nosniff ${health.headers.get('x-content-type-options')}`);

    // I — one account can't hold the event: at most 2 unpaid bank-transfer orders per event
    const hoarder = (await api('POST', '/auth/register', null, { email: uniq('hoard'), password: PW })).data;
    const bt = [];
    for (let i = 0; i < 3; i++) bt.push((await api('POST', '/orders/checkout', hoarder.accessToken, { eventId: ev.id, provider: 'BANK_TRANSFER', items: [{ ticketTypeId: tt.id, quantity: 10 }] })).status);
    // A guest using someone's email doesn't cancel that person's hold
    const holder = (await api('POST', '/auth/register', null, { email: uniq('holder'), password: PW })).data;
    const hold = (await api('POST', '/orders/checkout', holder.accessToken, { eventId: ev.id, items: [{ ticketTypeId: tt.id, quantity: 1 }] })).data;
    await api('POST', '/orders/guest-checkout', null, { eventId: ev.id, fullName: 'Spoiler', email: holder.user.email, items: [{ ticketTypeId: tt.id, quantity: 1 }] });
    const holdNow = await prisma.ticketOrder.findUnique({ where: { id: (hold.order ?? hold).id } });
    check('I', 'Third unpaid bank-transfer order refused (409); a guest using your email leaves your hold alone',
      bt[0] === 201 && bt[1] === 201 && bt[2] === 409 && holdNow.status === 'PENDING', `${bt.join(',')}; hold ${holdNow.status}`);

    // J — offline sync only records what a real phone could have
    const staffEmail = uniq('door');
    await api('POST', `/events/${ev.id}/staff`, host, { email: staffEmail, role: 'GATE_STAFF', fullName: 'Door Staff', password: PW });
    const door = (await login(staffEmail, PW)).accessToken;
    const { ev: other2, tt: tt2 } = await mkEvent('Other Night');
    await api('POST', `/events/${other2.id}/publish`, host);
    const mkTicket = async (typeId) => { const t = crypto.randomBytes(32).toString('hex'); await prisma.ticket.create({ data: { ticketTypeId: typeId, ownerId: a1.user.id, qrCredentialHash: h(t), status: 'ACTIVE' } }); return t; };
    const [k1, k2, k3, kOther] = [await mkTicket(tt.id), await mkTicket(tt.id), await mkTicket(tt.id), await mkTicket(tt2.id)];
    const ids = Array.from({ length: 5 }, () => crypto.randomUUID());
    const sync = await api('POST', `/scanner/events/${ev.id}/sync`, door, { deviceId: 'sec-phone-1', scans: [
      { id: ids[0], h: h(k1), at: new Date().toISOString(), result: 'VALID', letIn: false },
      { id: ids[1], h: h(k2), at: iso(-30), result: 'VALID', letIn: true },
      { id: ids[2], h: h(kOther), at: new Date().toISOString(), result: 'VALID', letIn: true },
      { id: ids[3], h: h(k3), at: new Date().toISOString(), result: 'VALID', letIn: true, override: true },
      { id: ids[4], h: h(k1), at: new Date().toISOString(), result: 'WRONG_GATE', letIn: false },
    ] });
    const rows = await prisma.checkIn.findMany({ where: { clientScanId: { in: ids } } });
    const by = (i) => rows.find((r) => r.clientScanId === ids[i]);
    const otherTicket = await prisma.ticket.findFirst({ where: { qrCredentialHash: h(kOther) } });
    check('J', 'Sync: "VALID but not let in" ignored; a let-in 30 h ago ignored; other event’s ticket untouched; gate staff override not recorded; refusals kept',
      sync.status === 201 && sync.data.accepted.length === 5 && !by(0) && !by(1) && !by(2) && by(3)?.result === 'VALID' && by(3).override === false && by(4)?.result === 'WRONG_GATE' && otherTicket.status === 'ACTIVE',
      `saved ${rows.length}: ${rows.map((r) => r.result).join(',')}; other ticket ${otherTicket.status}`);

    // K — what the public can't see: a draft's booking fee, a host's private venue, the admin's review note
    const { ev: draft } = await mkEvent('Draft Night');
    const pubFee = await api('GET', `/events/${draft.id}/booking-fee`);
    const ownFee = await api('GET', `/events/${draft.id}/booking-fee`, host);
    const priv = (await api('POST', '/organizer/venues', host, { name: `Private Yard ${tag}`, address: 'Brikama', city: 'Brikama' })).data;
    const pubVenue = await api('GET', `/venues/${priv.id}`);
    const ownVenue = await api('GET', `/venues/${priv.id}`, host);
    await prisma.event.update({ where: { id: ev.id }, data: { reviewNote: 'admin only: poster looked fake' } });
    const pubEvent = await api('GET', `/events/${ev.slug}`);
    const listed = (await api('GET', `/events?search=${encodeURIComponent('Sec Night ' + tag)}`)).data?.items?.[0] ?? {};
    check('K', 'Public: draft fee 404 (host 200); private venue 404 (host 200); no reviewNote on the event page or list',
      pubFee.status === 404 && ownFee.status === 200 && pubVenue.status === 404 && ownVenue.status === 200 && pubEvent.status === 200 && !('reviewNote' in pubEvent.data) && !('reviewNote' in listed),
      `fee ${pubFee.status}/${ownFee.status}; venue ${pubVenue.status}/${ownVenue.status}; note ${'reviewNote' in (pubEvent.data ?? {}) ? 'SHOWN' : 'hidden'}`);

    // L — a name typed at checkout can't put HTML in the email
    const evil = uniq('evil');
    const before = new Set(fs.existsSync('mail-previews') ? fs.readdirSync('mail-previews') : []);
    await api('POST', '/orders/guest-checkout', null, { eventId: ev.id, provider: 'MOCK', fullName: '<a\thref=//evil.example>Claim</a> you', email: evil, items: [{ ticketTypeId: tt.id, quantity: 1 }] });
    let html = '';
    for (let i = 0; i < 30 && !html; i++) {
      await sleep(1000);
      const fresh = fs.readdirSync('mail-previews').filter((f) => !before.has(f) && f.includes('order_confirmed'));
      for (const f of fresh) { const c = fs.readFileSync(path.join('mail-previews', f), 'utf8'); if (c.includes(evil) || c.includes('evil.example') || c.includes('&lt;a')) html = c; }
    }
    check('L', 'Order email: the typed name is escaped (no <a href=//evil…>)', !!html && !/<a\s+href=\/\/evil/i.test(html) && html.includes('&lt;a'), html ? 'escaped' : 'no email found');

    // M — a late "failed" webhook for an abandoned card attempt doesn't cancel an order paid another way
    const late = (await api('POST', '/auth/register', null, { email: uniq('late'), password: PW })).data;
    const lo = (await api('POST', '/orders/checkout', late.accessToken, { eventId: ev.id, provider: 'BANK_TRANSFER', items: [{ ticketTypeId: tt.id, quantity: 1 }] })).data;
    const loId = (lo.order ?? lo).id;
    const ref = `pi_sec_${tag}`;
    await prisma.payment.create({ data: { orderId: loId, provider: 'CARD', providerReference: ref, amount: 1, currency: 'GMD', status: 'CANCELLED', createdAt: new Date(Date.now() - 60_000) } });
    const rawBody = JSON.stringify({ event: 'payment_intent.cancelled', payload: { id: 'pi_x', metadata: { reference: ref } } });
    const sig = crypto.createHmac('sha512', 'whsec_fake').update(rawBody).digest('hex');
    const wh = await fetch(`${BASE}/payments/webhook/card`, { method: 'POST', headers: { 'Content-Type': 'application/json', 'x-modem-signature': sig }, body: rawBody });
    const loNow = await prisma.ticketOrder.findUnique({ where: { id: loId } });
    check('M', 'Old card attempt’s "cancelled" webhook: order still waiting for its bank transfer', wh.status < 300 && loNow.status === 'PENDING', `webhook ${wh.status}; order ${loNow.status}`);

    // N — a host confirming their own bank transfer is recorded, and stops automatic payout approval
    const btPay = await prisma.payment.findFirst({ where: { orderId: loId, provider: 'BANK_TRANSFER' } });
    const conf = await api('POST', `/payments/${btPay.id}/confirm-bank-transfer`, host);
    const confRow = await prisma.payment.findUnique({ where: { id: btPay.id } });
    const audit = await prisma.auditLog.findFirst({ where: { action: 'bank_transfer_confirmed', entityId: btPay.id } });
    check('N', 'Bank transfer confirmed by the host: who confirmed is saved and audited',
      conf.status < 300 && confRow.confirmedById === reg.data.user.id && audit?.metadata?.byHost === true, `${conf.status}; confirmedBy ${confRow.confirmedById === reg.data.user.id}; audit ${!!audit}`);

    // O — sign-in redirects stay on this site (web helper)
    const safe = fs.readFileSync(path.join(__dirname, '../web/lib/safeNext.ts'), 'utf8');
    const mod = {}; new Function('exports', require('typescript').transpile(safe, { module: 1 }))(mod);
    const s = mod.safeNext;
    check('O', 'safeNext: /\\evil.com, //evil.com, /%0aevil and https://… go to the fallback; /tickets?x=1 kept',
      s('/\\evil.com', '/f') === '/f' && s('//evil.com', '/f') === '/f' && s('/\nevil', '/f') === '/f' && s('https://evil.com', '/f') === '/f' && s('/tickets?x=1', '/f') === '/tickets?x=1', 'checked');
  } finally {
    prod.kill();
  }
  const passed = results.filter((r) => r.pass).length;
  console.log(`\n${passed}/${results.length} passed`);
  await prisma.$disconnect();
  process.exit(passed === results.length ? 0 : 1);
})();
