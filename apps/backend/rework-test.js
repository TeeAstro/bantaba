// Phase 27: the host, admin and buyer screens after the rework
// (docs/host-rework.md, docs/store-rework.md). API checks plus the pages in
// a browser, on a computer and a phone.
// node rework-test.js   (backend and web app running, seed data loaded;
// PLAYWRIGHT_CHROMIUM can point at a Chromium if Playwright can't find one)
const BASE = 'http://localhost:4000/api/v1';
const WEB = process.env.WEB_URL ?? 'http://localhost:3000';
const results = [];
async function api(method, p, token, body) {
  const res = await fetch(BASE + p, { method, headers: { 'Content-Type': 'application/json', ...(token ? { Authorization: `Bearer ${token}` } : {}) }, body: body ? JSON.stringify(body) : undefined });
  let data = null; try { data = await res.json(); } catch {}
  return { status: res.status, data };
}
const login = async (email, password = 'SeedPassword123!') => (await api('POST', '/auth/login', null, { email, password })).data;
const check = (id, name, pass, detail) => { results.push({ id, pass }); console.log(`${pass ? 'PASS' : 'FAIL'}  ${id.padEnd(3)} ${name} — ${detail}`); };

function loadPlaywright() {
  for (const m of ['playwright', '@playwright/test', '/opt/npm-tools/node_modules/playwright']) {
    try { return require(m); } catch {}
  }
  return null;
}

(async () => {
  const [org, admin] = await Promise.all([login('organizer@example.com'), login('admin@example.com')]);

  // A — the events list has sales and setup on every row
  const mine = (await api('GET', '/events/mine', org.accessToken)).data;
  const sample = mine.find((e) => e.name === 'Sample Concert Night') ?? mine[0];
  check('A', 'Events list: sold, capacity, ticket types and going on every event',
    Array.isArray(mine) && mine.every((e) => typeof e.sold === 'number' && typeof e.capacity === 'number' && typeof e.ticketTypes === 'number' && typeof e.going === 'number'),
    `${mine.length} events; ${sample.name}: ${sample.sold}/${sample.capacity}, ${sample.ticketTypes} types`);

  // B — Discover: categories, today, by date
  const all = (await api('GET', '/storefront/discover')).data;
  const cat = all.categories?.[0];
  const one = cat ? (await api('GET', `/storefront/discover?category=${cat.slug}`)).data : null;
  const today = (await api('GET', '/storefront/discover?when=today')).data;
  const sorted = (all.events ?? []).every((e, i, a) => i === 0 || a[i - 1].startDate <= e.startDate);
  check('B', 'Discover: categories with counts, one category, Today, events by date (24 a page)',
    !!cat && one?.totalEvents === cat.count && one.trending.length === 0 && Array.isArray(today?.events) && sorted && all.events.length <= 24 && all.eventPages >= 1,
    `${all.categories?.length} categories; ${cat?.name} ${cat?.count} = ${one?.totalEvents}; today ${today?.totalEvents}; pages ${all.eventPages}`);
  const badCat = await api('GET', '/storefront/discover?category=Bad%20Slug!');
  check('C', 'Discover refuses a malformed category', badCat.status === 400, `${badCat.status}`);

  const pw = loadPlaywright();
  if (!pw) {
    console.log('(Playwright not installed: browser checks skipped)');
  } else {
    const browser = await pw.chromium.launch(process.env.PLAYWRIGHT_CHROMIUM ? { executablePath: process.env.PLAYWRIGHT_CHROMIUM } : {});
    const errors = [];
    const page = async (who, width) => {
      const ctx = await browser.newContext({ viewport: { width, height: width > 500 ? 900 : 844 } });
      if (who) await ctx.addInitScript((v) => localStorage.setItem('etp.session', v), JSON.stringify(who));
      const p = await ctx.newPage();
      p.on('pageerror', (e) => errors.push(e.message));
      return p;
    };
    const open = async (p, path) => { await p.goto(WEB + path, { waitUntil: 'load' }); await p.waitForTimeout(1500); };

    // D — events list: filters with counts, search
    let p = await page(org, 1280);
    await open(p, '/organizer/events');
    await p.waitForSelector('.hl-row');
    const chips = await p.locator('.hl-chip').allTextContents();
    await p.getByLabel('Search your events').fill(sample.name);
    await p.waitForTimeout(300);
    const names = await p.locator('.hl-row .hl-name b').allTextContents();
    check('D', 'Events list: Upcoming / Past chips with counts; search narrows the rows',
      chips.some((c) => /^Upcoming \d+$/.test(c.trim())) && chips.some((c) => /^Past \d+$/.test(c.trim())) && names.length > 0 && names.every((n) => n.includes(sample.name)),
      `${chips.join(' | ')}; ${names.length} match`);

    // E — event page: one row of tabs, old links still work
    await open(p, `/organizer/events/${sample.id}?tab=staff`);
    const tabs = await p.locator('.ev-tabs a').allTextContents();
    const current = await p.locator('.ev-tabs a[aria-current="page"]').textContent();
    const subtabs = await p.locator('.subtabs').count();
    await open(p, `/organizer/events/${sample.id}?tab=tickets`);
    const addForm = await p.getByRole('button', { name: 'Add ticket type' }).count();
    const edit = await p.getByRole('link', { name: /Edit tickets|Add tickets/ }).getAttribute('href');
    check('E', 'Event page: one row of tabs, ?tab=staff opens Gate, Tickets links to the form instead of its own',
      tabs.some((t) => t.includes('Gate')) && tabs.some((t) => t.includes('Orders')) && current?.includes('Gate') && subtabs === 0 && addForm === 0 && /\/edit#entry$/.test(edit ?? ''),
      `${tabs.map((t) => t.trim()).join(', ')}; staff → ${current?.trim()}; edit → ${edit}`);

    // F — withdraw
    await open(p, '/organizer/payouts');
    const hero = await p.locator('.wd-hero').textContent();
    check('F', 'Withdraw: what you can take out now, at the top', /Ready to withdraw|Owed to Bantaba/.test(hero ?? '') && /D[\d,]/.test(hero ?? ''), (hero ?? '').slice(0, 70));
    await p.context().close();

    // G — host on a phone: tabs at the bottom, More opens the rest
    p = await page(org, 390);
    await open(p, '/organizer');
    const bar = await p.locator('nav.tabbar').isVisible();
    const sideNav = await p.locator('.shell-org .sidebar .nav').isVisible();
    await p.getByRole('button', { name: 'More' }).click();
    const more = await p.locator('.tab-sheet-box a').allTextContents();
    check('G', 'Host on a phone: bottom tabs, the side menu hidden, More lists Venues, Staff, Profile and Help',
      bar && !sideNav && ['Venues', 'Staff', 'Profile', 'Help'].every((x) => more.some((m) => m.includes(x))),
      `tabs ${bar}, menu ${sideNav}; more: ${more.map((m) => m.trim()).join(', ')}`);
    await p.context().close();

    // H — admin lists: search and 25 at a time
    p = await page(admin, 1280);
    await open(p, '/admin/venues');
    const rows = await p.locator('tbody tr').count();
    await p.getByLabel('Venue, town or host').fill('zzzz-no-such-venue');
    await p.waitForTimeout(300);
    const none = await p.locator('tbody tr').count();
    check('H', 'Admin venues: at most 25 rows, search filters', rows > 0 && rows <= 25 && none === 0, `${rows} rows, then ${none}`);
    await p.context().close();

    // I — buyer home: category chips, search in the address
    p = await page(null, 390);
    await open(p, '/');
    if (cat) {
      await p.locator('.s-cats').getByRole('button', { name: cat.name, exact: true }).click();
      await p.waitForURL(new RegExp(`c=${cat.slug}`));
      await p.waitForTimeout(1200);
    }
    const heading = await p.locator('#on').textContent();
    await open(p, '/?q=night');
    const value = await p.getByPlaceholder('Event, artist, venue or host').inputValue();
    const results = await p.locator('#on').textContent();
    check('I', 'Buyer home: a category chip filters and goes in the address; ?q= fills the search',
      (!cat || heading?.trim() === cat.name) && value === 'night' && /Results for/.test(results ?? ''),
      `${heading?.trim()}; search "${value}" → ${results?.trim()}`);
    await p.context().close();

    // J — event page on a computer: tickets beside the details, total and button in the box
    const ga = (all.events ?? []).find((e) => e.price.kind === 'price' && !e.open);
    if (ga) {
      p = await page(null, 1280);
      await open(p, `/e/${ga.slug}`);
      const side = await p.locator('.s-ev2-side').isVisible();
      const plus = p.locator('.s-ev2-side').getByRole('button', { name: /One more/ }).first();
      if (await plus.count()) await plus.click();
      const btn = p.locator('.s-ev2-side .s-btn');
      const enabled = (await btn.count()) ? await btn.isEnabled() : false;
      const barShown = await p.locator('.s-ev2-bar').isVisible().catch(() => false);
      check('J', 'Event page on a computer: tickets in a box beside the details; Get tickets in the box, no bottom bar',
        side && enabled && !barShown, `side ${side}, button ${enabled}, bar ${barShown}`);
      await p.context().close();
    } else check('J', 'Event page on a computer', true, 'no paid event to try (skipped)');

    check('K', 'No page errors', errors.length === 0, errors.slice(0, 3).join(' | ') || 'none');
    await browser.close();
  }

  const failed = results.filter((r) => !r.pass);
  console.log(`\n${results.length - failed.length}/${results.length} passed`);
  process.exit(failed.length ? 1 : 0);
})().catch((e) => {
  console.error(e);
  process.exit(1);
});
