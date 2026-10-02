'use client';

import Link from 'next/link';
import { useState } from 'react';
import { AdminStats, AttentionCounts, StatsPeriod, useAttention, waitingFor } from '@/lib/admin';
import { useApi } from '@/lib/hooks';
import { ErrorNotice, Loading } from '@/components/ui';
import { Icon } from '@/components/Icon';
import { VerifiedBadge } from '@/components/VerifiedBadge';
import { BarChart, Delta, dalasi, dalasiShort } from '@/components/BarChart';
import { HeroStats } from '@/components/HeroStats';

// Admin home (Phase 15, docs/admin-dashboard.md): how the platform is doing.
// The work queue is on "Needs attention"; this page links to it.

const PERIODS: { id: StatsPeriod; label: string; compare: string }[] = [
  { id: 'today', label: 'Today', compare: 'Today so far, compared with yesterday at the same time.' },
  { id: '7d', label: '7 days', compare: 'The last 7 days compared with the 7 before.' },
  { id: '30d', label: '30 days', compare: 'The last 30 days compared with the 30 before.' },
  { id: 'year', label: 'This year', compare: 'This year so far, compared with last year at the same point.' },
];

// Short names for the attention banner, most urgent first.
const SHORT: [keyof AttentionCounts, string, string][] = [
  ['cardPaymentsFlagged', 'card payment with no tickets', 'card payments with no tickets'],
  ['manualRefundsToPay', 'refund to pay', 'refunds to pay'],
  ['failedProviderRefunds', 'failed refund', 'failed refunds'],
  ['payoutsToSend', 'payout to send', 'payouts to send'],
  ['payoutRequests', 'payout request', 'payout requests'],
  ['payoutAccountsToCheck', 'payout account to check', 'payout accounts to check'],
  ['lookalikeWarnings', 'lookalike name', 'lookalike names'],
  ['eventsInReview', 'event to review', 'events to review'],
  ['eventChangesInReview', 'event change to review', 'event changes to review'],
  ['organizersPending', 'organizer to approve', 'organizers to approve'],
  ['failedEmails', 'failed email', 'failed emails'],
];

const slotLabel = (iso: string, bucket: AdminStats['period']['bucket']) => {
  const d = new Date(iso);
  if (bucket === 'hour') return d.toLocaleTimeString('en-GB', { timeZone: 'UTC', hour: '2-digit', minute: '2-digit' });
  if (bucket === 'month') return d.toLocaleDateString('en-GB', { timeZone: 'UTC', month: 'short' });
  return d.toLocaleDateString('en-GB', { timeZone: 'UTC', day: 'numeric', month: 'short' });
};

// "3 Sep to 2 Oct, compared with 4 Aug to 2 Sep"
function rangeText(p: AdminStats['period']) {
  const d = (iso: string, year = false) => new Date(iso).toLocaleDateString('en-GB', { timeZone: 'UTC', day: 'numeric', month: 'short', ...(year ? { year: 'numeric' } : {}) });
  if (p.name === 'today') return `Today, ${d(p.to)}, compared with yesterday at the same time.`;
  const y = p.name === 'year';
  return `${d(p.from, y)} to ${d(p.to, y)}, compared with ${d(p.previousFrom, y)} to ${d(p.previousTo, y)}.`;
}

const eventWhen = (e: AdminStats['events']['items'][number]) =>
  e.live ? 'Live now' : new Date(e.startDate).toLocaleDateString('en-GB', { timeZone: 'UTC', weekday: 'short', day: 'numeric', month: 'short' });

export default function AdminDashboardPage() {
  const [period, setPeriod] = useState<StatsPeriod>('30d');
  const { data: s, error, reload } = useApi<AdminStats>(`/admin/stats?period=${period}`);
  const { attention } = useAttention();
  const p = PERIODS.find((x) => x.id === period)!;
  const vs = period === 'today' ? ' vs yesterday' : period === 'year' ? ' vs last year' : ` vs previous ${p.label}`;
  const prevName = period === 'today' ? 'Yesterday' : period === 'year' ? 'Last year' : `Previous ${p.label}`;

  return (
    <div className="dash">
      <div className="page-head">
        <div>
          <h1>Dashboard</h1>
          <p className="muted">{s ? rangeText(s.period) : p.compare}</p>
        </div>
        <div className="segmented" role="radiogroup" aria-label="Period">
          {PERIODS.map((x) => (
            <button key={x.id} role="radio" aria-checked={x.id === period} onClick={() => setPeriod(x.id)}>{x.label}</button>
          ))}
        </div>
      </div>

      {attention && attention.total > 0 && (
        <Link href="/admin/attention" className="dash-alert">
          <Icon name="attention" size={20} />
          <strong>{attention.total} {attention.total === 1 ? 'thing needs' : 'things need'} attention</strong>
          <span className="dash-alert-list">
            {SHORT.filter(([k]) => attention.counts[k] > 0).map(([k, one, many]) => `${attention.counts[k]} ${attention.counts[k] === 1 ? one : many}`).join(' · ')}
          </span>
          <span className="dash-alert-go">Open →</span>
        </Link>
      )}

      {error && <ErrorNotice message={error} onRetry={reload} />}
      {!s && !error && <Loading />}

      {s && (
        <>
          <HeroStats
            aria="Money"
            label="Ticket sales"
            value={dalasi(s.money.ticketSales.value)}
            change={<Delta {...s.money.ticketSales} suffix={vs} />}
            partsTitle="Where the money goes"
            parts={[
              { label: 'Organizers’ share', value: s.money.ticketSales.organizers, shown: dalasi(s.money.ticketSales.organizers) },
              { label: 'Platform fees', value: s.money.ticketSales.fees, shown: dalasi(s.money.ticketSales.fees) },
            ]}
            side={[
              { label: 'Refunded', value: dalasi(s.money.refunded.value), note: <>{s.money.refunded.count} {s.money.refunded.count === 1 ? 'refund' : 'refunds'} <Delta {...s.money.refunded} goodWhenDown /></> },
              { label: 'Paid to organizers', value: dalasi(s.money.paidToOrganizers.value), note: <>{s.money.paidToOrganizers.count} {s.money.paidToOrganizers.count === 1 ? 'payout' : 'payouts'}</> },
              { label: 'Owed to organizers', value: dalasi(s.money.owedToOrganizers.value), note: <Link href="/admin/payouts">{dalasi(s.money.owedToOrganizers.payableNow)} can be paid now</Link> },
            ]}
          />

          <section className="panel panel-pad">
            <div className="spread dash-chart-head">
              <h2>Ticket sales {s.period.bucket === 'hour' ? 'per hour' : s.period.bucket === 'month' ? 'per month' : 'per day'}</h2>
              <div className="legend small">
                <span><i className="key key-now" />Sales</span>
                <span><i className="key key-prev" />{prevName}</span>
              </div>
            </div>
            <BarChart
              label={`Ticket sales ${p.label.toLowerCase()}, with the previous period`}
              slots={s.series.map((x) => ({ label: slotLabel(x.start, s.period.bucket), value: x.value, previous: x.previous, future: x.future }))}
              format={dalasi}
              axisFormat={dalasiShort}
              showPrevious
              labelEvery={s.period.bucket === 'hour' ? 4 : s.period.bucket === 'month' ? 1 : s.series.length > 10 ? 7 : 1}
            />
          </section>

          <div className="dash-row">
            <section className="panel dash-panel" aria-labelledby="activity">
              <div className="panel-head"><h2 id="activity">Activity</h2></div>
              <ul className="dash-list">
                {([
                  ['Tickets sold', s.activity.ticketsSold, false, (n: number) => n.toLocaleString('en-GB')],
                  ['Orders', s.activity.orders, false, (n: number) => n.toLocaleString('en-GB')],
                  ['Checked in at the gate', s.activity.checkedIn, false, (n: number) => n.toLocaleString('en-GB')],
                  ['New customers', s.activity.newCustomers, false, (n: number) => n.toLocaleString('en-GB')],
                  ['Average order', s.activity.averageOrder, false, dalasi],
                  ['Unpaid checkouts', s.activity.unpaidCheckouts, true, (n: number) => n.toLocaleString('en-GB')],
                ] as const).map(([name, c, down, fmt]) => (
                  <li key={name} className="dash-li">
                    <span>{name}</span>
                    <span className="dash-figure"><strong className="num">{fmt(c.value)}</strong><span className="dash-delta"><Delta {...c} goodWhenDown={down} /></span></span>
                  </li>
                ))}
              </ul>
            </section>

            <section className="panel dash-panel" aria-labelledby="events">
              <div className="panel-head">
                <h2 id="events">Events</h2>
                <span className="small muted">
                  {s.events.liveNow > 0 && <strong className="text-green">{s.events.liveNow} live now · </strong>}
                  {s.events.thisWeek} this week · {s.events.onSale} on sale
                </span>
              </div>
              {s.events.items.length === 0 ? (
                <div className="empty"><p>No events on sale.</p></div>
              ) : (
                <ul className="dash-list">
                  {s.events.items.map((e) => {
                    const share = e.capacity ? e.ticketsSold / e.capacity : 0;
                    return (
                      <li key={e.id} className="dash-li dash-event">
                        <span className="dash-event-name">
                          <strong>{e.name}</strong>
                          <span className="cell-sub">{e.live ? <span className="text-green">Live now</span> : eventWhen(e)} · {e.venue} · <Link href={`/admin/organizers/${e.organizer.id}`}>{e.organizer.businessName}</Link></span>
                        </span>
                        <span className="dash-sold">
                          <span className="small num">{e.ticketsSold.toLocaleString('en-GB')} of {e.capacity.toLocaleString('en-GB')} sold</span>
                          <span className="meter"><span className={share >= 0.8 ? 'held' : 'sold'} style={{ width: `${Math.min(100, share * 100)}%` }} /></span>
                        </span>
                      </li>
                    );
                  })}
                </ul>
              )}
            </section>
          </div>

          <section className="panel dash-orgs" aria-labelledby="top-orgs">
            <div className="dash-orgs-top">
              <div className="panel-head">
                <h2 id="top-orgs">Top organizers</h2>
                <Link href="/admin/organizers" className="small">All organizers</Link>
              </div>
              {s.organizers.top.length === 0 ? (
                <div className="empty"><p>No sales in this period.</p></div>
              ) : (
                <div className="table-wrap">
                  <table>
                    <thead><tr><th>Organizer</th><th className="right">Events</th><th className="right">Tickets</th><th className="right">Sales</th></tr></thead>
                    <tbody>
                      {s.organizers.top.map((o) => (
                        <tr key={o.id}>
                          <td>
                            <Link href={`/admin/organizers/${o.id}`}>{o.businessName}</Link>
                            {o.verified && <VerifiedBadge size={14} />}{' '}
                            <span className={`badge ${o.trustLevel === 'TRUSTED' ? 'badge-teal' : ''}`}>{o.trustLevel === 'TRUSTED' ? 'Trusted' : 'New'}</span>
                          </td>
                          <td className="right num">{o.events}</td>
                          <td className="right num">{o.tickets.toLocaleString('en-GB')}</td>
                          <td className="right num"><strong>{dalasi(o.sales)}</strong></td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}
            </div>

            <div className="dash-orgs-side">
              <h2>Organizers</h2>
              <LevelBar levels={s.organizers.byLevel} />
              <div className="dash-waiting">
                <div className="spread">
                  <strong>Waiting for approval</strong>
                  {s.organizers.waiting.count > 0 && <Link href="/admin/organizers?status=PENDING" className="small">All {s.organizers.waiting.count} →</Link>}
                </div>
                {s.organizers.waiting.oldest.length === 0 ? (
                  <p className="small muted">Nobody is waiting.</p>
                ) : (
                  s.organizers.waiting.oldest.map((o) => (
                    <div key={o.id} className="spread small">
                      <Link href={`/admin/organizers/${o.id}`}>{o.businessName}</Link>
                      <span className="faint">{waitingFor(o.createdAt)}</span>
                    </div>
                  ))
                )}
              </div>
              <p className="small muted dash-org-foot">
                <strong>{s.organizers.newInPeriod}</strong> new {period === 'today' ? 'today' : period === 'year' ? 'this year' : `in ${p.label}`}
                {' · '}<strong>{s.organizers.blueTick}</strong> with the blue tick
              </p>
            </div>
          </section>
        </>
      )}
    </div>
  );
}

function LevelBar({ levels }: { levels: AdminStats['organizers']['byLevel'] }) {
  const parts = [
    { key: 'trusted', label: 'Trusted', n: levels.trusted, cls: 'lv-trusted' },
    { key: 'new', label: 'New', n: levels.new, cls: 'lv-new' },
    { key: 'waiting', label: 'Waiting', n: levels.waiting, cls: 'lv-waiting' },
    { key: 'suspended', label: 'Suspended', n: levels.suspended, cls: 'lv-suspended' },
  ];
  const total = parts.reduce((a, x) => a + x.n, 0) || 1;
  return (
    <>
      <div className="lv-bar" aria-hidden>
        {parts.map((x) => x.n > 0 && <span key={x.key} className={x.cls} style={{ width: `${(x.n / total) * 100}%` }} />)}
      </div>
      <ul className="lv-legend">
        {parts.map((x) => (
          <li key={x.key}><i className={x.cls} />{x.label} <strong className="num">{x.n}</strong></li>
        ))}
      </ul>
    </>
  );
}
