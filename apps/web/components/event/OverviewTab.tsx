'use client';

import Link from 'next/link';
import { EventDashboard } from '@/lib/types';
import { label, money, pct } from '@/lib/format';
import { CapacityMeter } from '@/components/ui';
import { SalesChart } from '@/components/SalesChart';

export function OverviewTab({ d }: { d: EventDashboard }) {
  const s = d.summary;
  const pending = d.ordersByStatus.PENDING ?? 0;
  const scans = Object.entries(d.checkIns).filter(([, n]) => n > 0);

  return (
    <div className="stack-l">
      <dl className="stats">
        <div className="stat">
          <dt>Tickets sold</dt>
          <dd className="num">{s.ticketsSold} <span className="faint" style={{ fontSize: 15, fontWeight: 400 }}>of {s.capacity}</span></dd>
          <div style={{ marginTop: 8 }}><CapacityMeter sold={s.ticketsSold} held={s.reservedPending} capacity={s.capacity} /></div>
          {s.reservedPending > 0 && <p className="sub">{s.reservedPending} reserved, awaiting payment</p>}
        </div>
        <div className="stat">
          <dt>Ticket revenue</dt>
          <dd className="num">{money(s.ticketRevenue, s.currency)}</dd>
          <p className="sub">plus {money(s.platformFees, s.currency)} platform fees</p>
        </div>
        <div className="stat">
          <dt>Checked in</dt>
          <dd className="num">{s.checkedIn}</dd>
          <p className="sub">{s.ticketsSold ? `${pct(s.attendanceRate)} of tickets sold` : 'no tickets sold yet'}</p>
        </div>
        <div className="stat">
          <dt>Awaiting payment</dt>
          <dd className="num">{pending}</dd>
          <p className="sub">{pending === 1 ? 'order' : 'orders'} (bank transfer or Wave)</p>
        </div>
      </dl>

      <section className="panel">
        <div className="panel-head"><h2>Sales per day</h2></div>
        <div className="panel-pad"><SalesChart days={d.salesByDay} currency={s.currency} /></div>
      </section>

      <section className="panel">
        <div className="panel-head"><h2>By ticket type</h2></div>
        {d.ticketTypes.length === 0 ? (
          <div className="empty"><p>No ticket types yet. Add one in the Ticket types tab.</p></div>
        ) : (
          <div className="table-wrap">
            <table>
              <thead>
                <tr><th>Ticket type</th><th className="right">Price</th><th className="right">Sold</th><th style={{ width: '22%' }}>Capacity</th><th className="right">Revenue</th></tr>
              </thead>
              <tbody>
                {d.ticketTypes.map((t) => (
                  <tr key={t.id}>
                    <td>{t.name}<span className="cell-sub">{t.section ? `Reserved, ${t.section.name}` : 'General admission'}</span></td>
                    <td className="right num">{money(t.price, t.currency)}</td>
                    <td className="right num">{t.sold}{t.reservedPending > 0 && <span className="cell-sub">+{t.reservedPending} held</span>}</td>
                    <td>
                      <div className="small num" style={{ marginBottom: 6 }}>{t.remaining} left of {t.quantityTotal}</div>
                      <CapacityMeter sold={t.sold} held={t.reservedPending} capacity={t.quantityTotal} />
                    </td>
                    <td className="right num">{money(t.revenue, t.currency)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </section>

      <section className="panel">
        <div className="panel-head"><h2>Scans at the gate</h2></div>
        {scans.length === 0 ? (
          <div className="empty"><p>No tickets scanned yet.</p></div>
        ) : (
          <div className="table-wrap">
            <table>
              <tbody>
                {scans.map(([result, n]) => (
                  <tr key={result}><td>{label(result)}</td><td className="right num">{n}</td></tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </section>

      {/* Phase 13 */}
      {(d.refunds.refunded > 0 || d.refunds.requests > 0) && (
        <p className="small muted">
          {d.refunds.refunded > 0 && <>Refunded {money(d.refunds.refunded, s.currency)} (already taken off the revenue above). </>}
          {d.refunds.requests > 0 && <Link href={`/organizer/events/${d.event.id}?tab=refunds`}>{d.refunds.requests} refund request{d.refunds.requests === 1 ? '' : 's'} waiting for you</Link>}
        </p>
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
