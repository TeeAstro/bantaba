'use client';

import Link from 'next/link';
import { Suspense, useState } from 'react';
import { useParams, useSearchParams } from 'next/navigation';
import { api, ApiError } from '@/lib/api';
import { useApi } from '@/lib/hooks';
import { EventDashboard, EventRecord } from '@/lib/types';
import { PendingChanges } from '@/components/event/PendingChanges';
import { Icon, IconName } from '@/components/Icon';
import { dateTime, dayParts } from '@/lib/format';
import { ErrorNotice, Loading, StatusBadge } from '@/components/ui';
import { OverviewTab } from '@/components/event/OverviewTab';
import { TicketsTab } from '@/components/event/TicketsTab';
import { OrdersTab } from '@/components/event/OrdersTab';
import { AttendeesTab } from '@/components/event/AttendeesTab';
import { CheckInsTab } from '@/components/event/CheckInsTab';
import { StaffTab } from '@/components/event/StaffTab';
import { RefundsTab } from '@/components/event/RefundsTab';
import { SeatingTab } from '@/components/event/SeatingTab';

function EventDetail() {
  const { id } = useParams<{ id: string }>();
  const params = useSearchParams();
  const tab = params.get('tab') ?? 'overview';
  const { data, error, loading, reload } = useApi<EventDashboard>(`/events/${id}/dashboard`);
  // Changes waiting for review (docs/event-change-review.md)
  const record = useApi<EventRecord>(`/events/${id}`);
  const [actionError, setActionError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [cancelOpen, setCancelOpen] = useState(false);
  const [refundMode, setRefundMode] = useState<'AUTOMATIC' | 'ORGANIZER'>('AUTOMATIC');

  if (error) return <ErrorNotice message={error} onRetry={reload} />;
  if (loading && !data) return <Loading />;
  if (!data) return null;

  const { event } = data;
  const d = dayParts(event.startDate);
  const editable = event.status !== 'CANCELLED' && event.status !== 'COMPLETED';

  // Five groups instead of eight tabs (Phase 15). Each sub-page keeps its
  // own ?tab= key, so links like ?tab=refunds still work.
  const groups: { key: string; label: string; icon: IconName; badge?: number; subs: { key: string; label: string; badge?: number }[] }[] = [
    { key: 'overview', label: 'Overview', icon: 'dashboard', subs: [{ key: 'overview', label: 'Overview' }] },
    { key: 'tickets', label: 'Tickets', icon: 'tickets', subs: [{ key: 'tickets', label: 'Ticket types' }, { key: 'seating', label: 'Seating' }] },
    {
      key: 'sales', label: 'Sales', icon: 'orders', badge: data.refunds.requests,
      subs: [{ key: 'orders', label: 'Orders' }, { key: 'refunds', label: 'Refunds', badge: data.refunds.requests }],
    },
    { key: 'people', label: 'People', icon: 'attendees', subs: [{ key: 'attendees', label: 'Attendees' }, { key: 'staff', label: 'Gate staff' }] },
    {
      key: 'gate', label: 'At the gate', icon: 'checkins',
      subs: [{ key: 'checkins', label: 'Check-ins' }],
    },
  ];
  const group = groups.find((g) => g.subs.some((x) => x.key === tab)) ?? groups[0];
  const href = (key: string) => `/organizer/events/${event.id}?tab=${key}`;
  const share = data.summary.capacity ? data.summary.ticketsSold / data.summary.capacity : 0;
  const started = new Date(event.startDate).getTime() <= Date.now();
  const daysTo = Math.ceil((new Date(event.startDate).getTime() - Date.now()) / 86_400_000);
  const when = `${d.weekday} ${d.day} ${d.month}, ${d.time} – ${dayParts(event.endDate).time}`;

  async function act(path: 'publish' | 'cancel') {
    setBusy(true);
    setActionError(null);
    try {
      await api(`/events/${event.id}/${path}`, { method: 'POST', ...(path === 'cancel' ? { body: { refundMode } } : {}) });
      setCancelOpen(false);
      reload();
    } catch (err) {
      setActionError(err instanceof ApiError ? err.message : `Could not ${path} the event`);
    } finally {
      setBusy(false);
    }
  }

  return (
    <div>
      <p className="small crumbs">
        <Link href="/organizer/events">Events</Link> <span className="faint">/</span> <span className="muted">{event.name}</span>
      </p>

      <header className="ev-head">
        <div className="ev-poster">
          {/* eslint-disable-next-line @next/next/no-img-element */}
          {event.posterUrl ? <img src={event.posterUrl} alt="" /> : <span>{event.name.slice(0, 1)}</span>}
        </div>
        <div className="ev-title">
          <div className="row ev-chips">
            <StatusBadge status={event.status} />
            {(event.status === 'PUBLISHED') && share >= 0.8 && share < 1 && <span className="badge badge-gold">Almost sold out</span>}
          </div>
          <h1>{event.name}</h1>
          <p className="ev-meta">
            <span>{when}</span>
            <span>{event.venue.name}</span>
            <span>{event.category}</span>
            {!started && editable && daysTo <= 14 && <span className="ev-soon">{daysTo <= 1 ? (daysTo === 1 ? 'tomorrow' : 'today') : `in ${daysTo} days`}</span>}
            {started && new Date(event.endDate).getTime() > Date.now() && event.status !== 'CANCELLED' && <span className="ev-soon">on now</span>}
          </p>
        </div>
        <div className="ev-actions">
          {event.status === 'DRAFT' && (
            <button className="btn" disabled={busy || data.ticketTypes.length === 0} onClick={() => act('publish')} title={data.ticketTypes.length === 0 ? 'Add a ticket type first' : undefined}>
              {data.permissions.requireEventReview ? 'Submit for review' : 'Publish'}
            </button>
          )}
          {editable && (
            <Link className={`btn ${event.status === 'DRAFT' ? 'btn-quiet' : ''}`} href={`/organizer/events/${event.id}/edit`}>Edit event</Link>
          )}
          {editable && event.status !== 'DRAFT' && (
            <details className="menu">
              <summary className="btn btn-quiet" aria-label="More actions"><Icon name="more" /></summary>
              <div className="menu-pop" role="menu">
                {(event.status === 'PUBLISHED' || event.status === 'SOLD_OUT') && (
                  <a role="menuitem" href={`/e/${event.slug}`} target="_blank" rel="noopener noreferrer">View public page</a>
                )}
                <Link role="menuitem" href={`/scan/${event.id}`}>Open the scanner</Link>
                <button role="menuitem" className="menu-danger" disabled={busy} onClick={(e) => { (e.currentTarget.closest('details') as HTMLDetailsElement).open = false; setCancelOpen(true); }}>Cancel event…</button>
              </div>
            </details>
          )}
        </div>
      </header>

      <div className="ev-notices">
        {event.status === 'DRAFT' && data.ticketTypes.length === 0 && (
          <div className="notice notice-info">Add a ticket type before publishing: <Link href={href('tickets')}>Ticket types</Link>.</div>
        )}
        {actionError && <div className="notice notice-error" role="alert">{actionError}</div>}
        {/* docs/organizer-trust.md */}
        {event.status === 'PENDING_APPROVAL' && (
          <div className="notice notice-info">
            Waiting for review{event.submittedForReviewAt ? ` since ${dateTime(event.submittedForReviewAt)}` : ''}. It goes on sale as soon as the platform team approves it; you’ll get an email. You can keep editing meanwhile.
          </div>
        )}
        {event.status === 'DRAFT' && event.reviewNote && (
          <div className="notice notice-warn">
            <b>Changes requested:</b> {event.reviewNote} Make the changes, then submit it again.
          </div>
        )}
        {record.data && <PendingChanges event={record.data} onWithdrawn={record.reload} />}
        {!data.permissions.canSell && (
          <div className="notice notice-error">Ticket sales are paused: your account is suspended.</div>
        )}
      </div>

      {cancelOpen && (
        <div className="modal-backdrop" role="presentation" onClick={(e) => e.target === e.currentTarget && !busy && setCancelOpen(false)}>
          <div className="modal" role="dialog" aria-modal="true" aria-labelledby="cancel-title">
            <h2 id="cancel-title">Cancel {event.name}?</h2>
            <p className="muted">Ticket sales stop and every ticket holder is emailed. This can’t be undone here.</p>
            <fieldset className="choice-list" style={{ border: 0, padding: 0, margin: 0 }}>
              <legend className="small" style={{ fontWeight: 600, marginBottom: 8 }}>What happens to the money?</legend>
              <label className={`choice ${refundMode === 'AUTOMATIC' ? 'is-on' : ''}`}>
                <input type="radio" name="refundMode" checked={refundMode === 'AUTOMATIC'} onChange={() => setRefundMode('AUTOMATIC')} />
                <span><b>Refund everyone automatically</b><span className="small muted">Every ticket holder gets their money back in full, booking fee included. Wave payments are returned automatically; bank transfers are paid back by the platform. ({data.summary.ticketsSold} ticket{data.summary.ticketsSold === 1 ? '' : 's'} sold)</span></span>
              </label>
              {data.permissions.canHandleCancellationRefunds ? (
              <label className={`choice ${refundMode === 'ORGANIZER' ? 'is-on' : ''}`}>
                <input type="radio" name="refundMode" checked={refundMode === 'ORGANIZER'} onChange={() => setRefundMode('ORGANIZER')} />
                <span><b>I’ll handle refunds myself</b><span className="small muted">For example if you’re moving the event to a new date or offering credit. Tickets stop working, and ticket holders can ask for a full refund at any time; you decide in the Refunds tab.</span></span>
              </label>
              ) : (
                <p className="small muted">Handling refunds yourself isn’t available for new organizer accounts.</p>
              )}
            </fieldset>
            {actionError && <div className="notice notice-error" role="alert">{actionError}</div>}
            <div className="row" style={{ justifyContent: 'flex-end' }}>
              <button className="btn btn-quiet" disabled={busy} onClick={() => setCancelOpen(false)}>Keep the event</button>
              <button className="btn btn-danger" disabled={busy} onClick={() => act('cancel')}>{busy ? 'Cancelling…' : 'Cancel event'}</button>
            </div>
          </div>
        </div>
      )}

      <nav className="tabs ev-tabs" aria-label="Event sections">
        {groups.map((g) => (
          <Link key={g.key} href={href(g.subs[0].key)} aria-current={group.key === g.key ? 'page' : undefined} scroll={false}>
            <Icon name={g.icon} size={16} />
            {g.label}
            {!!g.badge && <span className="tab-count" aria-label={`${g.badge} waiting`}>{g.badge}</span>}
          </Link>
        ))}
      </nav>
      {group.subs.length > 1 && (
        <nav className="subtabs" aria-label={`${group.label} sections`}>
          {group.subs.map((x) => (
            <Link key={x.key} href={href(x.key)} aria-current={tab === x.key ? 'page' : undefined} scroll={false}>
              {x.label}
              {!!x.badge && <span className="tab-count">{x.badge}</span>}
            </Link>
          ))}
        </nav>
      )}

      <div className="ev-body">
      {tab === 'overview' && <OverviewTab d={data} />}
      {tab === 'tickets' && <TicketsTab d={data} onChange={reload} />}
      {(tab === 'seating' || tab === 'seats') && <SeatingTab eventId={event.id} onChange={reload} />}
      {tab === 'orders' && <OrdersTab eventId={event.id} />}
      {tab === 'attendees' && <AttendeesTab eventId={event.id} onChange={reload} />}
      {tab === 'refunds' && <RefundsTab d={data} onChange={reload} />}
      {tab === 'checkins' && <CheckInsTab eventId={event.id} />}
      {tab === 'staff' && <StaffTab eventId={event.id} venueId={event.venue.id} editable={editable} />}
      </div>
    </div>
  );
}

export default function EventDetailPage() {
  return (
    <Suspense fallback={<Loading />}>
      <EventDetail />
    </Suspense>
  );
}
