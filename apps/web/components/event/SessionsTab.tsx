'use client';

import Link from 'next/link';
import { useState } from 'react';
import { api, ApiError } from '@/lib/api';
import { useApi } from '@/lib/hooks';
import { dayParts } from '@/lib/format';
import { HostSession, SeriesInfo } from '@/lib/types';
import { ErrorNotice, Loading } from '@/components/ui';

// Phase 24 (docs/series.md): every date of a repeating event, with how
// full each is. Each date is its own event page.
export function SessionsTab({ eventId }: { eventId: string }) {
  const { data, error, loading, reload } = useApi<SeriesInfo & { sessions: HostSession[] }>(`/events/${eventId}/sessions`);
  const [busy, setBusy] = useState(false);
  const [stopError, setStopError] = useState<string | null>(null);
  if (error) return <ErrorNotice message={error} onRetry={reload} />;
  if (loading && !data) return <Loading />;
  if (!data) return null;

  const now = Date.now();
  const upcoming = data.sessions.filter((s) => new Date(s.endDate).getTime() >= now);
  const past = data.sessions.length - upcoming.length;
  const every = data.frequency === 'MONTHLY' ? 'month' : data.frequency === 'BIWEEKLY' ? 'two weeks' : 'week';
  const draft = data.sessions.length === 1 && ['DRAFT', 'PENDING_APPROVAL'].includes(data.sessions[0].status);
  const sub = draft
    ? 'The other dates are added when it goes live.'
    : data.stoppedAt
    ? 'Stopped: no new sessions are added.'
    : data.endMode === 'OPEN'
      ? `Next 8 on sale · a new one is added each ${every}`
      : `${data.sessions.length} sessions`;

  async function stop() {
    if (!window.confirm('Stop repeating? No new sessions are added. The sessions already on sale stay; cancel them one by one if you need to.')) return;
    setBusy(true);
    setStopError(null);
    try {
      await api(`/series/${data!.id}/stop`, { method: 'POST' });
      reload();
    } catch (err) {
      setStopError(err instanceof ApiError ? err.message : 'Could not stop the series');
    } finally {
      setBusy(false);
    }
  }

  return (
    <section className="panel">
      <div className="panel-head" style={{ display: 'flex', alignItems: 'center', gap: 12, padding: '16px 20px', flexWrap: 'wrap' }}>
        <div>
          <h2 style={{ margin: 0 }}>Sessions</h2>
          <p className="small muted" style={{ margin: '2px 0 0' }}>{data.label} · {sub}{past ? ` · ${past} past` : ''}</p>
        </div>
        {!data.stoppedAt && data.endMode === 'OPEN' && (
          <button className="btn btn-quiet" style={{ marginLeft: 'auto' }} disabled={busy} onClick={stop}>Stop repeating</button>
        )}
      </div>
      {stopError && <div className="notice notice-error" role="alert" style={{ margin: '0 20px 12px' }}>{stopError}</div>}
      <ul className="sessions-list">
        {upcoming.map((s) => {
          const d = dayParts(s.startDate);
          const cancelled = s.status === 'CANCELLED';
          const open = s.going !== null;
          const full = !open && s.capacity > 0 && s.sold >= s.capacity;
          const share = open || !s.capacity ? 0 : Math.min(1, s.sold / s.capacity);
          return (
            <li key={s.id} className={`${cancelled ? 'is-cancelled' : ''} ${s.id === eventId ? 'is-current' : ''}`}>
              <span className="s-date">{d.weekday} {d.day} {d.month}<span className="cell-sub">{d.time}–{dayParts(s.endDate).time}</span></span>
              {cancelled ? (
                <span className="badge badge-red">Cancelled</span>
              ) : open ? (
                <span className="s-sold">{s.going} going</span>
              ) : (
                <>
                  <span className="s-bar" aria-hidden="true"><span className={full ? 'full' : ''} style={{ width: `${Math.round(share * 100)}%` }} /></span>
                  <span className="s-sold">{full ? `Full · ${s.sold}/${s.capacity}` : `${s.sold} / ${s.capacity}`}</span>
                </>
              )}
              <span className="s-act">
                {s.id === eventId ? <span className="small muted">This one</span> : <Link className="btn btn-quiet btn-s" href={`/organizer/events/${s.id}`}>Open</Link>}
              </span>
            </li>
          );
        })}
      </ul>
      {upcoming.length === 0 && <p className="muted" style={{ padding: '0 20px 16px' }}>No upcoming sessions.</p>}
    </section>
  );
}
