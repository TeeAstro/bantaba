// Phase 15 dashboards: admin stats, organizer overview and event page figures (docs/admin-dashboard.md, docs/organizer-dashboard.md).
// node dashboard-stats-test.js   (backend running, seed data loaded)
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
const uniq = (t) => `stats-${t}-${Date.now()}-${tag}@example.com`;
const PW = 'a-long-enough-password';
const iso = (h) => new Date(Date.now() + h * 3600e3).toISOString();

(async () => {
  const [admin, organizer] = await Promise.all([login('admin@example.com'), login('organizer@example.com')]);
  const venue = (await api('GET', '/venues')).data[0];
  const cat = (await api('GET', '/categories')).data[0].id;
  const stats = async (period) => (await api('GET', `/admin/stats${period ? `?period=${period}` : ''}`, admin)).data;
  const overview = async () => (await api('GET', '/organizer/overview', organizer)).data;

  // A — admin only, period checked
  const cust0 = (await api('POST', '/auth/register', null, { email: uniq('c0'), password: PW })).data.accessToken;
  const a = await Promise.all([api('GET', '/admin/stats', organizer), api('GET', '/admin/stats', cust0), api('GET', '/admin/stats'), api('GET', '/admin/stats?period=week', admin), api('GET', '/admin/stats', admin)]);
  check('A', 'GET /admin/stats: 403 organizer and customer, 401 signed out, 400 unknown period, 200 admin (30 days by default)',
    a[0].status === 403 && a[1].status === 403 && a[2].status === 401 && a[3].status === 400 && a[4].status === 200 && a[4].data.period.name === '30d',
    a.map((r) => r.status).join(','));

  // B — chart slots per period
  const lens = {};
  for (const p of ['today', '7d', '30d', 'year']) { const s = await stats(p); lens[p] = [s.series.length, s.period.bucket]; }
  check('B', 'Sales chart slots: today 24 hours, 7 days, 30 days, year 12 months',
    lens.today[0] === 24 && lens.today[1] === 'hour' && lens['7d'][0] === 7 && lens['30d'][0] === 30 && lens.year[0] === 12 && lens.year[1] === 'month',
    JSON.stringify(lens));

  // Sales: a new event with two buyers, 2 tickets each at D200
  const before = await stats('today');
  const ovBefore = await overview();
  const ev = (await api('POST', '/events', organizer, { name: `Stats Night ${tag}`, categoryId: cat, venueId: venue.id, startDate: iso(48), endDate: iso(52) })).data;
  const tt = (await api('POST', '/ticket-types', organizer, { eventId: ev.id, name: 'Regular', price: 20000, quantityTotal: 100 })).data;
  await api('POST', `/events/${ev.id}/publish`, organizer);
  const buyers = [];
  for (const t of ['b1', 'b2']) {
    const r = await api('POST', '/auth/register', null, { email: uniq(t), password: PW, fullName: `Buyer ${t}` });
    buyers.push(r.data.accessToken);
  }
  const orders = [];
  for (const b of buyers) orders.push((await api('POST', '/orders/checkout', b, { eventId: ev.id, provider: 'MOCK', items: [{ ticketTypeId: tt.id, quantity: 2 }] })).data);
  const paid = await prisma.ticketOrder.findMany({ where: { eventId: ev.id, status: 'PAID' } });
  const paidTotal = paid.reduce((n, o) => n + o.total, 0);
  const paidFees = paid.reduce((n, o) => n + o.platformFee, 0);
  const after = await stats('today');

  // C — money and activity move by exactly what was bought
  const dv = (k) => after.money[k].value - before.money[k].value;
  const da = (k) => after.activity[k].value - before.activity[k].value;
  check('C', 'Today: ticket sales + order totals, fees + platform fees, 2 orders, 4 tickets, 2 new customers',
    paid.length === 2 && dv('ticketSales') === paidTotal && dv('platformFees') === paidFees && da('orders') === 2 && da('ticketsSold') === 4 && da('newCustomers') === 2,
    `paid ${paid.length}; sales +${dv('ticketSales')}/${paidTotal}; fees +${dv('platformFees')}/${paidFees}; orders +${da('orders')}; tickets +${da('ticketsSold')}; customers +${da('newCustomers')}`);

  // D — the chart adds up to the money figure; average order
  const chartSum = after.series.reduce((n, s) => n + s.value, 0);
  check('D', 'Chart slots add up to ticket sales; organizers’ share + fees = sales; average order = sales / orders',
    chartSum === after.money.ticketSales.value && after.money.ticketSales.organizers + after.money.ticketSales.fees === after.money.ticketSales.value && after.activity.averageOrder.value === Math.round(after.money.ticketSales.value / after.activity.orders.value),
    `chart ${chartSum} vs ${after.money.ticketSales.value}; average ${after.activity.averageOrder.value}`);

  // E — owed to organizers grows by the organizer's share (ticket prices)
  check('E', 'Owed to organizers grows by 4 × D200; payable now is not more than owed',
    after.money.owedToOrganizers.value - before.money.owedToOrganizers.value === 80000 && after.money.owedToOrganizers.payableNow <= after.money.owedToOrganizers.value,
    `owed +${after.money.owedToOrganizers.value - before.money.owedToOrganizers.value}, payable now ${after.money.owedToOrganizers.payableNow}`);

  // F — events and organizers sections
  const thirty = await stats('30d');
  const evRow = thirty.events.items.find((e) => e.id === ev.id);
  const seedTop = thirty.organizers.top.find((o) => o.businessName === ev.organizer?.businessName) ?? thirty.organizers.top[0];
  const lv = thirty.organizers.byLevel;
  const dbPending = await prisma.organizer.count({ where: { verificationStatus: 'PENDING' } });
  check('F', 'Events: the new event listed with 4 of 100 sold; on sale counts it; top organizers sorted by sales; waiting count matches the database',
    (!evRow || (evRow.ticketsSold === 4 && evRow.capacity === 100)) && thirty.events.onSale >= 1 && !!seedTop &&
      thirty.organizers.top.every((o, i, arr) => i === 0 || arr[i - 1].sales >= o.sales) && lv.waiting === dbPending && thirty.organizers.waiting.count === dbPending,
    `listed ${!!evRow} ${evRow ? `${evRow.ticketsSold}/${evRow.capacity}` : '(5 sooner events)'}; on sale ${thirty.events.onSale}; top ${thirty.organizers.top.map((o) => o.sales).join(' ≥ ')}; levels ${JSON.stringify(lv)}`);

  // G — organizer overview
  const ov = await overview();
  const up = ov.upcoming.find((e) => e.id === ev.id);
  const lastDay = ov.salesByDay[ov.salesByDay.length - 1];
  check('G', 'Overview: 30 days of sales ending today, this week +4 tickets and +D800, the event sold 4 today with 0 staff, payouts and to-do present, order lines',
    ov.salesByDay.length === 30 && lastDay.date === new Date().toISOString().slice(0, 10) &&
      ov.thisWeek.tickets - ovBefore.thisWeek.tickets === 4 && ov.thisWeek.revenue - ovBefore.thisWeek.revenue === 80000 &&
      (!up || (up.soldToday === 4 && up.staff === 0 && 'posterUrl' in up)) &&
      typeof ov.payouts.available === 'number' && typeof ov.todo.refundRequests.count === 'number' && 'payoutAccount' in ov.todo &&
      ov.recentOrders[0].items?.[0]?.quantity === 2 && !('soldToday' in ov),
    `days ${ov.salesByDay.length} last ${lastDay.date}; week +${ov.thisWeek.tickets - ovBefore.thisWeek.tickets} tickets +${ov.thisWeek.revenue - ovBefore.thisWeek.revenue}; today ${up ? `${up.soldToday} staff ${up.staff}` : '(not in the next 5 events)'}; available ${ov.payouts.available}`);

  // H — event page: today's figures and readiness
  const ed = (await api('GET', `/events/${ev.id}/dashboard`, organizer)).data;
  const addStaff = await api('POST', `/events/${ev.id}/staff`, organizer, { email: uniq('staff'), role: 'SCANNER_OPERATOR', fullName: 'Gate Person', password: PW });
  const ed2 = (await api('GET', `/events/${ev.id}/dashboard`, organizer)).data;
  check('H', 'Event page: today 4 tickets / D800; staff 0 then 1 after adding a scanner; payout details flag',
    ed.today.tickets === 4 && ed.today.revenue === 80000 && ed.readiness.staff === 0 && addStaff.status === 201 && ed2.readiness.staff === 1 && typeof ed.readiness.payoutDetailsVerified === 'boolean',
    `today ${ed.today.tickets}/${ed.today.revenue}; staff ${ed.readiness.staff} → ${ed2.readiness.staff} (add ${addStaff.status}); verified ${ed.readiness.payoutDetailsVerified}`);

  const failed = results.filter((r) => !r.pass).length;
  console.log(`\n${results.length - failed}/${results.length} passed`);
  await prisma.$disconnect();
  process.exit(failed ? 1 : 0);
})().catch(async (e) => { console.error('RUN ERROR', e); await prisma.$disconnect(); process.exit(1); });
