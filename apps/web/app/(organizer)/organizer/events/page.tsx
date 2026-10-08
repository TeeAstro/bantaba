'use client';

import Link from 'next/link';
import { useMemo, useState } from 'react';
import { useApi } from '@/lib/hooks';
import { EventSummary } from '@/lib/types';
import { dayParts } from '@/lib/format';
import { eventColour } from '@/lib/store';
import { Icon } from '@/components/Icon';
import { ErrorNotice, Loading, StatusBadge } from '@/components/ui';

// Phase 27 (docs/host-rework.md): search, filters with counts, grouped by
// week, sales on every row, and drafts say what's missing.

type Filter = 'upcoming' | 'drafts' | 'review' | 'past' | 'cancelled';
type Row = EventSummary & { sessions: number };

const isDraft = (e: EventSummary) => e.status === 'DRAFT';
const isReview = (e: EventSummary) => e.status === 'PENDING_APPROVAL' || !!e.changesInReview;
const ended = (e: EventSummary, now: number) => new Date(e.endDate).getTime() < now;

function bucket(e: EventSummary, f: Filter, now: number) {
  if (f === 'cancelled') return e.status === 'CANCELLED';
  if (e.status === 'CANCELLED') return false;
  if (f === 'drafts') return isDraft(e);
  if (f === 'review') return isReview(e);
  if (f === 'past') return ended(e, now);
  return !ended(e, now);
}

/** One row per repeating event (its next session, or latest past one). */
function oneRowPerSeries(list: EventSummary[], past: boolean): Row[] {
  const sorted = [...list].sort((a, b) => (past ? -1 : 1) * (new Date(a.startDate).getTime() - new Date(b.startDate).getTime()));
  const count = new Map<string, number>();
  for (const e of sorted) if (e.seriesId) count.set(e.seriesId, (count.get(e.seriesId) ?? 0) + 1);
  const seen = new Set<string>();
  return sorted
    .filter((e) => !e.seriesId || (!seen.has(e.seriesId) && !!seen.add(e.seriesId)))
    .map((e) => ({ ...e, sessions: e.seriesId ? count.get(e.seriesId) ?? 1 : 0 }));
}

function groupLabel(iso: string, now: Date, past: boolean) {
  if (past) {
    const d = new Date(iso);
    return d.toLocaleDateString('en-GB', { month: 'long', year: 'numeric' });
  }
  const day = (x: Date) => Date.UTC(x.getFullYear(), x.getMonth(), x.getDate());
  const diff = Math.floor((day(new Date(iso)) - day(now)) / 864e5);
  if (diff < 7) return 'This week';
  if (diff < 14) return 'Next week';
  return 'Later';
}

/** What a draft still needs before it can go on sale. */
function missing(e: EventSummary) {
  if (e.entryMode !== 'OPEN' && !e.ticketTypes) return 'Add tickets';
  return 'Ready to publish';
}

export default function EventsPage() {
  const { data, error, loading, reload } = useApi<EventSummary[]>('/events/mine');
  const [filter, setFilter] = useState<Filter>('upcoming');
  const [term, setTerm] = useState('');

  const now = Date.now();
  const counts = useMemo(() => {
    const c: Record<Filter, number> = { upcoming: 0, drafts: 0, review: 0, past: 0, cancelled: 0 };
    if (!data) return c;
    for (const f of Object.keys(c) as Filter[]) c[f] = oneRowPerSeries(data.filter((e) => bucket(e, f, now)), f === 'past').length;
    return c;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [data]);

  const groups = useMemo(() => {
    if (!data) return [];
    const t = term.trim().toLowerCase();
    const rows = oneRowPerSeries(
      data.filter((e) => bucket(e, filter, now) && (!t || `${e.name} ${e.venue.name} ${e.category.name}`.toLowerCase().includes(t))),
      filter === 'past',
    );
    const out: { label: string; rows: Row[] }[] = [];
    const today = new Date();
    for (const r of rows) {
      const label = filter === 'drafts' || filter === 'review' || filter === 'cancelled' ? '' : groupLabel(r.startDate, today, filter === 'past');
      const last = out[out.length - 1];
      if (last && last.label === label) last.rows.push(r);
      else out.push({ label, rows: [r] });
    }
    return out;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [data, filter, term]);

  const chips: [Filter, string][] = [['upcoming', 'Upcoming'], ['drafts', 'Drafts'], ['review', 'In review'], ['past', 'Past'], ['cancelled', 'Cancelled']];

  return (
    <div className="hl">
      <div className="hl-head">
        <h1>Events</h1>
        <label className="hl-search">
          <Icon name="search" size={16} />
          <input type="search" placeholder="Search your events" value={term} onChange={(e) => setTerm(e.target.value)} aria-label="Search your events" />
        </label>
        <Link className="btn" href="/organizer/events/new">+ Create event</Link>
      </div>

      <div className="hl-chips" role="group" aria-label="Show">
        {chips
          .filter(([f]) => f === 'upcoming' || f === 'past' || counts[f] > 0 || filter === f)
          .map(([f, text]) => (
            <button key={f} type="button" className="hl-chip" aria-pressed={filter === f} onClick={() => setFilter(f)}>
              {text} <span>{counts[f]}</span>
            </button>
          ))}
      </div>

      {error && <ErrorNotice message={error} onRetry={reload} />}
      {loading && !data && <Loading />}
      {data && (
        <section className="panel hl-list">
          {groups.length === 0 ? (
            <div className="empty">
              <p>{term ? 'No events match that.' : filter === 'past' ? 'No past events yet.' : filter === 'upcoming' ? 'No upcoming events.' : 'Nothing here.'}</p>
              {filter === 'upcoming' && !term && <Link className="btn" href="/organizer/events/new">Create event</Link>}
            </div>
          ) : (
            groups.map((g) => (
              <div key={g.label || 'all'}>
                {g.label && <div className="hl-group">{g.label} <span>· {g.rows.length}</span></div>}
                {g.rows.map((e) => <EventRow key={e.id} e={e} past={filter === 'past'} />)}
              </div>
            ))
          )}
        </section>
      )}
    </div>
  );
}

function EventRow({ e, past }: { e: Row; past: boolean }) {
  const d = dayParts(e.startDate);
  const open = e.entryMode === 'OPEN';
  const sub = [e.series ? `${e.series.label} · ${e.sessions} ${e.sessions === 1 ? 'date' : 'dates'}` : d.time, e.venue.name].join(' · ');
  const share = e.capacity ? Math.min(1, (e.sold ?? 0) / e.capacity) : 0;
  return (
    <Link href={`/organizer/events/${e.id}`} className={`hl-row${isDraft(e) ? ' is-draft' : ''}`}>
      <span className="hl-date"><small>{d.month.toUpperCase()}</small><b>{d.day}</b><small>{d.weekday.toUpperCase()}</small></span>
      <span className="hl-thumb" style={{ background: eventColour(e.id) }}>
        {e.posterUrl ? <img src={e.posterUrl} alt="" /> : e.name.trim()[0]?.toUpperCase()}
      </span>
      <span className="hl-name">
        <b>{e.name}</b>
        <span>{sub}</span>
      </span>
      <span className="hl-sold">
        {isDraft(e) ? (
          <span className="hl-todo">{missing(e)} →</span>
        ) : open ? (
          <span>{e.going ?? 0} going</span>
        ) : e.capacity ? (
          <>
            <span><b>{(e.sold ?? 0).toLocaleString()}</b> / {e.capacity.toLocaleString()}{past ? ' sold' : ''}</span>
            <span className="hl-bar"><span style={{ width: `${Math.round(share * 100)}%` }} /></span>
          </>
        ) : (
          <span className="faint">No tickets</span>
        )}
      </span>
      <span className="hl-status">
        <StatusBadge status={e.status === 'PUBLISHED' && !past ? 'PUBLISHED' : e.status} />
        {e.changesInReview && <span className="cell-sub">changes in review</span>}
      </span>
    </Link>
  );
}
