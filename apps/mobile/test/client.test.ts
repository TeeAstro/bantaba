// Runs the app's real API client (src/api/client.ts) against the backend.
// node --experimental-strip-types test/client.test.ts
import { createApiClient, compareVersions, parseServerTiming, type SecureStorage } from '../src/api/client.ts';

const BASE = process.env.API_URL ?? 'http://localhost:4000';
const results: boolean[] = [];
const check = (name: string, pass: boolean, detail: string) => { results.push(pass); console.log(`${pass ? 'PASS' : 'FAIL'}  ${name} — ${detail}`); };
const memStorage = (): SecureStorage & { data: Map<string, string> } => {
  const data = new Map<string, string>();
  return { data, async get(k) { return data.get(k) ?? null; }, async set(k, v) { data.set(k, v); }, async delete(k) { data.delete(k); } };
};
const raw = async (m: string, p: string, t?: string, b?: unknown) => {
  const r = await fetch(`${BASE}/api/v1${p}`, { method: m, headers: { 'Content-Type': 'application/json', ...(t ? { Authorization: `Bearer ${t}` } : {}) }, body: b ? JSON.stringify(b) : undefined });
  return r.json().catch(() => null);
};

// Setup: live event, staff assigned, two tickets
const org = (await raw('POST', '/auth/login', undefined, { email: 'organizer@example.com', password: 'SeedPassword123!' })).accessToken;
const cust = (await raw('POST', '/auth/login', undefined, { email: 'customer@example.com', password: 'SeedPassword123!' })).accessToken;
const venue = (await raw('GET', '/venues')).find((v: any) => v.name === 'Independence Stadium');
const cat = (await raw('GET', '/categories'))[0];
const ev = await raw('POST', '/events', org, { name: `Mobile Client Test ${Date.now() % 100000}`, categoryId: cat.id, venueId: venue.id, startDate: new Date(Date.now() - 600e3).toISOString(), endDate: new Date(Date.now() + 3 * 3600e3).toISOString() });
await raw('POST', `/events/${ev.id}/publish`, org);
const tt = await raw('POST', '/ticket-types', org, { eventId: ev.id, name: 'GA', price: 10000, quantityTotal: 20 });
await raw('POST', `/events/${ev.id}/staff`, org, { email: 'staff@example.com', role: 'GATE_STAFF' });
const co = await raw('POST', '/orders/checkout', cust, { eventId: ev.id, provider: 'MOCK', items: [{ ticketTypeId: tt.id, quantity: 1 }] });
const ticket = co.order.tickets[0];

// 1 — staff sign-in stores only the refresh token + user
const s1 = memStorage();
const api = createApiClient({ baseUrl: BASE, storage: s1 });
const user = await api.login('staff@example.com', 'SeedPassword123!');
check('Staff sign-in', user.role === 'STAFF' && s1.data.has('etp.refreshToken') && !JSON.stringify([...s1.data.values()]).includes('eyJ'),
  `role ${user.role}, stored keys ${[...s1.data.keys()].join(', ')}, access token not in storage`);

// 2 — app config + event list
const cfg = await api.appConfig();
const events = await api.scannerEvents();
check('App config + assigned events', cfg.apiVersion === '1' && events.some((e) => e.id === ev.id), `api v${cfg.apiVersion}, ${events.length} events incl. test event`);

// 3 — expired access token + 6 parallel requests → exactly one refresh
const tokenBefore = s1.data.get('etp.refreshToken');
api._expireAccessToken();
const before = api.refreshCount;
const parallel = await Promise.allSettled([api.scannerEvents(), api.scanProgress(ev.id), api.me(), api.scannerEvents(), api.scanProgress(ev.id), api.me()]);
const ok = parallel.every((p) => p.status === 'fulfilled');
check('Six parallel requests on an expired token share one refresh', ok && api.refreshCount - before === 1 && s1.data.get('etp.refreshToken') !== tokenBefore,
  `${parallel.filter((p) => p.status === 'fulfilled').length}/6 succeeded, refreshes ${api.refreshCount - before}, refresh token rotated`);

// 4 — the app restarts: new client, same storage, no access token in memory
const api2 = createApiClient({ baseUrl: BASE, storage: s1 });
const restored = await api2.storedUser();
const after = await api2.scannerEvents();
check('Restart restores the session from secure storage', restored?.email === 'staff@example.com' && after.length > 0, `user ${restored?.email}, events ${after.length}`);

// 5 — scan
const r1 = await api2.checkIn({ qrToken: ticket.qrToken, eventId: ev.id });
const r2 = await api2.checkIn({ qrToken: ticket.qrToken, eventId: ev.id });
check('Scan VALID then ALREADY_USED', r1.result === 'VALID' && r2.result === 'ALREADY_USED', `${r1.result}, ${r2.result}`);

// 6 — session killed elsewhere → onSignedOut, storage cleared
let signedOut = 0;
const s3 = memStorage();
const api3 = createApiClient({ baseUrl: BASE, storage: s3, onSignedOut: () => { signedOut += 1; } });
await api3.login('staff@example.com', 'SeedPassword123!');
const stolen = s3.data.get('etp.refreshToken')!;
await raw('POST', '/auth/refresh', undefined, { refreshToken: stolen }); // someone else uses it first
api3._expireAccessToken();
const failed = await api3.scannerEvents().then(() => null, (e) => e);
check('Refresh refused → signed out cleanly', failed?.status === 401 && signedOut === 1 && s3.data.size === 0, `error ${failed?.status}, onSignedOut called ${signedOut}×, storage keys ${s3.data.size}`);

// 7 — logout deletes token before telling the server
const s4 = memStorage();
const api4 = createApiClient({ baseUrl: BASE, storage: s4 });
await api4.login('staff@example.com', 'SeedPassword123!');
await api4.logout();
check('Logout clears secure storage', s4.data.size === 0 && (await api4.storedUser()) === null, `storage keys ${s4.data.size}`);

// 8 — customer can't use the app, nothing kept
const s5 = memStorage();
const api5 = createApiClient({ baseUrl: BASE, storage: s5 });
const denied = await api5.login('customer@example.com', 'SeedPassword123!').then(() => null, (e) => e);
check('Customer account refused, no tokens kept', denied?.status === 403 && s5.data.size === 0, `${denied?.status} "${denied?.message}", storage keys ${s5.data.size}`);

// 9 — version comparison
check('Version comparison', compareVersions('1.2.10', '1.2.9') === 1 && compareVersions('0.1.0', '1.0.0') === -1 && compareVersions('2.0.0', '2.0.0') === 0, '1.2.10>1.2.9, 0.1.0<1.0.0, equal');

// 10 — server unreachable → clear message, token kept
const s6 = memStorage();
const api6 = createApiClient({ baseUrl: 'http://127.0.0.1:9', storage: s6 });
const down = await api6.appConfig().then(() => null, (e) => e);
check('Server unreachable → readable error', down?.status === 0 && /Can't reach the server/.test(down.message), down?.message);

// 11 — Server-Timing: the backend reports its own time per check-in, the client reads it
const co2 = await raw('POST', '/orders/checkout', cust, { eventId: ev.id, provider: 'MOCK', items: [{ ticketTypeId: tt.id, quantity: 1 }] });
const timing: { server?: ReturnType<typeof parseServerTiming> } = {};
const t0 = performance.now();
const r3 = await api.checkIn({ qrToken: co2.order.tickets[0].qrToken, eventId: ev.id }, timing);
const roundTrip = performance.now() - t0;
const st = timing.server;
const parsed = parseServerTiming('app;dur=41.2, db;dur=33.8;desc="6 queries"');
check('Server timing on check-in', r3.result === 'VALID' && !!st && st.appMs > 0 && st.appMs <= roundTrip && (st.dbMs ?? -1) >= 0 && (st.dbMs ?? 0) <= st.appMs && (st.dbQueries ?? 0) > 0
  && parsed?.appMs === 41.2 && parsed?.dbMs === 33.8 && parsed?.dbQueries === 6 && parseServerTiming(null) === null,
  `server ${st?.appMs.toFixed(1)} ms (db ${st?.dbMs?.toFixed(1)} ms, ${st?.dbQueries} queries) of ${roundTrip.toFixed(1)} ms round trip; parser ok`);

const failedCount = results.filter((r) => !r).length;
console.log(`\n${results.length - failedCount}/${results.length} passed`);
process.exit(failedCount ? 1 : 0);
