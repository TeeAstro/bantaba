'use client';

import Link from 'next/link';
import { useEffect, useState } from 'react';
import { Logo } from '@/components/Logo';

type HealthResponse = { status: string; database: string };

export default function HomePage() {
  const [health, setHealth] = useState<HealthResponse | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    const apiUrl = process.env.NEXT_PUBLIC_API_URL ?? 'http://localhost:4000';
    fetch(`${apiUrl}/api/v1/health`)
      .then((res) => res.json())
      .then(setHealth)
      .catch(() => setError('Can’t reach the backend. Is it running?'));
  }, []);

  return (
    <main className="main stack" style={{ maxWidth: 640, margin: '64px auto' }}>
      <Logo onDark={false} size={30} />
      <h1>Organizer, staff and admin sign-in</h1>
      <p className="muted">The customer storefront arrives in a later phase. Organizers, gate staff and admins can sign in now.</p>
      <p>
        <Link className="btn" href="/login">Sign in</Link>
      </p>
      <p className="small">
        Backend:{' '}
        {error && <span style={{ color: 'var(--red)' }}>{error}</span>}
        {!error && !health && <span className="muted">checking…</span>}
        {health && <span style={{ color: 'var(--green)' }}>{health.status} (database {health.database})</span>}
      </p>
    </main>
  );
}
