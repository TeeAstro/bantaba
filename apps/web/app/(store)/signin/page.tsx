'use client';

import Link from 'next/link';
import { useRouter, useSearchParams } from 'next/navigation';
import { Suspense, useEffect, useState } from 'react';
import { ApiError, login, requestCode, signInWithCode } from '@/lib/api';
import { StoreFooter, StoreHeader } from '@/components/store/Chrome';

// Buyers sign in with a 6-digit code sent to their email (Phase 16). No
// password needed; signing in with a code also makes a new account.
// Organizers, staff and admins use /login.

// Only a path on this site, never a full URL.
const safeNext = (n: string | null) => (n && n.startsWith('/') && !n.startsWith('//') ? n : '/tickets');

function SignInInner() {
  const params = useSearchParams();
  const router = useRouter();
  const next = safeNext(params.get('next'));
  const [step, setStep] = useState<'email' | 'code' | 'password'>('email');
  const [email, setEmail] = useState('');
  const [code, setCode] = useState('');
  const [password, setPassword] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [wait, setWait] = useState(0);

  useEffect(() => {
    try {
      const b = JSON.parse(window.localStorage.getItem('bantaba.buyer') ?? '{}');
      if (b.email) setEmail(b.email);
    } catch {
      // nothing saved
    }
  }, []);
  useEffect(() => {
    if (wait <= 0) return;
    const t = setTimeout(() => setWait(wait - 1), 1000);
    return () => clearTimeout(t);
  }, [wait]);

  async function send(e?: React.FormEvent) {
    e?.preventDefault();
    setBusy(true);
    setError(null);
    try {
      await requestCode(email.trim());
      setStep('code');
      setCode('');
      setWait(60);
    } catch (err) {
      setError((err as ApiError).message);
    } finally {
      setBusy(false);
    }
  }

  async function verify(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError(null);
    try {
      await signInWithCode(email.trim(), code.replace(/\D/g, ''));
      router.replace(next);
    } catch (err) {
      setError((err as ApiError).message);
      setBusy(false);
    }
  }

  async function withPassword(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError(null);
    try {
      const user = await login(email.trim(), password);
      router.replace(user.role === 'CUSTOMER' ? next : user.role === 'ADMIN' ? '/admin' : user.role === 'STAFF' ? '/scan' : '/organizer');
    } catch (err) {
      setError((err as ApiError).message);
      setBusy(false);
    }
  }

  return (
    <>
      <StoreHeader back="/" />
      <main className="s-main s-wrap s-narrow s-auth">
        <h1>{step === 'code' ? 'Check your email' : 'Sign in'}</h1>
        {error && <div className="s-notice s-notice-bad" role="alert">{error}</div>}

        {step === 'email' && (
          <form className="s-form" onSubmit={send}>
            <label className="s-field">Email
              <input required type="email" autoComplete="email" value={email} onChange={(e) => setEmail(e.target.value)} autoFocus />
            </label>
            <button className="s-btn s-btn-block" disabled={busy}>{busy ? 'Sending…' : 'Email me a code'}</button>
            <button type="button" className="s-link-btn" onClick={() => setStep('password')}>Use a password instead</button>
          </form>
        )}

        {step === 'code' && (
          <form className="s-form" onSubmit={verify}>
            <p className="s-note">We sent a 6-digit code to <strong>{email}</strong>.</p>
            <label className="s-field s-code">Code
              <input required inputMode="numeric" autoComplete="one-time-code" pattern="\s*\d{6}\s*" maxLength={8} value={code} onChange={(e) => setCode(e.target.value)} autoFocus />
            </label>
            <button className="s-btn s-btn-block" disabled={busy}>{busy ? 'Signing in…' : 'Sign in'}</button>
            <div className="s-row" style={{ justifyContent: 'space-between' }}>
              <button type="button" className="s-link-btn" onClick={() => setStep('email')}>Change email</button>
              <button type="button" className="s-link-btn" disabled={wait > 0 || busy} onClick={() => send()}>{wait > 0 ? `Send again in ${wait}s` : 'Send again'}</button>
            </div>
          </form>
        )}

        {step === 'password' && (
          <form className="s-form" onSubmit={withPassword}>
            <label className="s-field">Email
              <input required type="email" autoComplete="email" value={email} onChange={(e) => setEmail(e.target.value)} />
            </label>
            <label className="s-field">Password
              <input required type="password" autoComplete="current-password" value={password} onChange={(e) => setPassword(e.target.value)} autoFocus />
            </label>
            <button className="s-btn s-btn-block" disabled={busy}>{busy ? 'Signing in…' : 'Sign in'}</button>
            <div className="s-row" style={{ justifyContent: 'space-between' }}>
              <button type="button" className="s-link-btn" onClick={() => setStep('email')}>Email me a code instead</button>
              <Link href="/forgot-password" style={{ fontSize: 14, fontWeight: 600 }}>Forgot password?</Link>
            </div>
          </form>
        )}
      </main>
      <StoreFooter />
    </>
  );
}

export default function SignInPage() {
  return (
    <Suspense fallback={null}>
      <SignInInner />
    </Suspense>
  );
}
