// Ways to pay (Phase 23, docs/payments.md): methods on/off, Wave, Afrimoney
// and QMoney through Modem Pay, Wave direct, refunds by gateway.
//
// Backend running against fake Modem Pay (like card-autopayout-test.js):
//   MODEMPAY_SECRET_KEY=sk_test_fake MODEMPAY_WEBHOOK_SECRET=whsec_fake \
//   MODEMPAY_API_BASE_URL=http://localhost:4599 ALLOW_MOCK_PAYMENTS=true RATE_LIMITS=off
// This script also starts a second backend on port 4002 with Wave Business
// keys and a fake Wave on port 4598, for the Wave direct checks.
const http = require('http');
const crypto = require('crypto');
const { spawn } = require('child_process');
const { PrismaClient } = require('@prisma/client');
const prisma = new PrismaClient();
const BASE = 'http://localhost:4000/api/v1';
const WBASE = 'http://localhost:4002/api/v1';
const results = [];
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
async function api(method, p, token, body, base = BASE) {
  const res = await fetch(base + p, { method, headers: { 'Content-Type': 'application/json', ...(token ? { Authorization: `Bearer ${token}` } : {}) }, body: body ? JSON.stringify(body) : undefined });
  let data = null; try { data = await res.json(); } catch {}
  return { status: res.status, data };
}
const login = async (email, password = 'SeedPassword123!') => (await api('POST', '/auth/login', null, { email, password })).data?.accessToken;
const check = (id, name, pass, detail) => { results.push({ id, pass }); console.log(`${pass ? 'PASS' : 'FAIL'}  ${id.padEnd(3)} ${name} — ${detail}`); };
const uniq = (t) => `pm-${t}-${Date.now()}-${Math.random().toString(36).slice(2, 6)}@example.com`;
const PW = 'a-long-enough-password';
const iso = (h) => new Date(Date.now() + h * 3600e3).toISOString();

// fake Modem Pay
const mp = [];
const fakeMp = http.createServer((req, res) => {
  let b = ''; req.on('data', (c) => (b += c));
  req.on('end', () => { mp.push(JSON.parse(b || '{}')); res.writeHead(200, { 'Content-Type': 'application/json' }); res.end(JSON.stringify({ status: true, data: { payment_link: `https://checkout.modempay.test/pay/${mp.length}`, status: 'requires_payment_method' } })); });
});
// fake Wave
const wave = [];
const fakeWave = http.createServer((req, res) => {
  let b = ''; req.on('data', (c) => (b += c));
  req.on('end', () => { const body = JSON.parse(b || '{}'); wave.push({ path: req.url, auth: req.headers.authorization, body }); res.writeHead(200, { 'Content-Type': 'application/json' }); res.end(JSON.stringify({ id: `cos-${wave.length}-${Date.now()}`, wave_launch_url: `https://pay.wave.test/c/${wave.length}`, checkout_status: 'open', payment_status: 'processing' })); });
});
async function mpWebhook(event, payload) {
  const raw = JSON.stringify({ event, payload });
  const sig = crypto.createHmac('sha512', 'whsec_fake').update(raw).digest('hex');
  const r = await fetch(`${BASE}/payments/webhook/modempay`, { method: 'POST', headers: { 'Content-Type': 'application/json', 'x-modem-signature': sig }, body: raw });
  return { status: r.status, data: await r.json().catch(() => null) };
}
const WAVE_SECRET = 'wave_whsec_test_123';
async function waveWebhook(data, { secret = WAVE_SECRET, t = Math.floor(Date.now() / 1000), type = 'checkout.session.completed', base = WBASE } = {}) {
  const raw = JSON.stringify({ id: 'evt_' + Date.now(), type, data });
  const sig = crypto.createHmac('sha256', secret).update(String(t)).update(raw).digest('hex');
  const r = await fetch(`${base}/payments/webhook/wave`, { method: 'POST', headers: { 'Content-Type': 'application/json', 'Wave-Signature': `t=${t},v1=${sig}` }, body: raw });
  return { status: r.status, data: await r.json().catch(() => null) };
}

(async () => {
  await new Promise((r) => fakeMp.listen(4599, r));
  await new Promise((r) => fakeWave.listen(4598, r));
  const admin = await login('admin@example.com');
  const saved = await prisma.platformSetting.findUnique({ where: { key: 'payments' } });
  await prisma.platformSetting.deleteMany({ where: { key: 'payments' } });
  let second = null;
  try {
    const venue = (await api('GET', '/venues')).data.find((v) => v.name === 'Independence Stadium');
    const cat = (await api('GET', '/categories')).data[0].id;
    const orgEmail = uniq('org');
    const org = (await api('POST', '/auth/register-organizer', null, { email: orgEmail, password: PW, businessName: `Pay Ways ${Date.now()}` })).data.accessToken;
    const orgRow = await prisma.organizer.findFirst({ where: { user: { email: orgEmail } } });
    await api('PATCH', `/admin/organizers/${orgRow.id}`, admin, { verificationStatus: 'APPROVED', trustLevel: 'TRUSTED' });
    const ev = (await api('POST', '/events', org, { name: 'Pay Ways Gig', categoryId: cat, venueId: venue.id, startDate: iso(240), endDate: iso(244) })).data;
    const tt = (await api('POST', '/ticket-types', org, { eventId: ev.id, name: 'GA', price: 65000, quantityTotal: 100 })).data;
    await api('POST', `/events/${ev.id}/publish`, org);
    // A new buyer each time: one buyer may only have 2 unpaid payments per event.
    const buy = async (provider, n = 1, base = BASE) => {
      const cust = (await api('POST', '/auth/register', null, { email: uniq('cust'), password: PW })).data.accessToken;
      return api('POST', '/orders/checkout', cust, { eventId: ev.id, provider, items: [{ ticketTypeId: tt.id, quantity: n }] }, base);
    };

    // A — the list buyers see
    const a = await api('GET', '/payments/methods');
    check('A', 'Checkout list: Wave, Afrimoney, QMoney, Card, Bank transfer (+ test payment here), in that order; Wave direct not connected',
      a.status === 200 && a.data.map((m) => m.id).join() === 'WAVE,AFRIMONEY,QMONEY,CARD,BANK_TRANSFER,MOCK',
      `${a.status} ${a.data?.map((m) => m.id).join()}`);

    // B — switching QMoney off
    const off = await api('PUT', '/payments/admin/methods', admin, { method: 'QMONEY', enabled: false });
    const listOff = (await api('GET', '/payments/methods')).data.map((m) => m.id);
    const qm = await buy('QMONEY');
    const notAdmin = await api('PUT', '/payments/admin/methods', org, { method: 'CARD', enabled: false });
    const bad = await api('PUT', '/payments/admin/methods', admin, { method: 'PAYPAL', enabled: true });
    const on = await api('PUT', '/payments/admin/methods', admin, { method: 'QMONEY', enabled: true });
    const audit = await prisma.auditLog.count({ where: { action: 'payment_method_switched', createdAt: { gte: new Date(Date.now() - 60e3) } } });
    check('B', 'QMoney off: gone from checkout, buying with it refused (503 "isn’t available"), back on; admins only; unknown method refused; audited',
      off.status === 200 && off.data.methods.find((m) => m.id === 'QMONEY').enabled === false && !listOff.includes('QMONEY') && qm.status === 503 && /QMoney isn’t available/.test(qm.data?.message) &&
        notAdmin.status === 403 && bad.status === 400 && on.status === 200 && audit >= 2,
      `off ${off.status}; list ${listOff.join()}; buy ${qm.status} "${qm.data?.message}"; organizer ${notAdmin.status}; bad ${bad.status}; audit ${audit}`);

    // C — Wave direct can't be chosen while it isn't connected
    const direct = await api('PUT', '/payments/admin/wave-route', admin, { route: 'DIRECT' });
    const view = await api('GET', '/payments/admin/methods', admin);
    check('C', 'Wave direct refused while not connected; admin view: Modem Pay connected in test mode, Wave direct not connected, Wave through Modem Pay',
      direct.status === 400 && view.data.modemPay.connected && view.data.modemPay.testMode && !view.data.waveDirect.connected && view.data.waveRoute === 'MODEMPAY' && view.data.methods.find((m) => m.id === 'WAVE').gateway === 'MODEMPAY',
      `${direct.status}; ${JSON.stringify({ mp: view.data.modemPay, wd: view.data.waveDirect, route: view.data.waveRoute })}`);

    // D — Afrimoney through Modem Pay, paid by webhook
    const d = await buy('AFRIMONEY');
    const dPay = await prisma.payment.findFirst({ where: { orderId: d.data.order.id } });
    const dSent = mp[mp.length - 1];
    const dHook = await mpWebhook('charge.succeeded', { id: 'ch_d', amount: dPay.amount / 100, currency: 'GMD', metadata: { reference: dPay.providerReference } });
    const dOrder = await prisma.ticketOrder.findUnique({ where: { id: d.data.order.id }, include: { tickets: true } });
    check('D', 'Afrimoney: Modem Pay page (wallet methods, method in metadata), gateway MODEMPAY, paid by the Modem Pay webhook, ticket made',
      d.status === 201 && /checkout\.modempay\.test/.test(JSON.stringify(d.data)) && JSON.stringify(dSent.data.payment_methods) === '["wallet"]' && dSent.data.metadata.method === 'AFRIMONEY' &&
        dPay.provider === 'AFRIMONEY' && dPay.gateway === 'MODEMPAY' && dHook.status === 200 && dOrder.status === 'PAID' && dOrder.tickets.length === 1,
      `${d.status}; methods ${JSON.stringify(dSent.data.payment_methods)} ${dSent.data.metadata.method}; ${dPay.provider}/${dPay.gateway}; hook ${dHook.status} ${JSON.stringify(dHook.data)}; order ${dOrder.status}`);

    // E — Wave through Modem Pay; card still only cards; a Wave direct webhook can't touch it
    const e = await buy('WAVE');
    const ePay = await prisma.payment.findFirst({ where: { orderId: e.data.order.id } });
    const eSent = mp[mp.length - 1];
    const c = await buy('CARD');
    const cSent = mp[mp.length - 1];
    const stray = await waveWebhook({ id: ePay.providerReference, amount: '650', currency: 'GMD', payment_status: 'succeeded', checkout_status: 'complete' }, { base: BASE, secret: 'x' });
    check('E', 'Wave: through Modem Pay (gateway MODEMPAY, wallet, method WAVE); card sends cards only; Wave direct webhook refused here (not connected)',
      e.status === 201 && ePay.gateway === 'MODEMPAY' && ePay.provider === 'WAVE' && eSent.data.metadata.method === 'WAVE' && JSON.stringify(cSent.data.payment_methods) === '["card"]' && stray.status === 401,
      `${e.status} ${ePay.provider}/${ePay.gateway}; card ${JSON.stringify(cSent.data.payment_methods)}; wave hook ${stray.status}`);

    // F — refunds by gateway: Modem Pay has no refund API → paid back by hand
    await prisma.event.update({ where: { id: ev.id }, data: { refundPolicy: 'FULL' } }).catch(() => undefined);
    const rf = await api('POST', `/payments/${dPay.id}/refund`, admin, { note: 'test' });
    const refund = await prisma.refund.findFirst({ where: { paymentId: dPay.id } });
    check('F', 'Refund of an Afrimoney payment: paid back by hand (MANUAL), not sent to Wave or a card API',
      [200, 201].includes(rf.status) && refund?.method === 'MANUAL',
      `${rf.status} ${refund?.method ?? JSON.stringify(rf.data)}`);

    // G — Wave direct (second server with Wave Business keys)
    const env = { ...process.env, PORT: '4002', WAVE_API_KEY: 'wave_sn_prod_test', WAVE_WEBHOOK_SECRET: WAVE_SECRET, WAVE_API_BASE_URL: 'http://localhost:4598', NOTIFICATIONS_WORKER: 'off', MODEMPAY_SECRET_KEY: 'sk_test_fake', MODEMPAY_WEBHOOK_SECRET: 'whsec_fake', MODEMPAY_API_BASE_URL: 'http://localhost:4599', RATE_LIMITS: 'off', ALLOW_MOCK_PAYMENTS: 'true' };
    second = spawn('node', ['dist/main.js'], { cwd: __dirname, env, stdio: 'ignore' });
    for (let i = 0; i < 60; i++) { await sleep(500); try { if ((await fetch(WBASE + '/health')).ok) break; } catch {} }
    const route = await api('PUT', '/payments/admin/wave-route', admin, { route: 'DIRECT' }, WBASE);
    const g = await buy('WAVE', 1, WBASE);
    const gPay = await prisma.payment.findFirst({ where: { orderId: g.data?.order?.id } });
    const gSent = wave[wave.length - 1];
    const whole = String(gPay.amount / 100);
    const badSig = await waveWebhook({ id: gPay?.providerReference, amount: whole, currency: 'GMD', payment_status: 'succeeded', checkout_status: 'complete' }, { secret: 'wrong' });
    const oldSig = await waveWebhook({ id: gPay?.providerReference, amount: whole, currency: 'GMD', payment_status: 'succeeded', checkout_status: 'complete' }, { t: Math.floor(Date.now() / 1000) - 3600 });
    const wrongAmt = await waveWebhook({ id: gPay?.providerReference, amount: '6.50', currency: 'GMD', payment_status: 'succeeded', checkout_status: 'complete' });
    const still = (await prisma.ticketOrder.findUnique({ where: { id: g.data.order.id } })).status;
    const good = await waveWebhook({ id: gPay?.providerReference, amount: whole, currency: 'GMD', payment_status: 'succeeded', checkout_status: 'complete' });
    const gOrder = await prisma.ticketOrder.findUnique({ where: { id: g.data.order.id }, include: { tickets: true } });
    check('G', 'Wave direct: route set (connected); session in whole dalasis (D700 → "700"); Wave-Signature t/v1 checked (wrong secret, old time refused); wrong amount not paid; right one paid',
      route.status === 200 && route.data.waveRoute === 'DIRECT' && g.status === 201 && gPay.gateway === 'WAVE' && /pay\.wave\.test/.test(JSON.stringify(g.data)) && gSent.body.amount === whole && !whole.includes('.') && gSent.body.currency === 'GMD' &&
        badSig.status === 401 && oldSig.status === 401 && wrongAmt.data?.reason === 'amount_mismatch' && still === 'PENDING' && good.status === 200 && gOrder.status === 'PAID' && gOrder.tickets.length === 1,
      `route ${route.status}; buy ${g.status} ${gPay?.gateway}; sent ${JSON.stringify(gSent?.body)}; bad ${badSig.status}, old ${oldSig.status}, amount ${wrongAmt.data?.reason}; ${still} → ${gOrder.status}`);

    // H — the main server (no Wave keys) falls back to Modem Pay even though the route says direct
    const h = await buy('WAVE');
    const hPay = await prisma.payment.findFirst({ where: { orderId: h.data.order.id } });
    const back = await api('PUT', '/payments/admin/wave-route', admin, { route: 'MODEMPAY' }, WBASE);
    check('H', 'A server without Wave keys sends Wave through Modem Pay even when the route says direct; route set back',
      h.status === 201 && hPay.gateway === 'MODEMPAY' && back.status === 200 && back.data.waveRoute === 'MODEMPAY',
      `${h.status} ${hPay.gateway}; back ${back.status}`);
  } finally {
    if (second) second.kill();
    await prisma.platformSetting.deleteMany({ where: { key: 'payments' } });
    if (saved) await prisma.platformSetting.create({ data: { key: saved.key, value: saved.value, updatedById: saved.updatedById } });
    fakeMp.close(); fakeWave.close();
  }
  const passed = results.filter((r) => r.pass).length;
  console.log(`\n${passed}/${results.length} passed`);
  await prisma.$disconnect();
  process.exit(passed === results.length ? 0 : 1);
})();
