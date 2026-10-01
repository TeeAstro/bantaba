'use client';

import { FormEvent, useState } from 'react';
import { api, ApiError } from '@/lib/api';
import { useApi } from '@/lib/hooks';
import { EventDashboard, Venue } from '@/lib/types';
import { label, localInputToIso, money } from '@/lib/format';
import { ErrorNotice } from '@/components/ui';

const CATEGORIES = [
  'REGULAR', 'VIP', 'VVIP', 'EARLY_BIRD', 'STUDENT', 'GROUP', 'FAMILY',
  'GENERAL_ADMISSION', 'BACKSTAGE', 'MEET_AND_GREET', 'SEASON_PASS', 'DAY_PASS',
];

const EMPTY = { name: '', category: 'REGULAR', price: '', quantity: '', sectionId: '', accessZoneId: '', salesStart: '', salesEnd: '' };

export function TicketsTab({ d, onChange }: { d: EventDashboard; onChange: () => void }) {
  const venue = useApi<Venue>(`/venues/${d.event.venue.id}`);
  const [form, setForm] = useState(EMPTY);
  const [error, setError] = useState<string | null>(null);
  const [ok, setOk] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const editable = d.event.status !== 'CANCELLED' && d.event.status !== 'COMPLETED';
  const set = (k: keyof typeof EMPTY) => (e: { target: { value: string } }) => setForm({ ...form, [k]: e.target.value });
  const section = venue.data?.sections.find((s) => s.id === form.sectionId);

  async function add(e: FormEvent) {
    e.preventDefault();
    setError(null);
    setOk(null);
    const price = Math.round(Number(form.price) * 100);
    const quantityTotal = Number(form.quantity);
    if (!Number.isFinite(price) || price < 0) return setError('Enter a price in dalasi, e.g. 250 or 250.50.');
    if (!Number.isInteger(quantityTotal) || quantityTotal < 1) return setError('Quantity must be a whole number, 1 or more.');
    setBusy(true);
    try {
      await api('/ticket-types', {
        method: 'POST',
        body: {
          eventId: d.event.id,
          name: form.name.trim(),
          category: form.category,
          price,
          quantityTotal,
          ...(form.sectionId ? { sectionId: form.sectionId } : {}),
          ...(form.accessZoneId ? { accessZoneId: form.accessZoneId } : {}),
          ...(form.salesStart ? { salesStart: localInputToIso(form.salesStart) } : {}),
          ...(form.salesEnd ? { salesEnd: localInputToIso(form.salesEnd) } : {}),
        },
      });
      setOk(`Added “${form.name.trim()}”.`);
      setForm(EMPTY);
      onChange();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Could not add the ticket type');
    } finally {
      setBusy(false);
    }
  }

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
        <div className="panel-head"><h2>Ticket types</h2></div>
        {d.ticketTypes.length === 0 ? (
          <div className="empty"><p>No ticket types yet. Add at least one before publishing.</p></div>
        ) : (
          <div className="table-wrap">
            <table>
              <thead>
                <tr><th>Name</th><th>Seating</th><th className="right">Price</th><th className="right">Sold</th><th className="right">Total</th><th>Sales</th></tr>
              </thead>
              <tbody>
                {d.ticketTypes.map((t) => (
                  <tr key={t.id}>
                    <td>{t.name}<span className="cell-sub">{label(t.category)}{t.accessZone ? `, ${t.accessZone.name} zone` : ''}</span></td>
                    <td>{t.section ? `Reserved: ${t.section.name}` : 'General admission'}</td>
                    <td className="right num">{money(t.price, t.currency)}</td>
                    <td className="right num">{t.sold}</td>
                    <td className="right num">{t.quantityTotal}</td>
                    <td>
                      <div className="row" style={{ gap: 8 }}>
                        <span className={`badge ${t.isActive ? 'badge-green' : 'badge-gold'}`}>{t.isActive ? 'On sale' : 'Paused'}</span>
                        {editable && (
                          <button className="btn btn-quiet btn-small" onClick={() => toggle(t.id, !t.isActive)}>
                            {t.isActive ? 'Pause sales' : 'Resume sales'}
                          </button>
                        )}
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </section>

      {editable && (
        <section className="panel">
          <div className="panel-head"><h2>Add a ticket type</h2></div>
          <form className="panel-pad form" onSubmit={add}>
            {venue.error && <ErrorNotice message={venue.error} />}
            {error && <div className="notice notice-error" role="alert">{error}</div>}
            {ok && <div className="notice notice-ok" role="status">{ok}</div>}
            {(d.permissions.maxTicketsPerEvent !== null || d.permissions.maxTicketPrice !== null) && (
              <p className="small muted">
                Your account limits: {[d.permissions.maxTicketsPerEvent !== null && `up to ${d.permissions.maxTicketsPerEvent.toLocaleString()} tickets per event (${(d.permissions.maxTicketsPerEvent - d.ticketTypes.reduce((n, t) => n + t.quantityTotal, 0)).toLocaleString()} left)`, d.permissions.maxTicketPrice !== null && `up to ${money(d.permissions.maxTicketPrice, d.summary.currency)} per ticket`].filter(Boolean).join(', ')}.
              </p>
            )}
            <div className="form-grid">
              <div className="field">
                <label htmlFor="tt-name">Name</label>
                <input id="tt-name" required maxLength={100} placeholder="e.g. Early bird" value={form.name} onChange={set('name')} />
              </div>
              <div className="field">
                <label htmlFor="tt-cat">Kind</label>
                <select id="tt-cat" value={form.category} onChange={set('category')}>
                  {CATEGORIES.map((c) => <option key={c} value={c}>{label(c)}</option>)}
                </select>
              </div>
            </div>
            <div className="form-grid">
              <div className="field">
                <label htmlFor="tt-price">Price (dalasi)</label>
                <input id="tt-price" required inputMode="decimal" placeholder="250" value={form.price} onChange={set('price')} />
              </div>
              <div className="field">
                <label htmlFor="tt-qty">How many</label>
                <input id="tt-qty" required inputMode="numeric" placeholder="100" value={form.quantity} onChange={set('quantity')} />
                {section && <span className="hint">{section.name} has {section.seatCount} seats</span>}
              </div>
            </div>
            <div className="form-grid">
              <div className="field">
                <label htmlFor="tt-section">Seating</label>
                <select id="tt-section" value={form.sectionId} onChange={set('sectionId')}>
                  <option value="">General admission (no seat numbers)</option>
                  {venue.data?.sections.map((s) => (
                    <option key={s.id} value={s.id}>Reserved seats in {s.name} ({s.seatCount})</option>
                  ))}
                </select>
                <span className="hint">Can’t be changed after the ticket type is created.</span>
              </div>
              <div className="field">
                <label htmlFor="tt-zone">Access zone <span className="faint">(optional)</span></label>
                <select id="tt-zone" value={form.accessZoneId} onChange={set('accessZoneId')}>
                  <option value="">None (general access)</option>
                  {venue.data?.accessZones.map((z) => <option key={z.id} value={z.id}>{z.name}</option>)}
                </select>
                <span className="hint">Decides which gates let this ticket in.</span>
              </div>
            </div>
            <div className="form-grid">
              <div className="field">
                <label htmlFor="tt-start">Sales open <span className="faint">(optional)</span></label>
                <input id="tt-start" type="datetime-local" value={form.salesStart} onChange={set('salesStart')} />
              </div>
              <div className="field">
                <label htmlFor="tt-end">Sales close <span className="faint">(optional)</span></label>
                <input id="tt-end" type="datetime-local" value={form.salesEnd} onChange={set('salesEnd')} />
              </div>
            </div>
            <div><button className="btn" type="submit" disabled={busy}>{busy ? 'Adding…' : 'Add ticket type'}</button></div>
          </form>
        </section>
      )}
    </div>
  );
}
