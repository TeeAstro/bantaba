'use client';

import Link from 'next/link';
import { Suspense, useState } from 'react';
import { useParams, useSearchParams } from 'next/navigation';
import { api, ApiError } from '@/lib/api';
import { useApi } from '@/lib/hooks';
import { EventDashboard, EventRecord, SeatMap } from '@/lib/types';
import { PendingChanges } from '@/components/event/PendingChanges';
import { dateTime, dayParts } from '@/lib/format';
import { ErrorNotice, Loading, StatusBadge } from '@/components/ui';
import { SeatMapView } from '@/components/SeatMapView';
import { OverviewTab } from '@/components/event/OverviewTab';
import { TicketsTab } from '@/components/event/TicketsTab';
import { OrdersTab } from '@/components/event/OrdersTab';
import { AttendeesTab } from '@/components/event/AttendeesTab';
import { CheckInsTab } from '@/components/event/CheckInsTab';
import { StaffTab } from '@/components/event/StaffTab';
import { RefundsTab } from '@/components/event/RefundsTab';

function SeatsTab({ eventId }: { eventId: string }) {
  const { data, error, reload } = useApi<SeatMap>(`/events/${eventId}/seat-map`);
  if (error) return <ErrorNotice message={error} onRetry={reload} />;
  if (!data) return <Loading />;
  return <SeatMapView map={data} />;
}

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
  const hasSeating = data.ticketTypes.some((t) => t.section);

  const tabs = [
    { key: 'overview', label: 'Overview' },
    { key: 'tickets', label: 'Ticket types' },
    ...(hasSeating ? [{ key: 'seats', label: 'Seats' }] : []),
    { key: 'orders', label: 'Orders' },
    { key: 'attendees', label: 'Attendees' },
    { key: 'refunds', label: data.refunds.requests > 0 ? `Refunds (${data.refunds.requests})` : 'Refunds' },
    { key: 'checkins', label: 'Check-ins' },
    { key: 'staff', label: 'Staff' },
  ];

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
      <p className="small" style={{ marginBottom: 12 }}>
        <Link href="/organizer/events">Events</Link>
      </p>

      {/* Overview only, so the other tabs keep their data near the top */}
      {event.bannerUrl && tab === 'overview' && (
        // eslint-disable-next-line @next/next/no-img-element
        <img className="event-banner" src={event.bannerUrl} alt="" />
      )}

      <header className="stub">
        <div className="stub-body">
          <StatusBadge status={event.status} />
          <h1>{event.name}</h1>
          <div className="stub-meta">
            <span>{event.venue.name}</span>
            <span>{event.category}</span>
            <span>Ends {dateTime(event.endDate)}</span>
          </div>
          {actionError && <div className="notice notice-error" role="alert" style={{ marginTop: 14 }}>{actionError}</div>}
          {/* docs/organizer-trust.md */}
          {event.status === 'PENDING_APPROVAL' && (
            <div className="notice notice-info" style={{ marginTop: 14 }}>
              Waiting for review{event.submittedForReviewAt ? ` since ${dateTime(event.submittedForReviewAt)}` : ''}. It goes on sale as soon as the platform team approves it; you’ll get an email. You can keep editing meanwhile.
            </div>
          )}
          {event.status === 'DRAFT' && event.reviewNote && (
            <div className="notice notice-warn" style={{ marginTop: 14 }}>
              <b>Changes requested:</b> {event.reviewNote} Make the changes, then submit it again.
            </div>
          )}
          {record.data && (
            <div style={{ marginTop: 14 }}><PendingChanges event={record.data} onWithdrawn={record.reload} /></div>
          )}
          {!data.permissions.canSell && (
            <div className="notice notice-error" style={{ marginTop: 14 }}>Ticket sales are paused: your account is suspended.</div>
          )}
          <div className="stub-actions row">
            {event.status === 'DRAFT' && (
              <button className="btn" disabled={busy || data.ticketTypes.length === 0} onClick={() => act('publish')} title={data.ticketTypes.length === 0 ? 'Add a ticket type first' : undefined}>
                {data.permissions.requireEventReview ? 'Submit for review' : 'Publish'}
              </button>
            )}
            {event.status === 'DRAFT' && data.ticketTypes.length === 0 && (
              <span className="small muted">Add a ticket type before publishing.</span>
            )}
            {editable && (
              <Link className="btn btn-quiet" href={`/organizer/events/${event.id}/edit`}>Edit event</Link>
            )}
            {editable && event.status !== 'DRAFT' && (
              <button className="btn btn-danger" disabled={busy} onClick={() => setCancelOpen(true)}>Cancel event</button>
            )}
          </div>
        </div>
        <div className="stub-tear" aria-label={`Starts ${d.weekday} ${d.day} ${d.month} at ${d.time}`}>
          <div className="stub-day">{d.day}</div>
          <div className="stub-month">{d.month} {new Date(event.startDate).getUTCFullYear()}</div>
          <div className="stub-time">{d.weekday} {d.time}</div>
        </div>
      </header>

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

      <nav className="tabs" aria-label="Event sections">
        {tabs.map((t) => (
          <Link key={t.key} href={`/organizer/events/${event.id}?tab=${t.key}`} aria-current={tab === t.key ? 'page' : undefined} scroll={false}>
            {t.label}
          </Link>
        ))}
      </nav>

      {tab === 'overview' && <OverviewTab d={data} />}
      {tab === 'tickets' && <TicketsTab d={data} onChange={reload} />}
      {tab === 'seats' && <SeatsTab eventId={event.id} />}
      {tab === 'orders' && <OrdersTab eventId={event.id} />}
      {tab === 'attendees' && <AttendeesTab eventId={event.id} onChange={reload} />}
      {tab === 'refunds' && <RefundsTab d={data} onChange={reload} />}
      {tab === 'checkins' && <CheckInsTab eventId={event.id} />}
      {tab === 'staff' && <StaffTab eventId={event.id} venueId={event.venue.id} editable={editable} />}
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
