'use client';

import Link from 'next/link';
import { Suspense, useState } from 'react';
import { useParams, useSearchParams } from 'next/navigation';
import { api, ApiError } from '@/lib/api';
import { useApi } from '@/lib/hooks';
import { EventDashboard, EventRecord } from '@/lib/types';
import { PendingChanges } from '@/components/event/PendingChanges';
import { Icon, IconName } from '@/components/Icon';
import { dateTime, dayParts, money } from '@/lib/format';
import { ErrorNotice, Loading, StatusBadge } from '@/components/ui';
import { OverviewTab } from '@/components/event/OverviewTab';
import { TicketsTab } from '@/components/event/TicketsTab';
import { OrdersTab } from '@/components/event/OrdersTab';
import { AttendeesTab } from '@/components/event/AttendeesTab';
import { CheckInsTab } from '@/components/event/CheckInsTab';
import { StaffTab } from '@/components/event/StaffTab';
import { RefundsTab } from '@/components/event/RefundsTab';
import { SeatingTab } from '@/components/event/SeatingTab';
import { SaveTemplateDialog } from '@/components/event/SaveTemplateDialog';
import { SessionsTab } from '@/components/event/SessionsTab';

function EventDetail() {
  const { id } = useParams<{ id: string }>();
  const params = useSearchParams();
  const tab = params.get('tab') ?? 'overview';
  const { data, error, loading, reload } = useApi<EventDashboard>(`/events/${id}/dashboard`);
  // Changes waiting for review (docs/event-change-review.md)
  const record = useApi<EventRecord>(`/events/${id}`);
  const [actionError, setActionError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [cancelOpen, setCancelOpen] = useState(params.get('cancel') === '1');
  const [templateOpen, setTemplateOpen] = useState(false);
  const [refundMode, setRefundMode] = useState<'AUTOMATIC' | 'ORGANIZER'>('AUTOMATIC');

  if (error) return <ErrorNotice message={error} onRetry={reload} />;
  if (loading && !data) return <Loading />;
  if (!data) return null;

  const { event } = data;
  const d = dayParts(event.startDate);
  // Phase 24 (docs/series.md)
  const series = record.data?.series ?? null;
  const open = record.data?.entryMode === 'OPEN';
  const sessionDate = `${d.weekday} ${d.day} ${d.month}`;
  const canPublish = open || data.ticketTypes.length > 0;
  const editable = event.status !== 'CANCELLED' && event.status !== 'COMPLETED';

  // Phase 27 (docs/host-rework.md): one row of tabs. Older links keep
  // working: ?tab=staff and ?tab=checkins open Gate, ?tab=seats Seating.
  const seated = data.ticketTypes.some((t) => t.seated);
  const ALIAS: Record<string, string> = { staff: 'gate', checkins: 'gate', seats: 'seating', sales: 'orders', people: 'attendees' };
  const tabs: { key: string; label: string; icon: IconName; badge?: number }[] = [
    { key: 'overview', label: 'Overview', icon: 'dashboard' },
    ...(series ? [{ key: 'sessions', label: 'Sessions', icon: 'calendar' as IconName }] : []),
    { key: 'tickets', label: 'Tickets', icon: 'tickets' },
    ...(seated || tab === 'seating' || tab === 'seats' ? [{ key: 'seating', label: 'Seating', icon: 'seats' as IconName }] : []),
    { key: 'orders', label: 'Orders', icon: 'orders' },
    { key: 'attendees', label: 'Attendees', icon: 'attendees' },
    { key: 'gate', label: 'Gate', icon: 'checkins' },
    { key: 'refunds', label: 'Refunds', icon: 'refunds', badge: data.refunds.requests },
  ];
  const current = ALIAS[tab] ?? tab;
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
            {series && <span className="badge badge-blue">{series.label}</span>}
            {open && <span className="badge badge-green">Open entry</span>}
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
            <button className="btn" disabled={busy || !canPublish} onClick={() => act('publish')} title={!canPublish ? 'Add a ticket type first' : undefined}>
              {data.permissions.requireEventReview ? 'Submit for review' : series ? 'Publish series' : 'Publish'}
            </button>
          )}
          {editable && (
            <Link className={`btn ${event.status === 'DRAFT' ? 'btn-quiet' : ''}`} href={`/organizer/events/${event.id}/edit`}>Edit event</Link>
          )}
          <details className="menu">
            <summary className="btn btn-quiet" aria-label="More actions"><Icon name="more" /></summary>
            <div className="menu-pop" role="menu">
              {/* Phase 18: any event, even a past one, can start new ones (docs/templates.md) */}
              <button role="menuitem" onClick={(e) => { (e.currentTarget.closest('details') as HTMLDetailsElement).open = false; setTemplateOpen(true); }}>
                <Icon name="copy" size={16} /> Save as template
              </button>
              {(event.status === 'PUBLISHED' || event.status === 'SOLD_OUT') && (
                <a role="menuitem" href={`/e/${event.slug}`} target="_blank" rel="noopener noreferrer">View public page</a>
              )}
              {editable && event.status !== 'DRAFT' && <Link role="menuitem" href={`/scan/${event.id}`}>Open the scanner</Link>}
              {editable && event.status !== 'DRAFT' && (
                <button role="menuitem" className="menu-danger" disabled={busy} onClick={(e) => { (e.currentTarget.closest('details') as HTMLDetailsElement).open = false; setCancelOpen(true); }}>{series ? 'Cancel this session…' : 'Cancel event…'}</button>
              )}
            </div>
          </details>
        </div>
      </header>

      <div className="ev-notices">
        {event.status === 'DRAFT' && !canPublish && (
          <div className="notice notice-info">Add a ticket type before publishing: <Link href={`/organizer/events/${event.id}/edit#entry`}>Edit event</Link>.</div>
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

      {templateOpen && (
        <SaveTemplateDialog
          eventId={event.id}
          eventName={event.name}
          seated={data.ticketTypes.some((t) => t.seated) ? { sections: data.ticketTypes.reduce((n, t) => n + (t.seated ? t.sections : 0), 0), closed: 0 } : null}
          onClose={() => setTemplateOpen(false)}
        />
      )}
      {cancelOpen && (
        <div className="modal-backdrop" role="presentation" onClick={(e) => e.target === e.currentTarget && !busy && setCancelOpen(false)}>
          <div className="modal" role="dialog" aria-modal="true" aria-labelledby="cancel-title">
            <h2 id="cancel-title">{series ? `Cancel ${sessionDate}?` : `Cancel ${event.name}?`}</h2>
            <p className="muted">
              {open ? 'Everyone who said they’re going is emailed.' : 'Ticket sales stop and every ticket holder is emailed.'}
              {series ? ' The other sessions go on as planned.' : ''} This can’t be undone here.
            </p>
            {!open && <fieldset className="choice-list" style={{ border: 0, padding: 0, margin: 0 }}>
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
            </fieldset>}
            {actionError && <div className="notice notice-error" role="alert">{actionError}</div>}
            <div className="row" style={{ justifyContent: 'flex-end' }}>
              <button className="btn btn-quiet" disabled={busy} onClick={() => setCancelOpen(false)}>Keep the event</button>
              <button className="btn btn-danger" disabled={busy} onClick={() => act('cancel')}>{busy ? 'Cancelling…' : series ? 'Cancel session' : 'Cancel event'}</button>
            </div>
          </div>
        </div>
      )}

      {current !== 'overview' && !open && event.status !== 'DRAFT' && (
        <div className="ev-strip">
          <div>
            <span>Sold</span>
            <b>{data.summary.ticketsSold.toLocaleString()} <small>of {data.summary.capacity.toLocaleString()}</small></b>
            <span className="hl-bar"><span style={{ width: `${Math.round(Math.min(1, share) * 100)}%` }} /></span>
          </div>
          <div><span>Sales</span><b>{money(data.summary.ticketRevenue, data.summary.currency)}</b></div>
          <div><span>Today</span><b>+{data.today.tickets} <small>tickets</small></b></div>
          <div><span>Let in</span><b>{data.summary.checkedIn.toLocaleString()}</b></div>
        </div>
      )}

      <nav className="tabs ev-tabs" aria-label="Event sections">
        {tabs.map((g) => (
          <Link key={g.key} href={href(g.key)} aria-current={current === g.key ? 'page' : undefined} scroll={false}>
            <Icon name={g.icon} size={16} />
            {g.label}
            {!!g.badge && <span className="tab-count" aria-label={`${g.badge} waiting`}>{g.badge}</span>}
          </Link>
        ))}
      </nav>

      <div className="ev-body">
      {current === 'overview' && <OverviewTab d={data} />}
      {current === 'sessions' && series && <SessionsTab eventId={event.id} />}
      {current === 'tickets' && (open ? (
        <div className="notice notice-info">
          Open entry: no tickets and no check-in. {record.data?.going ? `${record.data.going.count} ${record.data.going.count === 1 ? 'person has' : 'people have'} said they’re going.` : ''} To sell or limit places, switch to tickets in <Link href={`/organizer/events/${event.id}/edit`}>Edit event</Link>.
        </div>
      ) : <TicketsTab d={data} onChange={reload} />)}
      {current === 'seating' && <SeatingTab eventId={event.id} onChange={reload} />}
      {current === 'orders' && <OrdersTab eventId={event.id} />}
      {current === 'attendees' && <AttendeesTab eventId={event.id} onChange={reload} />}
      {current === 'refunds' && <RefundsTab d={data} onChange={reload} />}
      {current === 'gate' && (
        <div className="stack-l">
          <StaffTab eventId={event.id} venueId={event.venue.id} editable={editable} />
          <CheckInsTab eventId={event.id} />
        </div>
      )}
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
