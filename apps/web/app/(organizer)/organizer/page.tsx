'use client';

import Link from 'next/link';
import { useApi } from '@/lib/hooks';
import { Overview, OrganizerPermissions } from '@/lib/types';
import { dateTime, money, dayParts } from '@/lib/format';
import { CapacityMeter, ErrorNotice, Loading, StatusBadge } from '@/components/ui';
import { VerifiedBadge } from '@/components/VerifiedBadge';

// docs/organizer-trust.md: what a new organizer's account can do, so the
// restrictions never come as a surprise.
function AccountLimits({ p }: { p: OrganizerPermissions }) {
  const items = [
    p.requireEventReview && 'Events are checked by the platform team before they go on sale (usually within a working day).',
    p.maxTicketsPerEvent !== null && `Up to ${p.maxTicketsPerEvent.toLocaleString()} tickets per event.`,
    p.maxTicketPrice !== null && `Tickets up to ${money(p.maxTicketPrice)} each.`,
    !p.canConfirmBankTransfers && 'Bank-transfer payments are confirmed by the platform when the money arrives.',
    !p.canHandleCancellationRefunds && 'If you cancel an event, everyone is refunded automatically.',
  ].filter(Boolean) as string[];
  if (items.length === 0) return null;
  return (
    <section className="panel panel-pad">
      <h2 style={{ marginBottom: 6 }}>New organizer account</h2>
      <p className="small muted" style={{ marginBottom: 10 }}>To protect ticket buyers, new accounts start with a few limits. They’re lifted as you build a track record; contact the platform team if you need more sooner.</p>
      <ul className="small" style={{ margin: 0, paddingLeft: 18, display: 'grid', gap: 4 }}>
        {items.map((t) => <li key={t}>{t}</li>)}
      </ul>
    </section>
  );
}

export default function OverviewPage() {
  const { data, error, loading, reload } = useApi<Overview>('/organizer/overview');

  if (error) return <ErrorNotice message={error} onRetry={reload} />;
  if (loading || !data) return <Loading />;

  const { totals } = data;
  const published = data.eventsByStatus.PUBLISHED ?? 0;
  const drafts = data.eventsByStatus.DRAFT ?? 0;

  return (
    <div className="stack-l">
      <div className="page-head">
        <div>
          <h1 className="title-with-badge">{data.organizer.businessName}{data.organizer.verified && <VerifiedBadge size={22} />}</h1>
          <p className="muted">
            {published} published {published === 1 ? 'event' : 'events'}, {drafts} {drafts === 1 ? 'draft' : 'drafts'}
          </p>
        </div>
        <div className="row">
          <Link className="btn btn-quiet" href={`/o/${data.organizer.slug}`} target="_blank">Your public page</Link>
          <Link className="btn" href="/organizer/events/new">Create event</Link>
        </div>
      </div>

      {data.organizer.verificationStatus === 'SUSPENDED' ? (
        <div className="notice notice-error" role="alert">
          Your account is suspended: ticket sales for your events are paused and you can’t publish. Tickets already sold stay valid. Please contact the platform team.
        </div>
      ) : data.organizer.verificationStatus !== 'APPROVED' ? (
        <div className="notice notice-info">
          Your organizer account is awaiting approval. You can build events now; publishing unlocks once an admin approves you.
        </div>
      ) : data.organizer.permissions.trustLevel === 'NEW' ? (
        <AccountLimits p={data.organizer.permissions} />
      ) : null}

      <dl className="stats">
        <div className="stat">
          <dt>Ticket revenue</dt>
          <dd className="num">{money(totals.ticketRevenue, totals.currency)}</dd>
          <p className="sub">after discounts and refunds · <Link href="/organizer/payouts">payouts</Link></p>
        </div>
        <div className="stat">
          <dt>Tickets sold</dt>
          <dd className="num">{totals.ticketsSold.toLocaleString()}</dd>
          <p className="sub">{totals.paidOrders} paid orders</p>
        </div>
        <div className="stat">
          <dt>Checked in</dt>
          <dd className="num">{totals.checkedIn.toLocaleString()}</dd>
          <p className="sub">across all events</p>
        </div>
        <div className="stat">
          <dt>Platform fees paid by buyers</dt>
          <dd className="num">{money(totals.platformFees, totals.currency)}</dd>
          <p className="sub">{money(totals.grossCollected, totals.currency)} collected in total</p>
        </div>
      </dl>

      <section className="panel">
        <div className="panel-head">
          <h2>Coming up</h2>
          <Link href="/organizer/events" className="small">All events</Link>
        </div>
        {data.upcoming.length === 0 ? (
          <div className="empty">
            <p>No upcoming events.</p>
            <Link className="btn" href="/organizer/events/new">Create event</Link>
          </div>
        ) : (
          <div className="table-wrap">
            <table>
              <thead>
                <tr><th>Event</th><th>Date</th><th>Status</th><th style={{ width: '28%' }}>Sold</th></tr>
              </thead>
              <tbody>
                {data.upcoming.map((e) => {
                  const d = dayParts(e.startDate);
                  return (
                    <tr key={e.id}>
                      <td>
                        <Link href={`/organizer/events/${e.id}`}>{e.name}</Link>
                        <span className="cell-sub">{e.venue}</span>
                      </td>
                      <td className="num">{d.weekday} {d.day} {d.month}<span className="cell-sub">{d.time}</span></td>
                      <td><StatusBadge status={e.status} /></td>
                      <td>
                        <div className="small num" style={{ marginBottom: 6 }}>
                          {e.ticketsSold} of {e.capacity}
                        </div>
                        <CapacityMeter sold={e.ticketsSold} capacity={e.capacity} />
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </section>

      <section className="panel">
        <div className="panel-head">
          <h2>Latest paid orders</h2>
        </div>
        {data.recentOrders.length === 0 ? (
          <div className="empty"><p>No paid orders yet. They’ll appear here as tickets sell.</p></div>
        ) : (
          <div className="table-wrap">
            <table>
              <thead>
                <tr><th>Customer</th><th>Event</th><th className="right">Tickets</th><th className="right">Total</th><th>Paid</th></tr>
              </thead>
              <tbody>
                {data.recentOrders.map((o) => (
                  <tr key={o.id}>
                    <td>{o.customer.fullName ?? o.customer.email}<span className="cell-sub">{o.customer.fullName ? o.customer.email : ''}</span></td>
                    <td><Link href={`/organizer/events/${o.event.id}?tab=orders`}>{o.event.name}</Link></td>
                    <td className="right num">{o.tickets}</td>
                    <td className="right num">{money(o.total, o.currency)}</td>
                    <td className="num small">{dateTime(o.paidAt)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </section>
    </div>
  );
}
