'use client';

import { useCallback, useEffect, useState, useSyncExternalStore } from 'react';
import { api, ApiError, loadSession, SessionUser } from './api';

function subscribe(cb: () => void) {
  window.addEventListener('etp-session', cb);
  window.addEventListener('storage', cb); // other tabs logging in/out
  return () => {
    window.removeEventListener('etp-session', cb);
    window.removeEventListener('storage', cb);
  };
}

// Serialized so useSyncExternalStore sees a stable value between changes.
const snapshot = () => JSON.stringify(loadSession()?.user ?? null);

// undefined while hydrating on the client, null when logged out.
export function useSessionUser(): SessionUser | null | undefined {
  const raw = useSyncExternalStore(subscribe, snapshot, () => 'undefined');
  return raw === 'undefined' ? undefined : (JSON.parse(raw) as SessionUser | null);
}

export interface Loadable<T> {
  data: T | null;
  error: string | null;
  loading: boolean;
  reload: () => void;
}

// GET a path and keep it in state. `path = null` skips loading.
export function useApi<T>(path: string | null): Loadable<T> {
  const [data, setData] = useState<T | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(!!path);
  const [nonce, setNonce] = useState(0);

  useEffect(() => {
    if (!path) return;
    let cancelled = false;
    setLoading(true);
    api<T>(path)
      .then((d) => {
        if (!cancelled) {
          setData(d);
          setError(null);
        }
      })
      .catch((e: ApiError) => !cancelled && setError(e.message))
      .finally(() => !cancelled && setLoading(false));
    return () => {
      cancelled = true;
    };
  }, [path, nonce]);

  const reload = useCallback(() => setNonce((n) => n + 1), []);
  return { data, error, loading, reload };
}
