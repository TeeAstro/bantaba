'use client';

import Link from 'next/link';
import { useApi } from '@/lib/hooks';
import { ScannerEvent } from '@/lib/types';
import { dayParts, label } from '@/lib/format';
import { ErrorNotice } from '@/components/ui';

function when(startIso: string, endIso: string) {
  const now = Date.now();
  if (new Date(endIso).getTime() < now) return 'Ended';
  if (new Date(startIso).getTime() <= now) return 'On now';
  const d = dayParts(startIso);
  return `${d.weekday} ${d.day} ${d.month}, ${d.time}`;
}

export default function ScanHome() {
  const { data, error, loading, reload } = useApi<ScannerEvent[]>('/scanner/events');

  return (
    <main className="scan-wrap stack">
      <h1 style={{ fontSize: 22 }}>Choose an event</h1>
      {error && <ErrorNotice message={error} onRetry={reload} />}
      {loading && !data && <p className="muted">Loading…</p>}
      {data && data.length === 0 && (
        <p className="muted">
          You’re not assigned to any upcoming events. Ask the organizer to add you from their dashboard.
        </p>
      )}
      <div>
        {data?.map((e) => (
          <Link key={e.id} href={`/scan/${e.id}`} className="scan-card">
            <div className="spread">
              <h2>{e.name}</h2>
              <span className="small" style={{ color: when(e.startDate, e.endDate) === 'On now' ? '#7fd1c9' : '#9fb3b0' }}>
                {when(e.startDate, e.endDate)}
              </span>
            </div>
            <p className="small muted" style={{ marginTop: 4 }}>
              {e.venue.name}
              {e.role !== 'ORGANIZER' && `, ${label(e.role)}`}
              {e.assignedGate ? `, ${e.assignedGate.name}` : ''}
            </p>
          </Link>
        ))}
      </div>
    </main>
  );
}
