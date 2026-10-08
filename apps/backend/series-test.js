// Phase 24: repeating events, free tickets and open entry (docs/series.md).
// node series-test.js   (backend running with RATE_LIMITS=off ALLOW_MOCK_PAYMENTS=true, seed data loaded)
const { spawn } = require('child_process');
const { PrismaClient } = require('@prisma/client');
const prisma = new PrismaClient();
const BASE = 'http://localhost:4000/api/v1';
const results = [];
async function api(method, p, token, body, base = BASE) {
  const res = await fetch(base + p, { method, headers: { 'Content-Type': 'application/json', ...(token ? { Authorization: `Bearer ${token}` } : {}) }, body: body ? JSON.stringify(body) : undefined });
  let data = null; try { data = await res.json(); } catch {}
  return { status: res.status, data };
}
const login = async (email, password = 'SeedPassword123!') => (await api('POST', '/auth/login', null, { email, password })).data?.accessToken;
const check = (id, name, pass, detail) => { results.push({ id, pass }); console.log(`${pass ? 'PASS' : 'FAIL'}  ${id.padEnd(3)} ${name} — ${detail}`); };
const tag = Math.random().toString(36).slice(2, 7);
const DAY = 86_400_000;
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

// The coming Saturday at 10:00 Banjul (UTC), at least 2 days away.
function nextSaturday(hour = 10) {
  const d = new Date(Date.now() + 2 * DAY);
  d.setUTCDate(d.getUTCDate() + ((6 - d.getUTCDay() + 7) % 7));
  d.setUTCHours(hour, 0, 0, 0);
  return d;
}
const day = (d) => new Date(d).toISOString().slice(0, 10);

(async () => {
  const [admin, org, customer] = await Promise.all([login('admin@example.com'), login('organizer@example.com'), login('customer@example.com')]);
  const cat = (await api('GET', '/categories')).data[0].id;
  const venue = (await api('GET', '/venues', org)).data.find((v) => !v.hasSeating) ?? (await api('GET', '/venues', org)).data[0];
  const sat = nextSaturday();
  const base = { categoryId: cat, venueId: venue.id, startDate: sat.toISOString(), endDate: new Date(sat.getTime() + 3 * 3600e3).toISOString() };
  const sessionsOf = (seriesId) => prisma.event.findMany({ where: { seriesId }, orderBy: { seriesIndex: 'asc' }, include: { ticketTypes: true } });

  // A — a weekly draft with 5 sessions; bad repeats refused
  const badCount = await api('POST', '/events', org, { ...base, name: `Chess ${tag}`, repeat: { frequency: 'WEEKLY', endMode: 'COUNT', count: 1 } });
  const badDate = await api('POST', '/events', org, { ...base, name: `Chess ${tag}`, repeat: { frequency: 'WEEKLY', endMode: 'DATE', endsOn: day(sat) } });
  const created = await api('POST', '/events', org, { ...base, name: `Chess ${tag}`, repeat: { frequency: 'WEEKLY', endMode: 'COUNT', count: 5 } });
  const ev = created.data;
  const draft = await api('GET', `/events/${ev.id}`, org);
  check('A', 'Repeating draft: weekly, 5 sessions; a count of 1 or an end on the first day refused; the draft shows "Every Saturday"',
    badCount.status === 400 && badDate.status === 400 && created.status === 201 && ev.seriesIndex === 0 && !!ev.seriesId && draft.data?.series?.label === 'Every Saturday' && draft.data?.series?.endMode === 'COUNT',
    `bad count ${badCount.status}, bad date ${badDate.status} "${badDate.data?.message}"; created ${created.status}; label ${draft.data?.series?.label}`);

  // B — publish: the 4 other sessions are copied, on sale at once
  const tt = await api('POST', '/ticket-types', org, { eventId: ev.id, name: 'Seat at a board', category: 'GENERAL_ADMISSION', price: 0, quantityTotal: 3 });
  const pub = await api('POST', `/events/${ev.id}/publish`, org);
  let sessions = await sessionsOf(ev.seriesId);
  const weekApart = sessions.every((s, i) => s.startDate.getTime() === sat.getTime() + i * 7 * DAY && s.endDate.getTime() - s.startDate.getTime() === 3 * 3600e3);
  check('B', 'Published: 5 sessions, a week apart, all on sale, each with its own free ticket type (3 places), slugs with the date',
    tt.status === 201 && pub.status === 201 && pub.data.status === 'PUBLISHED' && sessions.length === 5 && weekApart && sessions.every((s) => s.status === 'PUBLISHED' && s.ticketTypes.length === 1 && s.ticketTypes[0].price === 0 && s.ticketTypes[0].quantityTotal === 3) &&
      sessions[1].slug.endsWith(day(sessions[1].startDate)),
    `publish ${pub.status} ${pub.data?.status}; ${sessions.length} sessions; a week apart ${weekApart}; slug ${sessions[1]?.slug}`);

  // C — buyers: the dates on the page; the series shows once on Discover
  const page = await api('GET', `/events/${sessions[2].slug}`);
  const disc = await api('GET', `/storefront/discover?q=Chess%20${tag}`);
  const cards = [...(disc.data?.list ?? []), ...(disc.data?.hosts ?? []).flatMap((h) => h.events)].filter((c) => c.name === `Chess ${tag}`);
  const uniq = [...new Map(cards.map((c) => [c.id, c])).values()];
  check('C', 'Event page lists the 5 dates (free, 3 left each); Discover shows the series once, as its next session, "Every Saturday" badge EVERY / SAT',
    page.status === 200 && page.data.series?.sessions?.length === 5 && page.data.series.sessions.every((s) => s.kind === 'free' && s.left === 3) && page.data.series.label === 'Every Saturday' &&
      uniq.length === 1 && uniq[0].id === sessions[0].id && uniq[0].series?.label === 'Every Saturday' && uniq[0].series?.badge?.top === 'Every' && uniq[0].series?.badge?.day === 'SAT' && uniq[0].price.label === 'Free',
    `page ${page.status}: ${page.data?.series?.sessions?.length} dates; discover ${uniq.length} card(s) ${uniq[0]?.series?.label} ${uniq[0]?.series?.badge?.top}/${uniq[0]?.series?.badge?.day} ${uniq[0]?.price?.label}`);

  // D — free tickets: issued at once, no payment; 4 per person; give one back
  const s1type = sessions[1].ticketTypes[0].id;
  const buy = await api('POST', '/orders/checkout', customer, { eventId: sessions[1].id, items: [{ ticketTypeId: s1type, quantity: 2 }] });
  const payments = await prisma.payment.count({ where: { orderId: buy.data?.order?.id } });
  const s3type = sessions[3].ticketTypes[0].id;
  const b1 = await api('POST', '/orders/checkout', customer, { eventId: sessions[3].id, items: [{ ticketTypeId: s3type, quantity: 3 }] });
  const tooMany = await api('POST', '/orders/checkout', customer, { eventId: sessions[3].id, items: [{ ticketTypeId: s3type, quantity: 1 }] });
  const giveBack = await api('POST', `/tickets/${b1.data?.order?.tickets?.[0]?.id}/give-back`, customer);
  const again = await api('POST', `/tickets/${b1.data?.order?.tickets?.[0]?.id}/give-back`, customer);
  const typeAfter = await prisma.ticketType.findUnique({ where: { id: s3type } });
  const paidGiveBack = await prisma.ticket.findFirst({ where: { status: 'ACTIVE', ticketType: { price: { gt: 0 } }, owner: { email: 'customer@example.com' } } });
  const refusePaid = paidGiveBack ? await api('POST', `/tickets/${paidGiveBack.id}/give-back`, customer) : { status: 400 };
  check('D', 'Free checkout: paid at once with tickets and QR (no payment, no way-to-pay step); with all 3 places taken a 4th is refused; giving one back frees the place; twice or a paid ticket refused',
    buy.status === 201 && buy.data.order.status === 'PAID' && buy.data.order.tickets?.length === 2 && !!buy.data.order.tickets[0].qrToken && payments === 0 &&
      b1.status === 201 && tooMany.status === 409 && giveBack.status === 201 && giveBack.data.status === 'CANCELLED' && again.status === 400 && typeAfter.quantitySold === 2 && refusePaid.status === 400,
    `buy ${buy.status} ${buy.data?.order?.status} ${buy.data?.order?.tickets?.length} tickets, ${payments} payments; more ${tooMany.status} "${tooMany.data?.message}"; give back ${giveBack.status}, again ${again.status}; sold now ${typeAfter.quantitySold}; paid ${refusePaid.status}`);

  // D2 — 4 per person (a bigger free event)
  const big = (await api('POST', '/events', org, { ...base, name: `Open day ${tag}` })).data;
  const bigType = (await api('POST', '/ticket-types', org, { eventId: big.id, name: 'Entry', category: 'GENERAL_ADMISSION', price: 0, quantityTotal: 100 })).data;
  await api('POST', `/events/${big.id}/publish`, org);
  const four = await api('POST', '/orders/checkout', customer, { eventId: big.id, items: [{ ticketTypeId: bigType.id, quantity: 4 }] });
  const fifth = await api('POST', '/orders/checkout', customer, { eventId: big.id, items: [{ ticketTypeId: bigType.id, quantity: 1 }] });
  check('D2', 'Free tickets are 4 per person per event: 4 at once fine, a fifth refused with how many they have',
    four.status === 201 && four.data.order.status === 'PAID' && fifth.status === 409 && /4 per person/.test(fifth.data?.message ?? ''),
    `4: ${four.status}; 5th: ${fifth.status} "${fifth.data?.message}"`);

  // E — this and later sessions: a new time moves sessions 2, 3, 4 by an hour
  const moved = await api('PUT', `/events/${sessions[2].id}`, org, { startDate: new Date(sessions[2].startDate.getTime() + 3600e3).toISOString(), endDate: new Date(sessions[2].endDate.getTime() + 3600e3).toISOString(), applyTo: 'following' });
  const after = await sessionsOf(ev.seriesId);
  const shifted = after.map((s, i) => (s.startDate.getTime() - sessions[i].startDate.getTime()) / 3600e3);
  const one = await api('PUT', `/events/${after[4].id}`, org, { description: 'Bring a clock' });
  const desc = (await sessionsOf(ev.seriesId)).map((s) => s.description ?? '');
  check('E', '"This and later sessions": 11:00 from session 3 on (moved by an hour), earlier ones untouched; "only this one" changes just it',
    moved.status === 200 && moved.data.alsoUpdated === 2 && JSON.stringify(shifted) === '[0,0,1,1,1]' && one.status === 200 && desc.filter((d) => d === 'Bring a clock').length === 1,
    `${moved.status} alsoUpdated ${moved.data?.alsoUpdated}; hours moved ${JSON.stringify(shifted)}; only-this ${one.status}`);

  // F — cancel one session with free tickets out: tickets cancelled, others go on
  const cancel = await api('POST', `/events/${sessions[1].id}/cancel`, org, {});
  const cancelledTickets = await prisma.ticket.count({ where: { ticketType: { eventId: sessions[1].id }, status: 'CANCELLED' } });
  const mail = await prisma.notification.count({ where: { eventId: sessions[1].id, type: 'event_cancelled' } });
  const list = await api('GET', `/events/${sessions[0].id}/sessions`, org);
  const pageAfter = await api('GET', `/events/${sessions[0].slug}`);
  check('F', 'Cancelling one session (free tickets out): its 2 tickets cancelled, holder emailed; the list shows it cancelled; buyers see 4 dates',
    cancel.status === 201 && cancel.data.status === 'CANCELLED' && cancelledTickets === 2 && mail === 1 && list.status === 200 && list.data.sessions.length === 5 && list.data.sessions[1].status === 'CANCELLED' && list.data.sessions[0].sold === 0 && pageAfter.data.series.sessions.length === 4,
    `cancel ${cancel.status} ${cancel.data?.status || cancel.data?.message}; tickets ${cancelledTickets}; emails ${mail}; list ${list.status} ${list.data?.sessions?.map((s) => s.status[0]).join('')}; buyers see ${pageAfter.data?.series?.sessions?.length}`);

  // G — repeat can't change once live; a later session can't be published alone
  const change = await api('PUT', `/events/${sessions[0].id}`, org, { repeat: { frequency: 'MONTHLY', endMode: 'OPEN' } });
  const stray = await prisma.event.update({ where: { id: sessions[4].id }, data: { status: 'DRAFT' } });
  const pubLater = await api('POST', `/events/${stray.id}/publish`, org);
  await prisma.event.update({ where: { id: sessions[4].id }, data: { status: 'PUBLISHED' } });
  const other = await login('customer@example.com');
  const foreign = await api('GET', `/events/${sessions[0].id}/sessions`, other);
  check('G', 'Once live the repeat can’t be changed (400); a later session can’t be published on its own; the sessions list is the host’s only',
    change.status === 400 && pubLater.status === 400 && foreign.status === 403,
    `change ${change.status}; later ${pubLater.status}; customer ${foreign.status}`);

  // H — keep going, monthly: the next 8 on sale, same weekday of the month
  const first = new Date(sat);
  const monthly = (await api('POST', '/events', org, { ...base, name: `Clean-up ${tag}`, entryMode: 'OPEN', repeat: { frequency: 'MONTHLY', endMode: 'OPEN' } })).data;
  const noTickets = await api('POST', '/ticket-types', org, { eventId: monthly.id, name: 'x', category: 'GENERAL_ADMISSION', price: 0, quantityTotal: 5 });
  const mpub = await api('POST', `/events/${monthly.id}/publish`, org);
  const ms = await sessionsOf(monthly.seriesId);
  const nth = Math.ceil(first.getUTCDate() / 7);
  const sameRule = ms.every((s) => s.startDate.getUTCDay() === 6 && s.startDate.getUTCHours() === 10 && (nth >= 5 ? s.startDate.getUTCDate() + 7 > new Date(Date.UTC(s.startDate.getUTCFullYear(), s.startDate.getUTCMonth() + 1, 0)).getUTCDate() : Math.ceil(s.startDate.getUTCDate() / 7) === nth));
  const months = new Set(ms.map((s) => `${s.startDate.getUTCFullYear()}-${s.startDate.getUTCMonth()}`)).size;
  check('H', 'Open entry + monthly, keep going: no ticket types allowed; publishes with none; 8 sessions, one a month, each on the same Saturday of its month, all open entry',
    noTickets.status === 400 && mpub.status === 201 && ms.length === 8 && months === 8 && sameRule && ms.every((s) => s.entryMode === 'OPEN' && s.status === 'PUBLISHED'),
    `tickets ${noTickets.status}; publish ${mpub.status}; ${ms.length} sessions over ${months} months; rule ok ${sameRule}; dates ${ms.slice(0, 3).map((s) => day(s.startDate)).join(', ')}…`);

  // I — "I'm going"
  const anon = await api('GET', `/events/${ms[0].slug}`);
  const go = await api('POST', `/events/${ms[0].id}/going`, customer);
  const mine = await api('GET', `/events/${ms[0].slug}`, customer);
  const myList = await api('GET', '/me/going', customer);
  const checkout = await api('POST', '/orders/checkout', customer, { eventId: ms[0].id, items: [{ ticketTypeId: bigType.id, quantity: 1 }] });
  const unGo = await api('DELETE', `/events/${ms[0].id}/going`, customer);
  const noLogin = await api('POST', `/events/${ms[0].id}/going`);
  const onTickets = await api('POST', `/events/${sessions[0].id}/going`, customer);
  check('I', '"I’m going": count 0 → 1 (me true), in My going list, back to 0; signing in needed; refused on a ticketed event; checkout on open entry refused',
    anon.data?.going?.count === 0 && anon.data.going.me === false && go.status === 200 && go.data.count === 1 && mine.data.going.me === true && myList.data?.some((e) => e.id === ms[0].id) &&
      checkout.status === 400 && unGo.status === 200 && unGo.data.count === 0 && noLogin.status === 401 && onTickets.status === 400,
    `anon ${anon.data?.going?.count}; go ${go.status} ${go.data?.count}; me ${mine.data?.going?.me}; list ${myList.data?.length}; checkout ${checkout.status} "${checkout.data?.message}"; ungo ${unGo.data?.count}; anon ${noLogin.status}; ticketed ${onTickets.status}`);

  // J — Discover card for open entry; cancel emails the people going
  const dj = await api('GET', `/storefront/discover?q=Clean-up%20${tag}`);
  const cj = [...new Map([...(dj.data?.list ?? []), ...(dj.data?.hosts ?? []).flatMap((h) => h.events)].filter((c) => c.name === `Clean-up ${tag}`).map((c) => [c.id, c])).values()];
  await api('POST', `/events/${ms[1].id}/going`, customer);
  const mc = await api('POST', `/events/${ms[1].id}/cancel`, org, {});
  const goingMail = await prisma.notification.findFirst({ where: { eventId: ms[1].id, type: 'event_cancelled' } });
  check('J', 'Discover: open entry shows once, "Free entry", badge MONTHLY / SAT; cancelling a session queues "Cancelled" for the people going',
    cj.length === 1 && cj[0].price.label === 'Free entry' && cj[0].open === true && cj[0].series?.badge?.top === 'Monthly' && mc.status === 201 && goingMail?.payload?.going === true,
    `cards ${cj.length} ${cj[0]?.price?.label} ${cj[0]?.series?.badge?.top}; cancel ${mc.status}; email ${!!goingMail}`);

  // K — reviewed once: a new host's series waits; approved, all sessions go live
  const email = `series-host-${tag}@example.com`;
  await api('POST', '/auth/register-organizer', null, { email, password: 'a-long-enough-password', businessName: `New Host ${tag}` });
  const orgRow = await prisma.organizer.findFirst({ where: { user: { email } } });
  await prisma.organizer.update({ where: { id: orgRow.id }, data: { verificationStatus: 'APPROVED' } });
  const nh = await login(email, 'a-long-enough-password');
  const venues = (await api('GET', '/venues', nh)).data;
  const nev = (await api('POST', '/events', nh, { ...base, venueId: venues[0].id, name: `Quiz ${tag}`, repeat: { frequency: 'BIWEEKLY', endMode: 'COUNT', count: 3 } })).data;
  await api('POST', '/ticket-types', nh, { eventId: nev.id, name: 'Team', category: 'GENERAL_ADMISSION', price: 5000, quantityTotal: 10 });
  const npub = await api('POST', `/events/${nev.id}/publish`, nh);
  const waiting = await prisma.event.count({ where: { seriesId: nev.seriesId } });
  const approve = await api('POST', `/admin/events/${nev.id}/approve`, admin);
  const ns = await sessionsOf(nev.seriesId);
  check('K', 'Reviewed once: a new host’s series waits (1 session); when an admin approves, all 3 go live, two weeks apart',
    npub.data?.status === 'PENDING_APPROVAL' && waiting === 1 && [200, 201].includes(approve.status) && ns.length === 3 && ns.every((s) => s.status === 'PUBLISHED') && ns[2].startDate.getTime() - ns[0].startDate.getTime() === 28 * DAY,
    `publish ${npub.data?.status}; waiting ${waiting}; approve ${approve.status} ${approve.data?.message ?? ''}; ${ns.length} sessions ${ns.map((s) => s.status[0]).join('')}`);

  // L — switching to open entry with tickets out is refused; without, the unsold types go
  const sw = await api('PUT', `/events/${sessions[3].id}`, org, { entryMode: 'OPEN' });
  const fresh = (await api('POST', '/events', org, { ...base, name: `Switch ${tag}` })).data;
  await api('POST', '/ticket-types', org, { eventId: fresh.id, name: 'Entry', category: 'GENERAL_ADMISSION', price: 0, quantityTotal: 10 });
  const sw2 = await api('PUT', `/events/${fresh.id}`, org, { entryMode: 'OPEN' });
  const leftTypes = await prisma.ticketType.count({ where: { eventId: fresh.id } });
  check('L', 'To open entry: refused once people have tickets; otherwise the unsold ticket types are removed',
    sw.status === 400 && sw2.status === 200 && sw2.data.entryMode === 'OPEN' && leftTypes === 0,
    `with tickets ${sw.status} "${sw.data?.message}"; without ${sw2.status} ${sw2.data?.entryMode}, types left ${leftTypes}`);

  // M — stop, and the hourly top-up (a second server with a 3-second top-up)
  const keep = (await api('POST', '/events', org, { ...base, name: `Jam ${tag}`, repeat: { frequency: 'WEEKLY', endMode: 'OPEN' } })).data;
  await api('POST', '/ticket-types', org, { eventId: keep.id, name: 'Entry', category: 'GENERAL_ADMISSION', price: 10000, quantityTotal: 50 });
  await api('POST', `/events/${keep.id}/publish`, org);
  // Time passes: the first two sessions are over.
  const ks = await sessionsOf(keep.seriesId);
  await prisma.eventSeries.update({ where: { id: keep.seriesId }, data: { anchorStart: new Date(ks[0].startDate.getTime() - 14 * DAY) } });
  for (const s of ks) await prisma.event.update({ where: { id: s.id }, data: { startDate: new Date(s.startDate.getTime() - 14 * DAY), endDate: new Date(s.endDate.getTime() - 14 * DAY) } });
  const env = { ...process.env, PORT: '4003', SERIES_TOPUP_MINUTES: '0.05', MODEMPAY_SECRET_KEY: 'sk_test_fake', MODEMPAY_WEBHOOK_SECRET: 'whsec_fake', RATE_LIMITS: 'off', ALLOW_MOCK_PAYMENTS: 'true' };
  const child = spawn('node', ['dist/main.js'], { env, stdio: 'ignore' });
  let topped = [];
  for (let i = 0; i < 40; i++) {
    await sleep(1000);
    topped = await sessionsOf(keep.seriesId);
    if (topped.length >= 10) break;
  }
  const ahead = topped.filter((s) => s.startDate > new Date()).length;
  const stop = await api('POST', `/series/${keep.seriesId}/stop`, org);
  await prisma.event.delete({ where: { id: topped[topped.length - 1].id } });
  await sleep(5000);
  const afterStop = await sessionsOf(keep.seriesId);
  child.kill();
  const continuous = topped.every((s, i) => s.startDate.getTime() === topped[0].startDate.getTime() + i * 7 * DAY && s.ticketTypes[0]?.price === 10000);
  check('M', 'Keep going: two sessions later in the past, the top-up adds 2 more so 8 are ahead, still weekly and priced; after Stop nothing is added',
    topped.length === 10 && ahead === 8 && continuous && stop.status === 200 && !!stop.data.stoppedAt && afterStop.length === 9,
    `${topped.length} sessions, ${ahead} ahead, weekly ${continuous}; stop ${stop.status}; after stop ${afterStop.length}`);

  // N — the date rules
  const { occurrence, seriesLabel } = require('./dist/series/series-rule');
  const lastSat = new Date('2026-10-31T10:00:00Z');
  const firstSat = new Date('2026-10-03T10:00:00Z');
  const n = [1, 2, 3].map((i) => day(occurrence(lastSat, 'MONTHLY', i)));
  const f = [1, 2, 3].map((i) => day(occurrence(firstSat, 'MONTHLY', i)));
  check('N', 'Monthly rule: last Saturday stays last (28 Nov, 26 Dec, 30 Jan), first stays first (7 Nov, 5 Dec, 2 Jan); labels',
    n.join() === '2026-11-28,2026-12-26,2027-01-30' && f.join() === '2026-11-07,2026-12-05,2027-01-02' && seriesLabel('MONTHLY', lastSat) === 'Last Saturday of the month' && seriesLabel('BIWEEKLY', firstSat) === 'Every other Saturday',
    `${n.join(' ')} | ${f.join(' ')} | ${seriesLabel('MONTHLY', lastSat)}`);

  const failed = results.filter((r) => !r.pass);
  console.log(`\n${results.length - failed.length}/${results.length} passed`);
  await prisma.$disconnect();
  process.exit(failed.length ? 1 : 0);
})().catch(async (e) => { console.error(e); await prisma.$disconnect(); process.exit(1); });
