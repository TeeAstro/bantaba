'use client';

import { useEffect } from 'react';
import { useApi } from '@/lib/hooks';
import { CheckInRow } from '@/lib/types';
import { dateTime } from '@/lib/format';
import { ErrorNotice, Loading, StatusBadge } from '@/components/ui';

// Every scan at the gate, newest first — successes and refusals alike.
// Refreshes every 15 s so it can sit open on event night.
export function CheckInsTab({ eventId }: { eventId: string }) {
  const { data, error, loading, reload } = useApi<CheckInRow[]>(`/events/${eventId}/check-ins`);

  useEffect(() => {
    const t = setInterval(reload, 15_000);
    return () => clearInterval(t);
  }, [reload]);

  return (
    <section className="panel">
      <div className="panel-head">
        <h2>Gate scans</h2>
        <span className="small faint">Updates every 15 seconds</span>
      </div>
      <div className="panel-pad stack">
        {error && <ErrorNotice message={error} onRetry={reload} />}
        {loading && !data && <Loading />}
        {data && (data.length === 0 ? (
          <div className="empty"><p>No scans yet. They appear here as staff check people in.</p></div>
        ) : (
          <div className="table-wrap">
            <table>
              <thead>
                <tr><th>Time</th><th>Result</th><th>Ticket holder</th><th>Ticket</th><th>Gate</th></tr>
              </thead>
              <tbody>
                {data.map((c) => (
                  <tr key={c.id}>
                    <td className="num small">{dateTime(c.scannedAt)}</td>
                    <td><StatusBadge status={c.result} /></td>
                    <td>{c.ticket.owner.fullName ?? c.ticket.owner.email}</td>
                    <td>{c.ticket.ticketType.name}</td>
                    <td>{c.gate?.name ?? <span className="faint">—</span>}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        ))}
      </div>
    </section>
  );
}
