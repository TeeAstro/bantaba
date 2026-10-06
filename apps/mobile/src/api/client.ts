// API client for the staff app. Plain TypeScript — no React Native imports —
// so the token rules can be tested on their own against the real backend.
//
// Implements the mobile rules in docs/auth.md → "Mobile clients":
//   - the refresh token lives in secure storage (the `storage` passed in:
//     Keychain/Keystore in the app), the access token only in memory
//   - concurrent 401s share ONE refresh call (refresh tokens are single-use;
//     racing two refreshes with the same token ends every session)
//   - the rotated refresh token is saved before anything else can read the old one
//   - logout deletes the stored token immediately
//   - a 401 from /auth/refresh means "sign in again"
import type { components } from './schema';

export type Schemas = components['schemas'];
export type SessionUser = Schemas['PublicUserDto'];
export type ScannerEvent = Schemas['ScannerEventDto'];
export type ScanProgress = Schemas['ScanProgressDto'];
export type CheckInResponse = Schemas['CheckInResponseDto'];
export type CheckInResult = Schemas['CheckInResult'];
export type AppConfig = Schemas['AppConfigDto'];

// Server-Timing header from the backend (see apps/backend/src/common/server-timing.ts):
// how long the server spent on a request, and how much of that was database.
export interface ServerTiming {
  appMs: number;
  dbMs?: number;
  dbQueries?: number;
}

export function parseServerTiming(header: string | null): ServerTiming | null {
  if (!header) return null;
  const metrics = new Map<string, { dur?: number; desc?: string }>();
  for (const part of header.split(',')) {
    const [name, ...params] = part.trim().split(';');
    const m: { dur?: number; desc?: string } = {};
    for (const p of params) {
      const [k, v = ''] = p.trim().split('=');
      if (k === 'dur') m.dur = parseFloat(v);
      if (k === 'desc') m.desc = v.replace(/^"|"$/g, '');
    }
    metrics.set(name.trim(), m);
  }
  const app = metrics.get('app')?.dur;
  if (app === undefined || Number.isNaN(app)) return null;
  const db = metrics.get('db');
  return { appMs: app, dbMs: db?.dur, dbQueries: db?.desc ? parseInt(db.desc, 10) || 0 : undefined };
}

export interface SecureStorage {
  get(key: string): Promise<string | null>;
  set(key: string, value: string): Promise<void>;
  delete(key: string): Promise<void>;
}

export class ApiError extends Error {
  status: number; // HTTP status; 0 = server unreachable
  constructor(status: number, message: string) {
    super(message);
    this.status = status;
  }
}

const REFRESH_KEY = 'etp.refreshToken';
const USER_KEY = 'etp.user';

function messageFrom(body: unknown, status: number): string {
  const m = (body as { message?: unknown } | null)?.message;
  if (Array.isArray(m)) return m.join('. ');
  if (typeof m === 'string') return m;
  return `Request failed (${status})`;
}

export function createApiClient(opts: {
  baseUrl: string; // e.g. http://192.168.1.20:4000 — "/api/v1" is added here
  storage: SecureStorage;
  onSignedOut?: () => void; // session ended (refresh refused) — show sign-in
  fetchImpl?: typeof fetch;
}) {
  const fetchFn = opts.fetchImpl ?? fetch;
  const root = `${opts.baseUrl.replace(/\/$/, '')}/api/v1`;
  let accessToken: string | null = null;
  let refreshInFlight: Promise<boolean> | null = null;
  let refreshCount = 0; // exposed for tests/diagnostics

  async function clearSession() {
    accessToken = null;
    await opts.storage.delete(REFRESH_KEY);
    await opts.storage.delete(USER_KEY);
  }

  async function rawRequest(method: string, path: string, body: unknown, token: string | null) {
    let res: Response;
    try {
      res = await fetchFn(`${root}${path}`, {
        method,
        headers: {
          ...(body !== undefined ? { 'Content-Type': 'application/json' } : {}),
          ...(token ? { Authorization: `Bearer ${token}` } : {}),
        },
        body: body !== undefined ? JSON.stringify(body) : undefined,
      });
    } catch {
      throw new ApiError(0, `Can't reach the server at ${opts.baseUrl}. Check the phone is on the same network and the backend is running.`);
    }
    const text = await res.text();
    let data: unknown = null;
    try {
      data = text ? JSON.parse(text) : null;
    } catch {
      data = null;
    }
    return { res, data };
  }

  // Single-flight: every caller that hits a 401 while a refresh is running
  // awaits the same promise instead of starting its own.
  function refresh(): Promise<boolean> {
    if (!refreshInFlight) {
      refreshInFlight = (async () => {
        try {
          const stored = await opts.storage.get(REFRESH_KEY);
          if (!stored) return false;
          refreshCount += 1;
          const { res, data } = await rawRequest('POST', '/auth/refresh', { refreshToken: stored }, null);
          if (res.status === 401) {
            await clearSession();
            opts.onSignedOut?.();
            return false;
          }
          if (!res.ok) return false; // e.g. server down: keep the token, try again later
          const tokens = data as Schemas['TokenPairDto'];
          await opts.storage.set(REFRESH_KEY, tokens.refreshToken); // save the rotated token first
          accessToken = tokens.accessToken;
          return true;
        } finally {
          refreshInFlight = null;
        }
      })();
    }
    return refreshInFlight;
  }

  // `timing`, when passed, receives the final response's Server-Timing.
  async function request<T>(method: string, path: string, body?: unknown, timing?: { server?: ServerTiming | null }): Promise<T> {
    if (!accessToken && (await opts.storage.get(REFRESH_KEY))) await refresh();
    let { res, data } = await rawRequest(method, path, body, accessToken);
    if (res.status === 401 && (await opts.storage.get(REFRESH_KEY))) {
      if (await refresh()) ({ res, data } = await rawRequest(method, path, body, accessToken));
    }
    if (timing) timing.server = parseServerTiming(res.headers.get('server-timing'));
    if (!res.ok) throw new ApiError(res.status, messageFrom(data, res.status));
    return data as T;
  }

  return {
    get refreshCount() {
      return refreshCount;
    },

    async storedUser(): Promise<SessionUser | null> {
      if (!(await opts.storage.get(REFRESH_KEY))) return null;
      const raw = await opts.storage.get(USER_KEY);
      return raw ? (JSON.parse(raw) as SessionUser) : null;
    },

    async login(email: string, password: string): Promise<SessionUser> {
      const { res, data } = await rawRequest('POST', '/auth/login', { email, password }, null);
      if (!res.ok) throw new ApiError(res.status, messageFrom(data, res.status));
      const session = data as Schemas['AuthSessionDto'];
      if (session.user.role !== 'STAFF' && session.user.role !== 'ORGANIZER') {
        // Don't keep tokens for accounts that can't use this app.
        await rawRequest('POST', '/auth/logout', { refreshToken: session.refreshToken }, null);
        throw new ApiError(403, 'This app is for event staff and organizers.');
      }
      accessToken = session.accessToken;
      await opts.storage.set(REFRESH_KEY, session.refreshToken);
      await opts.storage.set(USER_KEY, JSON.stringify(session.user));
      return session.user;
    },

    async logout() {
      const stored = await opts.storage.get(REFRESH_KEY);
      await clearSession(); // delete first: a logged-out token must never be sent again
      if (stored) await rawRequest('POST', '/auth/logout', { refreshToken: stored }, null).catch(() => undefined);
    },

    appConfig: () => request<AppConfig>('GET', '/app-config'),
    me: () => request<Schemas['CurrentUserDto']>('GET', '/auth/me'),
    scannerEvents: () => request<ScannerEvent[]>('GET', '/scanner/events'),
    scanProgress: (eventId: string) => request<ScanProgress>('GET', `/scanner/events/${eventId}/progress`),
    // Pass `timing` to get the server's own timing for this check-in (bake-off panel).
    checkIn: (body: Schemas['CreateCheckInDto'], timing?: { server?: ServerTiming | null }) =>
      request<CheckInResponse>('POST', '/check-ins', body, timing),
    // Phase 21 (offline scanning): any POST, for the offline engine (lib/offlineScan.ts).
    post: <T,>(path: string, body: unknown) => request<T>('POST', path, body),

    // Test hook: simulate an expired access token.
    _expireAccessToken() {
      accessToken = 'expired.invalid.token';
    },
  };
}

export type ApiClient = ReturnType<typeof createApiClient>;

// "1.2.10" vs "1.2.9" — numeric, part by part.
export function compareVersions(a: string, b: string): number {
  const pa = a.split('.').map((n) => parseInt(n, 10) || 0);
  const pb = b.split('.').map((n) => parseInt(n, 10) || 0);
  for (let i = 0; i < 3; i += 1) {
    if ((pa[i] ?? 0) !== (pb[i] ?? 0)) return (pa[i] ?? 0) < (pb[i] ?? 0) ? -1 : 1;
  }
  return 0;
}
