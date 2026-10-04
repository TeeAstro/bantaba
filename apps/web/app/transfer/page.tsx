'use client';

import { FormEvent, useEffect, useState } from 'react';
import { api, ApiError, loadSession, login, logout, register, SessionUser } from '@/lib/api';
import { dateTime } from '@/lib/format';
import { Logo } from '@/components/Logo';
import { BackLink } from '@/components/BackLink';

// Phase 13: someone sent you a ticket. Opened from the email link
// (/transfer#token=…). The token sits in the #fragment, so it never reaches
// a server log; it's read here and cleared from the address bar.
// Accepting needs an account with the address the ticket was sent to.

interface Preview {
  status: 'PENDING' | 'ACCEPTED' | 'REJECTED' | 'CANCELLED' | 'EXPIRED';
  toEmail: string;
  fromName: string | null;
  expiresAt: string;
  event: { name: string; startDate: string; endDate: string; venue: string; city: string; posterUrl: string | null };
  ticket: { type: string; seat: string | null };
}

const CLOSED: Record<string, string> = {
  ACCEPTED: 'This ticket has already been accepted.',
  REJECTED: 'This offer was declined.',
  CANCELLED: 'The sender took this offer back, or the ticket is no longer valid.',
  EXPIRED: 'This offer has expired. Ask the sender to send it again.',
};

export default function TransferPage() {
  const [token, setToken] = useState<string | null>(null);
  const [preview, setPreview] = useState<Preview | null>(null);
  const [user, setUser] = useState<SessionUser | null>(null);
  const [mode, setMode] = useState<'signin' | 'register'>('register');
  const [name, setName] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [done, setDone] = useState<'accepted' | 'declined' | null>(null);
  const [busy, setBusy] = useState(false);
  const [loadError, setLoadError] = useState<string | null>(null);

  useEffect(() => {
    const t = new URLSearchParams(window.location.hash.slice(1)).get('token');
    if (t) window.history.replaceState(null, '', window.location.pathname);
    setToken(t);
    setUser(loadSession()?.user ?? null);
    if (!t) return setLoadError('This link is incomplete. Open the link from the email again.');
    api<Preview>('/transfers/preview', { method: 'POST', body: { token: t }, auth: false })
      .then(setPreview)
      .catch((e) => setLoadError(e instanceof ApiError ? e.message : 'Could not load this transfer'));
  }, []);

  const matches = !!user && !!preview && user.email.toLowerCase() === preview.toEmail;

  async function accept() {
    setBusy(true);
    setError(null);
    try {
      await api('/transfers/accept', { method: 'POST', body: { token } });
      setDone('accepted');
    } catch (e) {
      setError(e instanceof ApiError ? e.message : 'Could not accept the ticket');
    } finally {
      setBusy(false);
    }
  }

  async function decline() {
    if (!window.confirm('Decline this ticket? The sender will be told and keeps it.')) return;
    setBusy(true);
    setError(null);
    try {
      await api('/transfers/decline', { method: 'POST', body: { token }, auth: false });
      setDone('declined');
    } catch (e) {
      setError(e instanceof ApiError ? e.message : 'Could not decline');
    } finally {
      setBusy(false);
    }
  }

  async function authAndAccept(e: FormEvent) {
    e.preventDefault();
    if (!preview) return;
    setBusy(true);
    setError(null);
    try {
      const u = mode === 'register' ? await register(preview.toEmail, password, name.trim() || undefined) : await login(preview.toEmail, password);
      setUser(u);
      if (u.role !== 'CUSTOMER') {
        setError('This is a staff or organizer account. Tickets can only be received by customer accounts.');
        return;
      }
      await api('/transfers/accept', { method: 'POST', body: { token } });
      setDone('accepted');
    } catch (err) {
      const m = err instanceof ApiError ? err.message : 'Something went wrong';
      setError(/already exists|already registered|in use/i.test(m) ? 'There’s already an account with this email. Sign in instead.' : m);
      if (/already/i.test(m)) setMode('signin');
    } finally {
      setBusy(false);
    }
  }

  return (
    <main className="login-page">
      <div className="login-card form" style={{ maxWidth: 460 }}>
        <Logo onDark={false} host={false} />
        <div>
          <h1>A ticket for you</h1>
        </div>
        {loadError && <div className="notice notice-error" role="alert">{loadError}</div>}
        {!preview && !loadError && <p className="muted">Loading…</p>}
        {preview && (
          <>
            <div className="transfer-card">
              {preview.event.posterUrl && (
                // eslint-disable-next-line @next/next/no-img-element
                <img src={preview.event.posterUrl} alt="" />
              )}
              <div>
                <div className="small muted">{preview.fromName ?? 'Someone'} is giving you</div>
                <div style={{ fontWeight: 700, fontSize: 18, margin: '2px 0 6px' }}>{preview.event.name}</div>
                <div className="small">{dateTime(preview.event.startDate)}</div>
                <div className="small">{preview.event.venue}, {preview.event.city}</div>
                <div className="small" style={{ marginTop: 6 }}>{preview.ticket.type}{preview.ticket.seat ? ` · ${preview.ticket.seat}` : ''}</div>
              </div>
            </div>

            {done === 'accepted' ? (
              <div className="notice notice-ok" role="status">
                The ticket is yours. We’ve emailed your QR code to <b>{preview.toEmail}</b>: show it at the gate. The sender’s copy no longer works.
              </div>
            ) : done === 'declined' ? (
              <div className="notice notice-info" role="status">You declined the ticket. The sender has been told.</div>
            ) : preview.status !== 'PENDING' ? (
              <div className="notice notice-info">{CLOSED[preview.status]}</div>
            ) : (
              <>
                {error && <div className="notice notice-error" role="alert">{error}</div>}
                {matches ? (
                  <>
                    <p className="small muted">Signed in as {user!.email}.</p>
                    <button className="btn" disabled={busy} onClick={accept}>{busy ? 'Accepting…' : 'Accept the ticket'}</button>
                  </>
                ) : user ? (
                  <div className="notice notice-info">
                    This ticket was sent to <b>{preview.toEmail}</b>, but you’re signed in as {user.email}.{' '}
                    <button className="btn-inline" onClick={async () => { await logout(); setUser(null); }}>Sign out</button> and use that address.
                  </div>
                ) : (
                  <form className="form" onSubmit={authAndAccept}>
                    <p className="small muted">
                      It was sent to <b>{preview.toEmail}</b>. {mode === 'register' ? 'Create a free account with that address to accept it.' : 'Sign in with that address to accept it.'}
                    </p>
                    {mode === 'register' && (
                      <div className="field">
                        <label htmlFor="name">Your name</label>
                        <input id="name" autoComplete="name" value={name} onChange={(e) => setName(e.target.value)} />
                      </div>
                    )}
                    <div className="field">
                      <label htmlFor="pw">{mode === 'register' ? 'Choose a password' : 'Password'}</label>
                      <input id="pw" type="password" autoComplete={mode === 'register' ? 'new-password' : 'current-password'} minLength={mode === 'register' ? 12 : undefined} required value={password} onChange={(e) => setPassword(e.target.value)} />
                      {mode === 'register' && <span className="hint">At least 12 characters.</span>}
                    </div>
                    <button className="btn" type="submit" disabled={busy}>{busy ? 'One moment…' : mode === 'register' ? 'Create account and accept' : 'Sign in and accept'}</button>
                    <p className="small">
                      {mode === 'register' ? (
                        <>Already have an account? <button type="button" className="btn-inline" onClick={() => { setMode('signin'); setError(null); }}>Sign in</button></>
                      ) : (
                        <>New here? <button type="button" className="btn-inline" onClick={() => { setMode('register'); setError(null); }}>Create an account</button> · <a href="/forgot-password">Forgot password?</a></>
                      )}
                    </p>
                  </form>
                )}
                <p className="small faint">
                  Offer open until {dateTime(preview.expiresAt)}. Not for you?{' '}
                  <button className="btn-inline" disabled={busy} onClick={decline}>Decline</button>
                </p>
              </>
            )}
          </>
        )}
        <p className="small"><BackLink fallback="/">← Back</BackLink></p>
      </div>
    </main>
  );
}
