'use client';

import Link from 'next/link';
import { Logo } from '@/components/Logo';
import { FormEvent, useEffect, useState } from 'react';
import { api, ApiError } from '@/lib/api';

// Opened from the reset email. The token is in the #fragment (never sent
// to any server, so it stays out of logs); it's read here and removed
// from the address bar straight away.
export default function ResetPasswordPage() {
  const [token, setToken] = useState<string | null>(null);
  const [checked, setChecked] = useState(false);
  const [password, setPassword] = useState('');
  const [confirm, setConfirm] = useState('');
  const [done, setDone] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    const t = new URLSearchParams(window.location.hash.slice(1)).get('token');
    setToken(t);
    setChecked(true);
    if (t) window.history.replaceState(null, '', window.location.pathname);
  }, []);

  async function onSubmit(e: FormEvent) {
    e.preventDefault();
    setError(null);
    if (password.length < 12) return setError('Use at least 12 characters.');
    if (password !== confirm) return setError('The two passwords don’t match.');
    setBusy(true);
    try {
      await api('/auth/reset-password', { method: 'POST', body: { token, newPassword: password }, auth: false });
      setDone(true);
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Could not reset the password');
    } finally {
      setBusy(false);
    }
  }

  return (
    <main className="login-page">
      <form className="login-card form" onSubmit={onSubmit} aria-labelledby="rp-title">
        <Logo onDark={false} />
        <div>
          <h1 id="rp-title">Choose a new password</h1>
        </div>
        {done ? (
          <>
            <div className="notice notice-ok" role="status">Your password has been changed, and you’ve been signed out everywhere else. Sign in with the new password.</div>
            <Link className="btn" href="/login">Sign in</Link>
          </>
        ) : checked && !token ? (
          <>
            <div className="notice notice-error" role="alert">This link is incomplete. Open the link from the email again, or ask for a new one.</div>
            <Link className="btn btn-quiet" href="/forgot-password">Get a new link</Link>
          </>
        ) : (
          <>
            {error && (
              <div className="notice notice-error" role="alert">
                {error} {/invalid or expired/i.test(error) && <Link href="/forgot-password">Get a new link</Link>}
              </div>
            )}
            <div className="field">
              <label htmlFor="password">New password</label>
              <input id="password" type="password" autoComplete="new-password" minLength={12} required value={password} onChange={(e) => setPassword(e.target.value)} />
              <span className="hint">At least 12 characters.</span>
            </div>
            <div className="field">
              <label htmlFor="confirm">Repeat it</label>
              <input id="confirm" type="password" autoComplete="new-password" required value={confirm} onChange={(e) => setConfirm(e.target.value)} />
            </div>
            <button className="btn" type="submit" disabled={busy || !token}>{busy ? 'Saving…' : 'Save new password'}</button>
          </>
        )}
      </form>
    </main>
  );
}
