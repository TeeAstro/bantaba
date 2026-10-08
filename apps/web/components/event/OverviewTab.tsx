'use client';

import Link from 'next/link';
import { EventDashboard } from '@/lib/types';
import { label, money, pct } from '@/lib/format';
import { CapacityMeter } from '@/components/ui';
import { Icon } from '@/components/Icon';
import { BarChart, dalasi } from '@/components/BarChart';
import { HeroStats, Part } from '@/components/HeroStats';

const DAY = 86_400_000;

type Check = { key: string; state: 'done' | 'todo' | 'wait' | 'info'; title: string; sub: string; action: string; href: string };

// "Before the event" (Phase 15): what an organizer should have in place.
function checklist(d: EventDashboard): Check[] {
  const e = d.event;
  const base = `/organizer/events/${e.id}`;
  const types = d.ticketTypes.length;
  const r = d.readiness;
  return [
    types > 0
      ? { key: 'types', state: 'done', title: 'Ticket types and prices', sub: `${types} ${types === 1 ? 'type' : 'types'} · ${e.status === 'DRAFT' ? 'not on sale yet' : 'on sale'}`, action: 'Edit', href: `${base}/edit#entry` }
      : { key: 'types', state: 'todo', title: 'Add ticket types', sub: 'Nothing can be sold until there is at least one', action: 'Add', href: `${base}/edit#entry` },
    e.posterUrl
      ? { key: 'poster', state: 'done', title: 'Poster', sub: 'Shown on your public page and on tickets', action: 'Change', href: `${base}/edit` }
      : { key: 'poster', state: 'info', title: 'Add a poster', sub: 'Events with a poster sell better', action: 'Add', href: `${base}/edit` },
    r.staff > 0
      ? { key: 'staff', state: 'done', title: 'Gate staff', sub: `${r.staff} ${r.staff === 1 ? 'person' : 'people'} can scan tickets`, action: 'Manage', href: `${base}?tab=staff` }
      : { key: 'staff', state: 'todo', title: 'Gate staff', sub: 'Nobody assigned to scan tickets yet', action: 'Assign', href: `${base}?tab=staff` },
    r.staffPhones > 0
      ? { key: 'phones', state: 'done', title: 'Scanner phones', sub: `${r.staffPhones} ${r.staffPhones === 1 ? 'phone is' : 'phones are'} signed in`, action: 'Open', href: `/scan/${e.id}` }
      : { key: 'phones', state: 'info', title: 'Test the scanner', sub: 'Sign in on the phones you’ll use at the gate', action: 'Open', href: `/scan/${e.id}` },
    !r.payoutMethod
      ? { key: 'payout', state: 'todo', title: 'Withdrawal details', sub: 'Add where your money is sent', action: 'Add', href: '/organizer/payouts' }
      : r.payoutDetailsVerified
        ? { key: 'payout', state: 'done', title: 'Withdrawal details', sub: 'Checked by Bantaba', action: 'View', href: '/organizer/payouts' }
        : { key: 'payout', state: 'wait', title: 'Withdrawal details', sub: 'Being checked by Bantaba', action: 'View', href: '/organizer/payouts' },
  ];
}

// Every day from the first sale (or the last 14 days) to today, at most 45.
function dailySeries(d: EventDashboard) {
  const today = new Date(Date.UTC(new Date().getUTCFullYear(), new Date().getUTCMonth(), new Date().getUTCDate()));
  const end = Math.min(today.getTime(), new Date(d.event.endDate).getTime());
  const first = d.salesByDay.length ? new Date(`${d.salesByDay[0].date}T00:00:00Z`).getTime() : end - 13 * DAY;
  const start = Math.max(Math.min(first, end - 13 * DAY), end - 44 * DAY);
  const by = new Map(d.salesByDay.map((x) => [x.date, x]));
  const out = [];
  for (let t = start; t <= end; t += DAY) {
    const key = new Date(t).toISOString().slice(0, 10);
    const x = by.get(key);
    out.push({ label: new Date(t).toLocaleDateString('en-GB', { timeZone: 'UTC', day: 'numeric', month: 'short' }), value: x?.tickets ?? 0 });
  }
  return out;
}

// Revenue by ticket type: the top three, then the rest together.
function typeParts(d: EventDashboard): Part[] {
  const types = [...d.ticketTypes].filter((t) => t.revenue > 0).sort((a, b) => b.revenue - a.revenue);
  const top: Part[] = types.slice(0, 3).map((t) => ({ label: t.name, value: t.revenue, shown: dalasi(t.revenue) }));
  const rest = types.slice(top.length);
  if (rest.length) {
    const n = rest.reduce((a, t) => a + t.revenue, 0);
    top.push({ label: `${rest.length} other ${rest.length === 1 ? 'type' : 'types'}`, value: n, shown: dalasi(n), other: true });
  }
  return top;
}

export function OverviewTab({ d }: { d: EventDashboard }) {
  const s = d.summary;
  const pending = d.ordersByStatus.PENDING ?? 0;
  const scans = Object.entries(d.checkIns).filter(([, n]) => n > 0);
  const started = new Date(d.event.startDate).getTime() <= Date.now();
  const base = `/organizer/events/${d.event.id}`;
  const slots = dailySeries(d);

  return (
    <div className="dash">
      <HeroStats
        aria="Sales"
        label="Your revenue"
        period={d.salesByDay.length ? `since ${new Date(`${d.salesByDay[0].date}T00:00:00Z`).toLocaleDateString('en-GB', { timeZone: 'UTC', day: 'numeric', month: 'short' })}` : undefined}
        value={dalasi(s.ticketRevenue)}
        change={d.today.revenue > 0 ? <span className="delta delta-good">+{dalasi(d.today.revenue)} today</span> : undefined}
        partsTitle="By ticket type"
        parts={typeParts(d)}
        emptyText="No tickets sold yet."
        side={[
          {
            label: 'Tickets sold',
            value: <>{s.ticketsSold.toLocaleString()} <span className="faint" style={{ fontSize: 15, fontWeight: 500 }}>of {s.capacity.toLocaleString()}</span></>,
            note: <span className="hstat-meter"><CapacityMeter sold={s.ticketsSold} held={s.reservedPending} capacity={s.capacity} />{s.capacity ? pct(s.ticketsSold / s.capacity) : ''}</span>,
          },
          started
            ? { label: 'Checked in', value: s.checkedIn.toLocaleString(), note: s.ticketsSold ? `${pct(s.attendanceRate)} of tickets` : 'no tickets sold' }
            : { label: 'Waiting for payment', value: String(pending), note: pending === 0 ? 'no open orders' : 'bank transfer or Wave' },
          {
            label: 'Refund requests',
            value: String(d.refunds.requests),
            tone: d.refunds.requests > 0 ? 'alert' : undefined,
            note: d.refunds.requests > 0
              ? <Link href={`${base}?tab=refunds`}>Answer {d.refunds.requests === 1 ? 'it' : 'them'} →</Link>
              : d.refunds.refunded > 0 ? `${dalasi(d.refunds.refunded)} refunded` : 'none waiting',
          },
        ]}
      />

      <div className="dash-row dash-row-ev">
        <section className="panel panel-pad dash-panel">
          <div className="spread dash-chart-head">
            <h2>Tickets sold per day</h2>
            {d.today.tickets > 0 && <span className="small text-green">{d.today.tickets} today</span>}
          </div>
          <div className="dash-chart-fill">
            {d.salesByDay.length === 0 ? (
              <div className="empty" style={{ width: '100%' }}><p>No tickets sold yet.</p></div>
            ) : (
              <BarChart label="Tickets sold per day" slots={slots} format={(n) => `${n} ${n === 1 ? 'ticket' : 'tickets'}`} axisFormat={(n) => String(Math.round(n))} width={620} height={250} labelEvery={Math.max(1, Math.ceil(slots.length / 5))} />
            )}
          </div>
        </section>

        {started ? (
          <section className="panel dash-panel" aria-labelledby="gate">
            <div className="panel-head"><h2 id="gate">At the gate</h2><Link className="small" href={`${base}?tab=checkins`}>All check-ins</Link></div>
            {scans.length === 0 ? (
              <div className="empty dash-fill"><p>No tickets scanned yet.</p></div>
            ) : (
              <ul className="dash-list">
                {scans.map(([result, n]) => (
                  <li key={result} className="dash-li"><span>{label(result)}</span><strong className="num">{n}</strong></li>
                ))}
              </ul>
            )}
          </section>
        ) : (
          <section className="panel dash-panel" aria-labelledby="before">
            <div className="panel-head"><h2 id="before">Before the event</h2></div>
            <ul className="dash-list">
              {checklist(d).map((c) => (
                <li key={c.key} className="dash-li check-li">
                  <span className={`check-mark check-${c.state}`}>
                    {c.state === 'done' ? <Icon name="check" size={14} /> : c.state === 'todo' ? '!' : c.state === 'wait' ? '…' : '·'}
                  </span>
                  <span className="todo-text">
                    <span className="todo-title">{c.title}</span>
                    <span className="cell-sub">{c.sub}</span>
                  </span>
                  <Link className="small check-action" href={c.href}>{c.action}</Link>
                </li>
              ))}
            </ul>
          </section>
        )}
      </div>

      <section className="panel">
        <div className="panel-head">
          <h2>Tickets</h2>
          <Link className="small" href={d.ticketTypes.length ? `${base}?tab=tickets` : `${base}/edit#entry`}>{d.ticketTypes.length ? 'Ticket sales' : '+ Add tickets'}</Link>
        </div>
        {d.ticketTypes.length === 0 ? (
          <div className="empty"><p>No ticket types yet.</p></div>
        ) : (
          <ul className="dash-list">
            {d.ticketTypes.map((t) => {
              const ended = t.salesEnd && new Date(t.salesEnd).getTime() < Date.now();
              return (
                <li key={t.id} className="dash-li tt-row">
                  <span className="dash-event-name">
                    <strong>{t.name}</strong>
                    <span className="cell-sub">
                      {!t.isActive ? 'Hidden' : ended ? 'Sales ended' : t.seated ? `Seats in ${t.sections} ${t.sections === 1 ? 'section' : 'sections'}` : 'General admission'}
                    </span>
                  </span>
                  <strong className="num tt-price">{money(t.price, t.currency).replace('.00', '')}</strong>
                  <span className="tt-sold">
                    <span className="small num">{t.sold.toLocaleString()} of {t.quantityTotal.toLocaleString()} sold{t.reservedPending > 0 ? ` · ${t.reservedPending} held` : ''}</span>
                    <CapacityMeter sold={t.sold} held={t.reservedPending} capacity={t.quantityTotal} />
                  </span>
                  <strong className="num tt-rev">{dalasi(t.revenue)}</strong>
                </li>
              );
            })}
          </ul>
        )}
      </section>

      {/* Phase 13 */}
      {d.refunds.refunded > 0 && (
        <p className="small muted">Refunded {money(d.refunds.refunded, s.currency)}, already taken off the revenue above.</p>
      )}

      {/* Phase 12: emails to ticket holders and buyers about this event */}
      {(d.notifications.sent > 0 || d.notifications.pending > 0 || d.notifications.failed > 0) && (
        <p className="small muted">
          Emails about this event: {d.notifications.sent} sent
          {d.notifications.pending > 0 && <>, {d.notifications.pending} waiting to go out</>}
          {d.notifications.failed > 0 && <>, <span style={{ color: 'var(--red)' }}>{d.notifications.failed} failed</span> (the platform admin can retry them)</>}.
        </p>
      )}
    </div>
  );
}
