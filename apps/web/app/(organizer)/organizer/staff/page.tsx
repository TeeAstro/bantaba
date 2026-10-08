'use client';

import Link from 'next/link';
import { useMemo, useState } from 'react';
import { useApi } from '@/lib/hooks';
import { dayParts, label } from '@/lib/format';
import { EventSummary } from '@/lib/types';
import { initials } from '@/lib/store';
import { Icon } from '@/components/Icon';
import { ErrorNotice, Loading } from '@/components/ui';

// Phase 27 (docs/host-rework.md): one row per person, their events as chips.
// People are added from an event's Gate tab, so "Add staff" asks which event.

interface StaffMember {
  id: string;
  email: string;
  fullName: string | null;
  eventStaffRoles: {
    id: string;
    role: string;
    event: { id: string; name: string; startDate: string; status: string };
    assignedGate: { name: string } | null;
  }[];
}

type Show = 'all' | 'soon' | 'none';

export default function StaffPage() {
  const { data, error, loading, reload } = useApi<StaffMember[]>('/organizer/staff');
  const events = useApi<EventSummary[]>('/events/mine');
  const [term, setTerm] = useState('');
  const [show, setShow] = useState<Show>('all');
  const now = Date.now();
  const upcoming = (m: StaffMember) => m.eventStaffRoles.filter((a) => new Date(a.event.startDate).getTime() >= now - 864e5 && a.event.status !== 'CANCELLED');

  const people = useMemo(() => {
    if (!data) return [];
    const t = term.trim().toLowerCase();
    return data
      .filter((m) => !t || `${m.fullName ?? ''} ${m.email}`.toLowerCase().includes(t))
      .filter((m) => (show === 'soon' ? upcoming(m).length > 0 : show === 'none' ? upcoming(m).length === 0 : true))
      .sort((a, b) => upcoming(b).length - upcoming(a).length || (a.fullName ?? a.email).localeCompare(b.fullName ?? b.email));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [data, term, show]);

  const soonEvents = (events.data ?? [])
    .filter((e) => new Date(e.endDate).getTime() >= now && e.status !== 'CANCELLED' && e.entryMode !== 'OPEN')
    .sort((a, b) => new Date(a.startDate).getTime() - new Date(b.startDate).getTime())
    .slice(0, 8);
  const count = (s: Show) => (data ?? []).filter((m) => (s === 'soon' ? upcoming(m).length > 0 : s === 'none' ? upcoming(m).length === 0 : true)).length;

  return (
    <div className="hl">
      <div className="hl-head">
        <h1>Staff</h1>
        <label className="hl-search">
          <Icon name="search" size={16} />
          <input type="search" placeholder="Name or email" value={term} onChange={(e) => setTerm(e.target.value)} aria-label="Search staff" />
        </label>
        <details className="menu">
          <summary className="btn">+ Add staff</summary>
          <div className="menu-pop" role="menu">
            <span className="menu-cap">Add to which event?</span>
            {soonEvents.length === 0 && <span className="small muted" style={{ padding: '6px 12px' }}>No upcoming events.</span>}
            {soonEvents.map((e) => {
              const d = dayParts(e.startDate);
              return <Link key={e.id} role="menuitem" href={`/organizer/events/${e.id}?tab=gate`}>{e.name} <span className="faint">· {d.day} {d.month}</span></Link>;
            })}
          </div>
        </details>
      </div>

      <div className="hl-chips" role="group" aria-label="Show">
        {([['all', 'Everyone'], ['soon', 'Working soon'], ['none', 'Nothing coming up']] as [Show, string][]).map(([k, text]) => (
          <button key={k} type="button" className="hl-chip" aria-pressed={show === k} onClick={() => setShow(k)}>{text} <span>{count(k)}</span></button>
        ))}
      </div>

      {error && <ErrorNotice message={error} onRetry={reload} />}
      {loading && !data && <Loading />}
      {data && (
        <section className="panel hl-list">
          {people.length === 0 ? (
            <div className="empty"><p>{data.length === 0 ? 'No staff yet. Add someone from an event’s Gate tab.' : 'Nobody matches.'}</p></div>
          ) : (
            people.map((m) => {
              const soon = upcoming(m);
              const shown = (soon.length ? soon : m.eventStaffRoles).slice().sort((a, b) => new Date(a.event.startDate).getTime() - new Date(b.event.startDate).getTime());
              const roles = [...new Set(m.eventStaffRoles.map((a) => label(a.role)))];
              return (
                <div key={m.id} className="st-row">
                  <span className="st-avatar">{initials(m.fullName ?? m.email)}</span>
                  <span className="hl-name">
                    <b>{m.fullName ?? m.email}</b>
                    <span>{m.fullName ? `${m.email} · ` : ''}{roles.join(', ') || 'Staff'}</span>
                  </span>
                  <span className="st-events">
                    {shown.length === 0 && <span className="faint small">Not on any event</span>}
                    {shown.slice(0, 3).map((a) => {
                      const d = dayParts(a.event.startDate);
                      return (
                        <Link key={a.id} className="st-chip" href={`/organizer/events/${a.event.id}?tab=gate`} title={a.assignedGate ? `Gate: ${a.assignedGate.name}` : undefined}>
                          {a.event.name} <span>{d.day} {d.month}</span>
                        </Link>
                      );
                    })}
                    {shown.length > 3 && <span className="st-chip st-more">+{shown.length - 3} more</span>}
                    {!soon.length && shown.length > 0 && <span className="faint small">past</span>}
                  </span>
                </div>
              );
            })
          )}
        </section>
      )}
    </div>
  );
}
