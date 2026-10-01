'use client';

import { FormEvent, Suspense, useState } from 'react';
import Link from 'next/link';
import { useRouter, useSearchParams } from 'next/navigation';
import { ApiError, login } from '@/lib/api';

function LoginForm() {
  const router = useRouter();
  const params = useSearchParams();
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  async function onSubmit(e: FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError(null);
    try {
      const user = await login(email, password);
      // Only follow known same-site paths from ?next=, never a full URL.
      const next = params.get('next') ?? '';
      if (user.role === 'ORGANIZER') {
        router.replace(next.startsWith('/organizer') || next.startsWith('/scan') ? next : '/organizer');
      } else if (user.role === 'STAFF') {
        router.replace(next.startsWith('/scan') ? next : '/scan');
      } else {
        setError('This sign-in is for event organizers and their staff. Customer accounts will use the storefront, coming in a later phase.');
      }
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Sign-in failed');
    } finally {
      setBusy(false);
    }
  }

  return (
    <main className="login-page">
      <form className="login-card form" onSubmit={onSubmit} aria-labelledby="login-title">
        <div>
          <h1 id="login-title">Sign in</h1>
          <p className="muted">For event organizers and gate staff.</p>
        </div>
        {error && <div className="notice notice-error" role="alert">{error}</div>}
        <div className="field">
          <label htmlFor="email">Email</label>
          <input id="email" type="email" autoComplete="email" required value={email} onChange={(e) => setEmail(e.target.value)} />
        </div>
        <div className="field">
          <label htmlFor="password">Password</label>
          <input id="password" type="password" autoComplete="current-password" required value={password} onChange={(e) => setPassword(e.target.value)} />
        </div>
        <button className="btn" type="submit" disabled={busy}>{busy ? 'Signing in…' : 'Sign in'}</button>
        <p className="small"><Link href="/forgot-password">Forgot your password?</Link></p>
      </form>
    </main>
  );
}

export default function LoginPage() {
  return (
    <Suspense>
      <LoginForm />
    </Suspense>
  );
}
