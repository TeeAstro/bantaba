'use client';

import Link from 'next/link';
import { useMemo, useState } from 'react';
import { useApi } from '@/lib/hooks';
import { EventSummary } from '@/lib/types';
import { dayParts } from '@/lib/format';
import { ErrorNotice, Loading, StatusBadge } from '@/components/ui';

const FILTERS = [
  { key: 'upcoming', label: 'Upcoming' },
  { key: 'past', label: 'Past' },
  { key: 'all', label: 'All' },
] as const;

export default function EventsPage() {
  const { data, error, loading, reload } = useApi<EventSummary[]>('/events/mine');
  const [filter, setFilter] = useState<(typeof FILTERS)[number]['key']>('upcoming');

  const events = useMemo(() => {
    if (!data) return [];
    const now = Date.now();
    const list = data.filter((e) =>
      filter === 'all' ? true : filter === 'upcoming' ? new Date(e.endDate).getTime() >= now : new Date(e.endDate).getTime() < now,
    );
    return list.sort((a, b) =>
      filter === 'past'
        ? new Date(b.startDate).getTime() - new Date(a.startDate).getTime()
        : new Date(a.startDate).getTime() - new Date(b.startDate).getTime(),
    );
  }, [data, filter]);

  return (
    <div>
      <div className="page-head">
        <div>
          <h1>Events</h1>
          <p className="muted">Everything you’ve created, drafts included.</p>
        </div>
        <Link className="btn" href="/organizer/events/new">Create event</Link>
      </div>

      <nav className="tabs" aria-label="Filter events">
        {FILTERS.map((f) => (
          <a
            key={f.key}
            href="#"
            aria-current={filter === f.key ? 'page' : undefined}
            onClick={(e) => {
              e.preventDefault();
              setFilter(f.key);
            }}
          >
            {f.label}
          </a>
        ))}
      </nav>

      {error && <ErrorNotice message={error} onRetry={reload} />}
      {loading && <Loading />}
      {data && (
        <section className="panel">
          {events.length === 0 ? (
            <div className="empty">
              <p>{filter === 'past' ? 'No past events yet.' : 'No upcoming events.'}</p>
              {filter !== 'past' && <Link className="btn" href="/organizer/events/new">Create event</Link>}
            </div>
          ) : (
            <div className="table-wrap">
              <table>
                <thead>
                  <tr><th>Event</th><th>Starts</th><th>Venue</th><th>Status</th></tr>
                </thead>
                <tbody>
                  {events.map((e) => {
                    const d = dayParts(e.startDate);
                    return (
                      <tr key={e.id}>
                        <td>
                          <Link href={`/organizer/events/${e.id}`}>{e.name}</Link>
                          <span className="cell-sub">{e.category.name}</span>
                        </td>
                        <td className="num">{d.weekday} {d.day} {d.month}<span className="cell-sub">{d.time}</span></td>
                        <td>{e.venue.name}</td>
                        <td><StatusBadge status={e.status} /></td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          )}
        </section>
      )}
    </div>
  );
}
