'use client';

import { useEffect, useState } from 'react';

type HealthResponse = {
  status: string;
  database: string;
  timestamp: string;
};

export default function HomePage() {
  const [health, setHealth] = useState<HealthResponse | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    const apiUrl = process.env.NEXT_PUBLIC_API_URL ?? 'http://localhost:4000';
    fetch(`${apiUrl}/api/health`)
      .then((res) => res.json())
      .then(setHealth)
      .catch(() => setError('Could not reach the backend. Is it running?'));
  }, []);

  return (
    <main style={{ maxWidth: 640, margin: '80px auto', padding: '0 24px' }}>
      <h1>Event Ticketing Platform</h1>
      <p>Phase 1 — Project Foundation.</p>

      <div
        style={{
          marginTop: 24,
          padding: 16,
          borderRadius: 8,
          border: '1px solid #ddd',
        }}
      >
        <strong>Backend status:</strong>{' '}
        {error && <span style={{ color: '#c0392b' }}>{error}</span>}
        {!error && !health && <span>Checking...</span>}
        {health && (
          <span style={{ color: '#2e7d32' }}>
            {health.status} (database: {health.database})
          </span>
        )}
      </div>
    </main>
  );
}
