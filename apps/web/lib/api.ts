// Small typed fetch wrapper for the backend API.
//
// Tokens: the access token (15-minute JWT) and the refresh token (opaque,
// single-use — see docs/auth.md) are kept in localStorage so a page reload
// doesn't log the organizer out. Trade-off, documented in
// docs/organizer-dashboard.md: localStorage is readable by any script on
// the page, so an XSS bug would expose them. Moving the refresh token to
// an httpOnly cookie is the planned hardening (Phase 18 security audit).

// Empty string = same origin: requests go to /api on the Next.js server,
// which forwards them to the backend (next.config.js). That's the setup
// for scanning from a phone; see docs/scanner.md.
const API_URL = process.env.NEXT_PUBLIC_API_URL ?? 'http://localhost:4000';
const STORAGE_KEY = 'etp.session';

export type Role = 'CUSTOMER' | 'ORGANIZER' | 'STAFF' | 'ADMIN';

export interface SessionUser {
  id: string;
  email: string;
  role: Role;
  fullName: string | null;
}

interface Session {
  user: SessionUser;
  accessToken: string;
  refreshToken: string;
}

export class ApiError extends Error {
  constructor(
    public status: number,
    message: string,
  ) {
    super(message);
  }
}

export function loadSession(): Session | null {
  if (typeof window === 'undefined') return null;
  try {
    const raw = window.localStorage.getItem(STORAGE_KEY);
    return raw ? (JSON.parse(raw) as Session) : null;
  } catch {
    return null;
  }
}

function saveSession(session: Session | null) {
  try {
    if (session) window.localStorage.setItem(STORAGE_KEY, JSON.stringify(session));
    else window.localStorage.removeItem(STORAGE_KEY);
  } catch {
    // Private mode / blocked storage: the session just won't survive a reload.
  }
  window.dispatchEvent(new Event('etp-session'));
}

/** Change the signed-in user's name (or other fields) in the saved session, e.g. after the Profile page saves. */
export function updateSessionUser(patch: Partial<SessionUser>) {
  const session = loadSession();
  if (session) saveSession({ ...session, user: { ...session.user, ...patch } });
}

function messageFrom(body: unknown, status: number): string {
  const m = (body as { message?: unknown } | null)?.message;
  if (Array.isArray(m)) return m.join('. ');
  if (typeof m === 'string') return m;
  return `Request failed (${status})`;
}

// Refresh tokens are single-use and the backend treats a reused one as
// theft (it revokes every session). So when several requests hit a 401
// at once, they must share ONE refresh call rather than each firing
// their own — the second would present an already-rotated token.
let refreshInFlight: Promise<boolean> | null = null;

async function refreshSession(): Promise<boolean> {
  const session = loadSession();
  if (!session) return false;
  if (!refreshInFlight) {
    refreshInFlight = (async () => {
      try {
        const res = await fetch(`${API_URL}/api/v1/auth/refresh`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ refreshToken: session.refreshToken }),
        });
        if (!res.ok) {
          saveSession(null);
          return false;
        }
        const data = await res.json();
        saveSession({ ...session, accessToken: data.accessToken, refreshToken: data.refreshToken });
        return true;
      } catch {
        return false;
      } finally {
        refreshInFlight = null;
      }
    })();
  }
  return refreshInFlight;
}

export async function api<T>(
  path: string,
  options: { method?: string; body?: unknown; auth?: boolean; headers?: Record<string, string> } = {},
): Promise<T> {
  const { method = 'GET', body, auth = true, headers = {} } = options;

  // FormData (file uploads) goes as multipart; the browser sets the
  // Content-Type with its boundary itself.
  const isForm = typeof FormData !== 'undefined' && body instanceof FormData;
  const send = () => {
    const session = auth ? loadSession() : null;
    return fetch(`${API_URL}/api/v1${path}`, {
      method,
      headers: {
        ...(body !== undefined && !isForm ? { 'Content-Type': 'application/json' } : {}),
        ...(session ? { Authorization: `Bearer ${session.accessToken}` } : {}),
        ...headers,
      },
      body: body === undefined ? undefined : isForm ? (body as FormData) : JSON.stringify(body),
    });
  };

  let res: Response;
  try {
    res = await send();
  } catch {
    throw new ApiError(0, `Can't reach the server${API_URL ? ` at ${API_URL}` : ''}. Check that the backend is running.`);
  }

  if (res.status === 401 && auth && loadSession()) {
    if (await refreshSession()) res = await send();
  }

  const text = await res.text();
  let data: unknown = null;
  try {
    data = text ? JSON.parse(text) : null;
  } catch {
    data = null; // e.g. an HTML error page from a proxy
  }
  if (!res.ok) throw new ApiError(res.status, messageFrom(data, res.status));
  return data as T;
}

export async function login(email: string, password: string): Promise<SessionUser> {
  const data = await api<{ user: SessionUser; accessToken: string; refreshToken: string }>(
    '/auth/login',
    { method: 'POST', body: { email, password }, auth: false },
  );
  saveSession({ user: data.user, accessToken: data.accessToken, refreshToken: data.refreshToken });
  return data.user;
}

// Phase 13: customers create an account to accept a transferred ticket
// (the full customer storefront comes later).
export async function register(email: string, password: string, fullName?: string): Promise<SessionUser> {
  const data = await api<{ user: SessionUser; accessToken: string; refreshToken: string }>(
    '/auth/register',
    { method: 'POST', body: { email, password, ...(fullName ? { fullName } : {}) }, auth: false },
  );
  saveSession({ user: data.user, accessToken: data.accessToken, refreshToken: data.refreshToken });
  return data.user;
}

// Phase 16: buyers sign in with a 6-digit code sent to their email
// (docs/storefront.md). Signing in with a code also signs a new buyer up.
export async function requestCode(email: string): Promise<{ sent: boolean; minutes: number }> {
  return api('/auth/email-code', { method: 'POST', body: { email }, auth: false });
}

export async function signInWithCode(email: string, code: string): Promise<SessionUser> {
  const data = await api<{ user: SessionUser; accessToken: string; refreshToken: string }>(
    '/auth/email-code/verify',
    { method: 'POST', body: { email, code }, auth: false },
  );
  saveSession({ user: data.user, accessToken: data.accessToken, refreshToken: data.refreshToken });
  return data.user;
}

export async function logout() {
  const session = loadSession();
  saveSession(null);
  if (session) {
    // Best effort: revoke the refresh token server-side.
    await fetch(`${API_URL}/api/v1/auth/logout`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ refreshToken: session.refreshToken }),
    }).catch(() => undefined);
  }
}
