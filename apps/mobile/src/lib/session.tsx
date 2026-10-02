import { createContext, useCallback, useContext, useEffect, useMemo, useState } from 'react';
import { Platform } from 'react-native';
import { compareVersions, createApiClient, type ApiClient, type AppConfig, type SessionUser } from '../api/client';
import { API_URL, APP_VERSION } from './config';
import { secureStorage } from './storage';

type Status = 'loading' | 'signedOut' | 'signedIn';
type UpdateState = 'ok' | 'suggested' | 'required';

interface SessionValue {
  api: ApiClient;
  status: Status;
  user: SessionUser | null;
  update: UpdateState;
  signIn(email: string, password: string): Promise<void>;
  signOut(): Promise<void>;
}

const SessionContext = createContext<SessionValue | null>(null);

function updateStateFor(cfg: AppConfig): UpdateState {
  const platform = Platform.OS === 'ios' ? 'ios' : 'android';
  if (compareVersions(APP_VERSION, cfg.minSupportedVersion[platform]) < 0) return 'required';
  if (compareVersions(APP_VERSION, cfg.latestVersion[platform]) < 0) return 'suggested';
  return 'ok';
}

export function SessionProvider({ children }: { children: React.ReactNode }) {
  const [status, setStatus] = useState<Status>('loading');
  const [user, setUser] = useState<SessionUser | null>(null);
  const [update, setUpdate] = useState<UpdateState>('ok');

  // One client for the app's lifetime, so the single-flight refresh really
  // is single across every screen.
  const api = useMemo(
    () =>
      createApiClient({
        baseUrl: API_URL,
        storage: secureStorage,
        onSignedOut: () => {
          setUser(null);
          setStatus('signedOut');
        },
      }),
    [],
  );

  useEffect(() => {
    (async () => {
      // Version check first; if the server can't be reached, carry on —
      // the screens show their own "can't reach the server" errors.
      try {
        setUpdate(updateStateFor(await api.appConfig()));
      } catch {
        /* offline: don't block */
      }
      const stored = await api.storedUser();
      setUser(stored);
      setStatus(stored ? 'signedIn' : 'signedOut');
    })();
  }, [api]);

  const signIn = useCallback(
    async (email: string, password: string) => {
      const u = await api.login(email, password);
      setUser(u);
      setStatus('signedIn');
    },
    [api],
  );

  const signOut = useCallback(async () => {
    await api.logout();
    setUser(null);
    setStatus('signedOut');
  }, [api]);

  const value = useMemo(() => ({ api, status, user, update, signIn, signOut }), [api, status, user, update, signIn, signOut]);
  return <SessionContext.Provider value={value}>{children}</SessionContext.Provider>;
}

export function useSession(): SessionValue {
  const v = useContext(SessionContext);
  if (!v) throw new Error('useSession must be used inside SessionProvider');
  return v;
}
