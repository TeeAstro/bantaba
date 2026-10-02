'use client';

import Link from 'next/link';
import { Logo } from '@/components/Logo';
import { FormEvent, useState } from 'react';
import { api, ApiError } from '@/lib/api';

// Asks for a password reset link by email (Phase 12). The answer is the
// same whether or not the address has an account.
export default function ForgotPasswordPage() {
  const [email, setEmail] = useState('');
  const [sent, setSent] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  async function onSubmit(e: FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError(null);
    try {
      await api('/auth/forgot-password', { method: 'POST', body: { email: email.trim() }, auth: false });
      setSent(true);
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Something went wrong');
    } finally {
      setBusy(false);
    }
  }

  return (
    <main className="login-page">
      <form className="login-card form" onSubmit={onSubmit} aria-labelledby="fp-title">
        <Logo onDark={false} />
        <div>
          <h1 id="fp-title">Reset your password</h1>
          <p className="muted">We’ll email you a link to choose a new one.</p>
        </div>
        {sent ? (
          <div className="notice notice-ok" role="status">
            If an account exists for <b>{email.trim()}</b>, a reset link is on its way. It works once and expires in an hour. Check your spam folder if it doesn’t arrive in a few minutes.
          </div>
        ) : (
          <>
            {error && <div className="notice notice-error" role="alert">{error}</div>}
            <div className="field">
              <label htmlFor="email">Email</label>
              <input id="email" type="email" autoComplete="email" required value={email} onChange={(e) => setEmail(e.target.value)} />
            </div>
            <button className="btn" type="submit" disabled={busy}>{busy ? 'Sending…' : 'Email me a reset link'}</button>
          </>
        )}
        <p className="small"><Link href="/login">Back to sign in</Link></p>
      </form>
    </main>
  );
}
