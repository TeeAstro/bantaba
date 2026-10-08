'use client';

import Link from 'next/link';
import { useState } from 'react';
import { api, ApiError } from '@/lib/api';
import { useApi } from '@/lib/hooks';
import { EventDashboard } from '@/lib/types';
import { money } from '@/lib/format';
import { EventFee, feeForTicket } from '@/lib/fees';

const day = (iso: string) => new Date(iso).toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric' });

// Phase 20b (docs/payments.md, "Booking fee"): Bantaba's fee for this event,
// and who pays it: buyers on top, or inside the host's prices.
// Designed on the "Bantaba Host screens" canvas (FeesHost).
function BookingFeeCard({ eventId, fee, editable, onSaved }: { eventId: string; fee: EventFee; editable: boolean; onSaved: (f: EventFee) => void }) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const sample = 50_000;
  const f = feeForTicket(fee, sample);
  async function set(included: boolean) {
    if (included === fee.included || busy || !editable) return;
    setBusy(true);
    setError(null);
    try {
      onSaved(await api<EventFee>(`/events/${eventId}/fee-included`, { method: 'PUT', body: { included } }));
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Could not save');
    } finally {
      setBusy(false);
    }
  }
  const option = (value: boolean, title: string, sub: string) => (
    <button type="button" role="radio" aria-checked={fee.included === value} className="gr-option" disabled={busy || !editable} onClick={() => set(value)}>
      <span className="gr-dot" aria-hidden="true" />
      <span><strong>{title}</strong><span>{sub}</span></span>
    </button>
  );
  const noFee = fee.kind === 'none';
  return (
    <section className="panel panel-pad stack" aria-labelledby="bf-h">
      <div>
        <h2 id="bf-h" className="gr-h">Booking fee</h2>
        <span className="small muted">
          {noFee ? 'No booking fee on your tickets' : `Bantaba’s fee for your tickets: ${fee.summary}`}
          {fee.deal?.endsAt ? ` until ${day(fee.deal.endsAt)}. Then ${fee.deal.then?.summary ?? 'the usual fee'}.` : '.'}
        </span>
      </div>
      {!noFee && (
        <div role="radiogroup" aria-labelledby="bf-h" className="stack" style={{ gap: 8 }}>
          {option(false, 'Buyers pay it on top', `A D500 ticket costs the buyer ${money(sample + f, 'GMD')}. You get D500.`)}
          {option(true, 'Include it in my prices', `A D500 ticket costs the buyer D500. You get ${money(sample - f, 'GMD')}.`)}
        </div>
      )}
      {error && <div className="notice notice-error" role="alert">{error}</div>}
      {!noFee && <span className="small faint">Applies to new orders. Free tickets never have a fee.</span>}
    </section>
  );
}

// Phase 27 (docs/host-rework.md): this tab watches sales. Adding and
// changing ticket types happens in the event form, so there's one place for it.
export function TicketsTab({ d, onChange }: { d: EventDashboard; onChange: () => void }) {
  const feeApi = useApi<EventFee>(`/events/${d.event.id}/booking-fee`);
  const [feeSaved, setFeeSaved] = useState<EventFee | null>(null);
  const fee = feeSaved ?? feeApi.data;
  // What the buyer pays and what the host gets for one ticket at this price.
  const split = (price: number) => {
    const f = fee ? feeForTicket(fee, price) : 0;
    return fee?.included ? { buyer: price, host: price - f, fee: f } : { buyer: price + f, host: price, fee: f };
  };
  const [error, setError] = useState<string | null>(null);
  const editable = d.event.status !== 'CANCELLED' && d.event.status !== 'COMPLETED';
  const seated = d.ticketTypes.some((t) => t.seated);

  async function toggle(id: string, isActive: boolean) {
    setError(null);
    try {
      await api(`/ticket-types/${id}`, { method: 'PUT', body: { isActive } });
      onChange();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Could not update the ticket type');
    }
  }

  return (
    <div className="stack-l">
      <section className="panel">
        <div className="panel-head tt-head">
          <h2>Ticket types</h2>
          {seated && <Link className="btn btn-quiet btn-small" href="?tab=seating" scroll={false}>Seating map</Link>}
          {editable && <Link className="btn btn-small" href={`/organizer/events/${d.event.id}/edit#entry`}>{d.ticketTypes.length ? 'Edit tickets' : 'Add tickets'}</Link>}
        </div>
        {error && <div className="notice notice-error" role="alert" style={{ margin: '0 20px 12px' }}>{error}</div>}
        {d.ticketTypes.length === 0 ? (
          <div className="empty"><p>No ticket types yet. Add at least one before publishing.</p></div>
        ) : (
          <div className="table-wrap">
            <table>
              <thead>
                <tr><th>Ticket</th><th className="right">Buyer pays</th><th className="right">You get</th><th>Sold</th><th className="right">Sales</th><th>On sale</th></tr>
              </thead>
              <tbody>
                {d.ticketTypes.map((t) => {
                  const share = t.quantityTotal ? Math.min(1, t.sold / t.quantityTotal) : 0;
                  const soldOut = t.quantityTotal > 0 && t.remaining <= 0;
                  return (
                    <tr key={t.id}>
                      <td>
                        <b>{t.name}</b>
                        <span className="cell-sub">
                          {t.seated ? `Seated · ${t.sections} ${t.sections === 1 ? 'section' : 'sections'}` : 'Standing'}
                          {t.accessZone ? ` · ${t.accessZone.name} zone` : ''}
                          {t.salesEnd ? ` · until ${day(t.salesEnd)}` : ''}
                        </span>
                      </td>
                      <td className="right num">{t.price ? money(split(t.price).buyer, t.currency) : 'Free'}</td>
                      <td className="right num">{t.price ? money(split(t.price).host, t.currency) : <span className="faint">—</span>}</td>
                      <td style={{ minWidth: 150 }}>
                        <span className="small"><b>{t.sold.toLocaleString()}</b> / {t.quantityTotal.toLocaleString()}{t.reservedPending ? <span className="faint"> · {t.reservedPending} held</span> : null}</span>
                        <span className="hl-bar"><span style={{ width: `${Math.round(share * 100)}%` }} /></span>
                      </td>
                      <td className="right num">{t.revenue ? money(t.revenue, t.currency) : <span className="faint">—</span>}</td>
                      <td>
                        <div className="row" style={{ gap: 8, flexWrap: 'nowrap' }}>
                          <span className={`badge ${soldOut ? 'badge-red' : t.isActive ? 'badge-green' : 'badge-gold'}`}>{soldOut ? 'Sold out' : t.isActive ? 'On sale' : 'Paused'}</span>
                          {editable && !soldOut && (
                            <button className="link-btn small" onClick={() => toggle(t.id, !t.isActive)}>{t.isActive ? 'Pause' : 'Resume'}</button>
                          )}
                        </div>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </section>
      {fee && <BookingFeeCard eventId={d.event.id} fee={fee} editable={editable} onSaved={setFeeSaved} />}
    </div>
  );
}
