'use client';

import Link from 'next/link';
import { useApi } from '@/lib/hooks';
import { Overview, OrganizerPermissions } from '@/lib/types';
import { dayParts, money, pct } from '@/lib/format';
import { ErrorNotice, Loading } from '@/components/ui';
import { VerifiedBadge } from '@/components/VerifiedBadge';
import { Icon } from '@/components/Icon';
import { BarChart, Delta, dalasi, dalasiShort } from '@/components/BarChart';
import { HeroStats } from '@/components/HeroStats';
import { WeekPulse } from '@/components/WeekPulse';
import { waitingFor } from '@/lib/admin';

// Organizer home (Phase 15, docs/organizer-dashboard.md): the next event
// first, then this week's numbers, what needs doing, and what's coming up.

const DAY = 86_400_000;

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
    <details className="panel panel-pad limits">
      <summary><strong>New organizer account:</strong> <span className="muted">a few limits apply while you build a track record.</span></summary>
      <ul className="small">
        {items.map((t) => <li key={t}>{t}</li>)}
      </ul>
      <p className="small muted">They’re lifted as you sell; contact the platform team if you need more sooner.</p>
    </details>
  );
}

function greeting() {
  // Banjul time is UTC+0 all year.
  const h = new Date().getUTCHours();
  return h < 12 ? 'Good morning' : h < 18 ? 'Good afternoon' : 'Good evening';
}

function startsIn(iso: string) {
  const start = new Date(iso);
  const today = Date.UTC(new Date().getUTCFullYear(), new Date().getUTCMonth(), new Date().getUTCDate());
  const day = Date.UTC(start.getUTCFullYear(), start.getUTCMonth(), start.getUTCDate());
  const days = Math.round((day - today) / DAY);
  if (start.getTime() <= Date.now()) return 'On now';
  if (days === 0) return 'Today';
  if (days === 1) return 'Tomorrow';
  return `In ${days} days`;
}

type Todo = { key: string; tone: 'gold' | 'red' | 'blue' | 'green'; mark: React.ReactNode; title: string; sub: string; href: string };

function todos(d: Overview): Todo[] {
  const t = d.todo;
  const out: Todo[] = [];
  if (t.refundRequests.count > 0) {
    const since = waitingFor(t.refundRequests.oldestAt);
    out.push({
      key: 'refunds', tone: 'gold', mark: t.refundRequests.count,
      title: `Answer ${t.refundRequests.count} refund ${t.refundRequests.count === 1 ? 'request' : 'requests'}`,
      sub: [t.refundRequests.event?.name, since && `oldest ${since}`].filter(Boolean).join(' · '),
      href: t.refundRequests.event ? `/organizer/events/${t.refundRequests.event.id}?tab=refunds` : '/organizer/events',
    });
  }
  const soon = Date.now() + 14 * DAY;
  for (const e of d.upcoming.filter((e) => e.staff === 0 && ['PUBLISHED', 'SOLD_OUT'].includes(e.status) && new Date(e.startDate).getTime() < soon).slice(0, 2)) {
    out.push({ key: `staff-${e.id}`, tone: 'red', mark: '!', title: 'Assign gate staff', sub: `${e.name} has nobody to scan tickets yet`, href: `/organizer/events/${e.id}?tab=staff` });
  }
  for (const e of t.sentBack.slice(0, 2)) {
    out.push({ key: `back-${e.id}`, tone: 'red', mark: '!', title: 'Sent back by the platform team', sub: `${e.name}: read the note, fix and resubmit`, href: `/organizer/events/${e.id}` });
  }
  if (t.changesInReview.length > 0) {
    out.push({ key: 'changes', tone: 'blue', mark: '…', title: 'Changes waiting for review', sub: t.changesInReview.map((e) => e.name).join(', '), href: `/organizer/events/${t.changesInReview[0].id}` });
  }
  if (t.eventsInReview > 0) {
    out.push({ key: 'review', tone: 'blue', mark: '…', title: `${t.eventsInReview} ${t.eventsInReview === 1 ? 'event' : 'events'} waiting for review`, sub: 'Usually checked within a working day', href: '/organizer/events' });
  }
  const drafts = d.eventsByStatus.DRAFT ?? 0;
  if (drafts > 0) {
    out.push({ key: 'drafts', tone: 'blue', mark: drafts, title: `${drafts} ${drafts === 1 ? 'draft' : 'drafts'} not on sale yet`, sub: 'Add tickets and publish when ready', href: '/organizer/events' });
  }
  const acct = t.payoutAccount;
  out.push(
    !acct.method
      ? { key: 'payout', tone: 'red', mark: '!', title: 'Add your withdrawal details', sub: 'Where we send your money: Wave or bank', href: '/organizer/payouts' }
      : !acct.verified
        ? { key: 'payout', tone: 'gold', mark: '…', title: 'Withdrawal details being checked', sub: `${acct.method === 'WAVE' ? 'Wave' : 'Bank'} · ${acct.account ?? ''}`, href: '/organizer/payouts' }
        : { key: 'payout', tone: 'green', mark: <Icon name="check" size={14} />, title: 'Withdrawal details checked', sub: `${acct.method === 'WAVE' ? 'Wave' : 'Bank'} · ${acct.account ?? ''}`, href: '/organizer/payouts' },
  );
  return out;
}

const ago = (iso: string) => {
  const w = waitingFor(iso);
  return !w || w === '0 min' ? 'just now' : `${w} ago`;
};

// "26 Sep – 2 Oct": the last 7 days, today included (Banjul = UTC).
function weekRange() {
  const f = (t: number) => new Date(t).toLocaleDateString('en-GB', { timeZone: 'UTC', day: 'numeric', month: 'short' });
  return `${f(Date.now() - 6 * DAY)} – ${f(Date.now())}`;
}

const posterTint = ['#F59E0B', '#0EA5E9', '#7C3AED', '#10B981', '#E11D48'];

export default function OverviewPage() {
  const { data, error, loading, reload } = useApi<Overview>('/organizer/overview');

  if (error) return <ErrorNotice message={error} onRetry={reload} />;
  if (loading || !data) return <Loading />;

  const next = data.upcoming.find((e) => e.status === 'PUBLISHED' || e.status === 'SOLD_OUT');
  const rest = data.upcoming.filter((e) => e.id !== next?.id).slice(0, 3);
  const days30 = data.salesByDay.reduce((a, d) => ({ tickets: a.tickets + d.tickets, revenue: a.revenue + d.revenue }), { tickets: 0, revenue: 0 });
  const list = todos(data);

  return (
    <div className="dash">
      <div className="page-head">
        <div>
          <p className="muted">{greeting()}</p>
          <h1 className="title-with-badge">{data.organizer.businessName}{data.organizer.verified && <VerifiedBadge size={22} />}</h1>
        </div>
        <Link className="btn btn-quiet" href={`/o/${data.organizer.slug}`} target="_blank">Your public page</Link>
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

      {next ? (
        <section className="hero" aria-label="Next event">
          <div className="hero-poster">
            {next.posterUrl ? <img src={next.posterUrl} alt="" /> : <span>{next.name.slice(0, 1)}</span>}
          </div>
          <div className="hero-body">
            <span className="hero-chip">Next event · {startsIn(next.startDate).toLowerCase()}</span>
            <h2>{next.name}</h2>
            <p className="hero-meta">{(() => { const p = dayParts(next.startDate); return `${p.weekday} ${p.day} ${p.month} · ${p.time} · ${next.venue}`; })()}</p>
            <div className="hero-sold">
              <span><strong>{next.ticketsSold.toLocaleString()}</strong> of {next.capacity.toLocaleString()} sold</span>
              {next.soldToday > 0 && <span className="hero-today">+{next.soldToday} today</span>}
            </div>
            <div className="hero-meter"><span style={{ width: `${next.capacity ? Math.min(100, (next.ticketsSold / next.capacity) * 100) : 0}%` }} /></div>
          </div>
          <div className="hero-actions">
            <Link className="btn hero-btn-main" href={`/organizer/events/${next.id}`}>Open the event</Link>
            <Link className="btn hero-btn" href={`/organizer/events/${next.id}?tab=staff`}>Gate staff ({next.staff})</Link>
          </div>
        </section>
      ) : (
        <section className="hero hero-empty">
          <div className="hero-body">
            <h2>No event on sale right now</h2>
            <p className="hero-meta">Create one, add tickets and publish it to start selling.</p>
          </div>
          <div className="hero-actions">
            <Link className="btn hero-btn-main" href="/organizer/events/new">+ Create event</Link>
          </div>
        </section>
      )}

      <HeroStats
        aria="This week"
        label="Sales this week"
        period={weekRange()}
        value={dalasi(data.thisWeek.revenue)}
        change={<Delta value={data.thisWeek.revenue} previous={data.lastWeek.revenue} suffix=" vs last week" />}
        body={<WeekPulse days={data.salesByDay} next={next ? { ...next, soldLast7: data.thisWeek.byEvent.find((e) => e.id === next.id)?.tickets ?? 0 } : null} />}
        side={[
          { label: 'Tickets this week', value: data.thisWeek.tickets.toLocaleString(), note: <Delta value={data.thisWeek.tickets} previous={data.lastWeek.tickets} /> },
          {
            label: 'Available to withdraw',
            value: dalasi(data.payouts.available),
            note: data.payouts.inProgress > 0
              ? `${dalasi(data.payouts.inProgress)} on its way`
              : data.payouts.available > 0
                ? <Link href="/organizer/payouts">Withdraw →</Link>
                : data.payouts.held > 0 ? `${dalasi(data.payouts.held)} after your events` : <Link href="/organizer/payouts">Payouts</Link>,
          },
          data.lastEvent && data.lastEvent.ticketsSold > 0
            ? { label: 'Checked in, last event', value: pct(data.lastEvent.checkedIn / data.lastEvent.ticketsSold), note: `${data.lastEvent.checkedIn} of ${data.lastEvent.ticketsSold} · ${data.lastEvent.name}` }
            : { label: 'Tickets sold, all time', value: data.totals.ticketsSold.toLocaleString(), note: `${data.totals.paidOrders} paid orders` },
        ]}
      />

      <div className="dash-row dash-row-wide">
        <section className="panel panel-pad dash-panel">
          <div className="spread dash-chart-head">
            <h2>Sales, last 30 days</h2>
            <span className="small muted">{dalasi(days30.revenue)} · {days30.tickets.toLocaleString()} {days30.tickets === 1 ? 'ticket' : 'tickets'}</span>
          </div>
          <div className="dash-chart-fill">
            <BarChart
              label="Your ticket sales per day, last 30 days"
              slots={data.salesByDay.map((d) => ({ label: new Date(`${d.date}T00:00:00Z`).toLocaleDateString('en-GB', { timeZone: 'UTC', day: 'numeric', month: 'short' }), value: d.revenue }))}
              format={dalasi}
              axisFormat={dalasiShort}
              height={240}
              width={640}
              labelEvery={7}
            />
          </div>
        </section>

        <section className="panel dash-panel" aria-labelledby="todo">
          <div className="panel-head"><h2 id="todo">To do</h2></div>
          <ul className="dash-list">
            {list.map((t) => (
              <li key={t.key} className="dash-li todo">
                <Link href={t.href} className="todo-link">
                  <span className={`todo-mark todo-${t.tone}`}>{t.mark}</span>
                  <span className="todo-text">
                    <span className="todo-title">{t.title}</span>
                    {t.sub && <span className="cell-sub">{t.sub}</span>}
                  </span>
                  <span className="todo-go" aria-hidden>→</span>
                </Link>
              </li>
            ))}
          </ul>
        </section>
      </div>

      <div className="dash-row dash-row-wide">
        <section className="dash-panel" aria-labelledby="coming">
          <div className="spread dash-h-row">
            <h2 id="coming">Coming up</h2>
            <Link href="/organizer/events" className="small">All events</Link>
          </div>
          {rest.length === 0 ? (
            <div className="panel empty dash-fill">
              <p>{next ? 'Nothing else coming up.' : 'No upcoming events.'}</p>
              <Link className="btn" href="/organizer/events/new">+ Create event</Link>
            </div>
          ) : (
            <div className="ecards">
              {rest.map((e, i) => {
                const p = dayParts(e.startDate);
                const share = e.capacity ? e.ticketsSold / e.capacity : 0;
                const status = e.status === 'DRAFT' ? 'Draft · not on sale' : e.status === 'PENDING_APPROVAL' ? 'Waiting for review' : share >= 0.8 ? 'On sale · almost sold out' : e.status === 'SOLD_OUT' ? 'Sold out' : 'On sale';
                return (
                  <Link key={e.id} href={`/organizer/events/${e.id}`} className="ecard">
                    <span className="ecard-poster" style={e.posterUrl ? undefined : { background: posterTint[i % posterTint.length] }}>
                      {e.posterUrl && <img src={e.posterUrl} alt="" />}
                      <span className="ecard-date">{p.weekday} {p.day} {p.month}</span>
                    </span>
                    <span className="ecard-body">
                      <strong>{e.name}</strong>
                      <span className={`ecard-status ${e.status === 'DRAFT' || e.status === 'PENDING_APPROVAL' ? 'faint' : share >= 0.8 ? 'text-gold' : 'text-green'}`}>{status}</span>
                      <span className="meter"><span className="sold" style={{ width: `${Math.min(100, share * 100)}%` }} /></span>
                      <span className="small muted">{e.ticketsSold.toLocaleString()} of {e.capacity.toLocaleString()} sold</span>
                    </span>
                  </Link>
                );
              })}
            </div>
          )}
        </section>

        <section className="panel dash-panel" aria-labelledby="orders">
          <div className="panel-head"><h2 id="orders">Latest orders</h2></div>
          {data.recentOrders.length === 0 ? (
            <div className="empty dash-fill"><p>No paid orders yet. They’ll appear here as tickets sell.</p></div>
          ) : (
            <ul className="dash-list">
              {data.recentOrders.slice(0, 5).map((o) => (
                <li key={o.id} className="dash-li">
                  <span className="dash-event-name">
                    <strong>{o.customer.fullName ?? o.customer.email}</strong>
                    <span className="cell-sub">
                      {(o.items ?? []).map((i) => `${i.quantity} × ${i.ticketType}`).join(', ') || `${o.tickets} tickets`} · <Link href={`/organizer/events/${o.event.id}?tab=orders`}>{o.event.name}</Link>
                    </span>
                  </span>
                  <span className="order-amt">
                    <strong className="num">{dalasi(o.total)}</strong>
                    <span className="cell-sub">{ago(o.paidAt)}</span>
                  </span>
                </li>
              ))}
            </ul>
          )}
        </section>
      </div>
    </div>
  );
}
