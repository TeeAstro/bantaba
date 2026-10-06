'use client';

import { useEffect, useMemo, useState } from 'react';
import { api, ApiError } from '@/lib/api';
import { useApi } from '@/lib/hooks';
import { dateTime } from '@/lib/format';
import { describeFee, Fee, FeeKind, feeFor } from '@/lib/fees';
import { Icon } from '@/components/Icon';
import { ErrorNotice, Loading } from '@/components/ui';
import { BarChart, dalasiShort } from '@/components/BarChart';

// Admin Fees (Phase 20 and 20b, docs/payments.md, "Booking fee"): what
// Bantaba earns in booking fees, the fee itself with a preview, whether a
// buyer's refund keeps it, and deals for hosts and single events.
// Designed on the "Bantaba Host screens" canvas (Fees, FeesEarnings, FeesDeal).

type Priced = Fee & { summary: string };
interface Deal {
  for: 'host' | 'event';
  organizer: { id: string; name: string; verified: boolean } | null;
  event: { id: string; name: string; startDate: string; host: string } | null;
  fee: Priced;
  note: string | null;
  endsAt: string | null;
  ended: boolean;
  since: string;
}
interface FeeView {
  fee: Priced;
  lastChanged: { at: string; by: string | null } | null;
  keepOnRefund: boolean;
  deals: Deal[];
}
type Period = 'today' | '7d' | '30d' | 'year';
interface Earnings {
  period: { name: Period; from: string; to: string; bucket: 'hour' | 'day' | 'month' };
  totals: { earned: number; charged: number; givenBack: number; paidTickets: number; perTicket: number };
  series: { at: string; fees: number }[];
  changes: { at: string; to: string | null }[];
  hosts: { organizer: { id: string; name: string }; paidTickets: number; fees: number; deal: { summary: string; endsAt: string | null } | null; includesFee: boolean }[];
}

// Inputs are in dalasi; the API takes butut.
const toD = (minor: number) => String(minor / 100);
const toMinor = (d: string) => Math.round(Number(d || 0) * 100);
const num = (v: string) => {
  const n = Number(v);
  return Number.isFinite(n) && n >= 0 ? n : NaN;
};
const D = (minor: number) => 'D' + (minor / 100).toLocaleString('en-GB', { maximumFractionDigits: 2 });
const initials = (name: string) => name.split(/\s+/).filter(Boolean).slice(0, 2).map((w) => w[0].toUpperCase()).join('');

const SAMPLES: { label: string; price: number; quantity: number }[] = [
  { label: 'Free ticket', price: 0, quantity: 1 },
  { label: '1 × D100', price: 10_000, quantity: 1 },
  { label: '1 × D250', price: 25_000, quantity: 1 },
  { label: '4 × D250', price: 25_000, quantity: 4 },
  { label: '1 × D1,000', price: 100_000, quantity: 1 },
];

function Money({ label, value, onChange, error, placeholder, suffix }: { label: string; value: string; onChange: (v: string) => void; error?: string; placeholder?: string; suffix?: string }) {
  return (
    <label className="fee-field">
      <span>{label}</span>
      <span className={`fee-input${error ? ' fee-input-bad' : ''}`}>
        {!suffix && <span className="faint">D</span>}
        <input type="number" min="0" step={suffix ? '0.5' : '1'} inputMode="decimal" value={value} placeholder={placeholder} onChange={(e) => onChange(e.target.value)} />
        {suffix && <span className="faint">{suffix}</span>}
      </span>
      {error && <span className="fee-err">{error}</span>}
    </label>
  );
}

function BookingFee({ view, onSaved, onClose }: { view: FeeView; onSaved: (v: FeeView, summary: string) => void; onClose: () => void }) {
  const f = view.fee;
  const [kind, setKind] = useState<Exclude<FeeKind, 'none'>>(f.kind === 'none' ? 'order' : f.kind);
  const [orderAmt, setOrderAmt] = useState(f.kind === 'order' ? toD(f.amount) : '50');
  const [ticketAmt, setTicketAmt] = useState(f.kind === 'ticket' ? toD(f.amount) : '25');
  const [pct, setPct] = useState(f.kind === 'pct' ? String(f.percentBp / 100) : '5');
  const [flat, setFlat] = useState(f.kind === 'pct' ? toD(f.amount) : '10');
  const [cap, setCap] = useState(f.kind === 'pct' && f.cap !== null ? toD(f.cap) : f.kind === 'pct' ? '' : '100');
  const [confirming, setConfirming] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Guardrails: a typo shouldn't overcharge every buyer (the server checks too).
  const orderErr = !(num(orderAmt) <= 500) ? 'At most D500 an order' : '';
  const ticketErr = !(num(ticketAmt) <= 500) ? 'At most D500 a ticket' : '';
  const pctErr = !(num(pct) <= 20) ? 'At most 20%' : !(num(flat) <= 500) || (cap !== '' && !(num(cap) <= 500)) ? 'At most D500 a ticket' : '';
  const err = kind === 'order' ? orderErr : kind === 'ticket' ? ticketErr : pctErr;

  const fee: Fee = useMemo(
    () =>
      kind === 'order'
        ? { kind, amount: toMinor(orderAmt), percentBp: 0, cap: null }
        : kind === 'ticket'
          ? { kind, amount: toMinor(ticketAmt), percentBp: 0, cap: null }
          : { kind, amount: toMinor(flat), percentBp: Math.round(Number(pct || 0) * 100), cap: cap === '' ? null : toMinor(cap) },
    [kind, orderAmt, ticketAmt, pct, flat, cap],
  );
  const summary = describeFee(fee);
  const changed = summary !== f.summary;
  const edit = (set: (v: string) => void) => (v: string) => {
    set(v);
    setConfirming(false);
  };

  async function save() {
    setBusy(true);
    setError(null);
    try {
      const v = await api<FeeView>('/admin/fees', { method: 'PUT', body: fee });
      setConfirming(false);
      onSaved(v, v.fee.summary);
    } catch (e) {
      setError(e instanceof ApiError ? e.message : 'Could not save');
    } finally {
      setBusy(false);
    }
  }

  return (
    <section className="panel" aria-labelledby="fee-h">
      <div className="panel-head">
        <h2 id="fee-h">Change the booking fee</h2>
        <button className="btn btn-quiet btn-small" onClick={onClose}>Close</button>
      </div>
      <div className="fee-grid">
        <div className="panel-pad stack">
          <div className="stack" style={{ gap: 8 }}>
            <strong className="small">How it’s worked out</strong>
            <div className="segmented" role="group" aria-label="How the fee is worked out">
              {(
                [
                  ['order', 'Per order'],
                  ['ticket', 'Per ticket'],
                  ['pct', 'Percentage + flat'],
                ] as const
              ).map(([k, l]) => (
                <button key={k} type="button" aria-pressed={kind === k} onClick={() => { setKind(k); setConfirming(false); }}>{l}</button>
              ))}
            </div>
          </div>
          {kind === 'order' && <Money label="Per order" value={orderAmt} onChange={edit(setOrderAmt)} error={orderErr} />}
          {kind === 'ticket' && <Money label="Per ticket" value={ticketAmt} onChange={edit(setTicketAmt)} error={ticketErr} />}
          {kind === 'pct' && (
            <>
              <div className="fee-three">
                <Money label="Percentage" value={pct} onChange={edit(setPct)} suffix="%" />
                <Money label="Plus, per ticket" value={flat} onChange={edit(setFlat)} />
                <Money label="At most, per ticket" value={cap} onChange={edit(setCap)} placeholder="No cap" />
              </div>
              {pctErr && <span className="fee-err">{pctErr}</span>}
            </>
          )}
          <p className="fee-info"><Icon name="warn" size={16} />Free tickets never pay a fee. Orders already placed keep the fee they were charged.</p>
          {error && <div className="notice notice-error" role="alert">{error}</div>}
          {confirming ? (
            <div className="fee-confirm">
              <span>From now on, new orders pay <strong>{summary}</strong>.</span>
              <div className="row">
                <button className="btn" onClick={save} disabled={busy}>{busy ? 'Saving…' : 'Save fee'}</button>
                <button className="btn btn-quiet" onClick={() => setConfirming(false)}>Back</button>
              </div>
            </div>
          ) : (
            <div><button className="btn" disabled={!!err || !changed} onClick={() => setConfirming(true)}>Save changes</button></div>
          )}
        </div>
        <div className="panel-pad fee-preview">
          <strong className="small">What buyers pay on top</strong>
          <table>
            <thead>
              <tr><th>Order</th><th className="num">Tickets</th><th className="num">Fee</th><th className="num">Buyer pays</th></tr>
            </thead>
            <tbody>
              {SAMPLES.map((r) => {
                const amount = err ? 0 : feeFor(fee, [r]);
                return (
                  <tr key={r.label}>
                    <td>{r.label}</td>
                    <td className="num">{D(r.price * r.quantity)}</td>
                    <td className="num fee-amt">{amount ? D(amount) : '—'}</td>
                    <td className="num"><strong>{D(r.price * r.quantity + amount)}</strong></td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      </div>
    </section>
  );
}


const PERIODS: { id: Period; label: string }[] = [
  { id: 'today', label: 'Today' },
  { id: '7d', label: '7 days' },
  { id: '30d', label: '30 days' },
  { id: 'year', label: 'This year' },
];
const slotLabel = (iso: string, bucket: Earnings['period']['bucket']) => {
  const d = new Date(iso);
  if (bucket === 'hour') return d.toLocaleTimeString('en-GB', { timeZone: 'UTC', hour: '2-digit', minute: '2-digit' });
  if (bucket === 'month') return d.toLocaleDateString('en-GB', { timeZone: 'UTC', month: 'short' });
  return d.toLocaleDateString('en-GB', { timeZone: 'UTC', day: 'numeric', month: 'short' });
};
const day = (iso: string, year = false) => new Date(iso).toLocaleDateString('en-GB', { day: 'numeric', month: 'short', ...(year ? { year: 'numeric' } : {}) });

function EarningsPanel({ period, setPeriod }: { period: Period; setPeriod: (p: Period) => void }) {
  const { data: e, error, reload } = useApi<Earnings>(`/admin/fees/earnings?period=${period}`);
  // Before/after the last fee change in the period: the average per slot.
  const change = e?.changes[e.changes.length - 1];
  const split = change && e ? e.series.findIndex((x) => new Date(x.at) > new Date(change.at)) : -1;
  const avg = (xs: { fees: number }[]) => (xs.length ? Math.round(xs.reduce((n, x) => n + x.fees, 0) / xs.length) : 0);
  const per = e?.period.bucket === 'hour' ? 'an hour' : e?.period.bucket === 'month' ? 'a month' : 'a day';
  return (
    <section className="panel" aria-labelledby="earn-h">
      <div className="panel-head">
        <h2 id="earn-h">Booking fees earned</h2>
        <div className="segmented" role="radiogroup" aria-label="Period">
          {PERIODS.map((x) => <button key={x.id} role="radio" aria-checked={x.id === period} onClick={() => setPeriod(x.id)}>{x.label}</button>)}
        </div>
      </div>
      <div className="panel-pad stack">
        {error && <ErrorNotice message={error} onRetry={reload} />}
        {!e && !error && <Loading />}
        {e && (
          <>
            <div className="fee-tiles">
              <div><strong className="num">{D(e.totals.earned)}</strong><span>Booking fees earned</span></div>
              <div><strong className="num">{e.totals.paidTickets.toLocaleString('en-GB')}</strong><span>Paid tickets</span></div>
              <div><strong className="num">{D(e.totals.perTicket)}</strong><span>Average per ticket</span></div>
              <div><strong className="num">{D(e.totals.givenBack)}</strong><span>Given back in refunds</span></div>
            </div>
            <BarChart
              label={`Booking fees ${e.period.bucket === 'hour' ? 'per hour' : e.period.bucket === 'month' ? 'per month' : 'per day'}`}
              slots={e.series.map((x) => ({ label: slotLabel(x.at, e.period.bucket), value: x.fees, future: new Date(x.at) > new Date() }))}
              format={D}
              axisFormat={dalasiShort}
              height={170}
              labelEvery={e.period.bucket === 'hour' ? 4 : e.period.bucket === 'month' ? 1 : e.series.length > 10 ? 7 : 1}
            />
            {change && (
              <p className="small muted fee-change">
                Fee changed {change.to ? <>to <strong>{change.to}</strong> </> : ''}on {day(change.at)}.
                {split > 0 && <> Average {per} before: <strong>{D(avg(e.series.slice(0, split)))}</strong>. After: <strong>{D(avg(e.series.slice(split).filter((x) => new Date(x.at) <= new Date())))}</strong>.</>}
              </p>
            )}
          </>
        )}
      </div>
      {e && e.hosts.length > 0 && (
        <div className="table-wrap fee-byhost">
          <table>
            <thead>
              <tr><th>Host</th><th className="right">Paid tickets</th><th className="right">Fees</th><th>Fee</th></tr>
            </thead>
            <tbody>
              {e.hosts.map((h) => (
                <tr key={h.organizer.id}>
                  <td><strong>{h.organizer.name}</strong></td>
                  <td className="right num">{h.paidTickets.toLocaleString('en-GB')}</td>
                  <td className="right num">{D(h.fees)}</td>
                  <td>
                    {h.deal ? <span className="badge badge-blue">{h.deal.summary}{h.deal.endsAt ? ` until ${day(h.deal.endsAt)}` : ''}</span> : <span className="muted small">Bantaba’s fee</span>}
                    {h.includesFee && <span className="badge badge-gold" style={{ marginLeft: 6 }}>Includes fee</span>}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </section>
  );
}

function RefundRule({ keep, onSaved }: { keep: boolean; onSaved: (v: FeeView) => void }) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  async function set(keepFee: boolean) {
    if (keepFee === keep || busy) return;
    setBusy(true);
    setError(null);
    try {
      onSaved(await api<FeeView>('/admin/fees/refunds', { method: 'PUT', body: { keepFee } }));
    } catch (e) {
      setError(e instanceof ApiError ? e.message : 'Could not save');
    } finally {
      setBusy(false);
    }
  }
  const option = (value: boolean, title: string, sub: string) => (
    <button type="button" role="radio" aria-checked={keep === value} className="gr-option" disabled={busy} onClick={() => set(value)}>
      <span className="gr-dot" aria-hidden="true" />
      <span><strong>{title}</strong><span>{sub}</span></span>
    </button>
  );
  return (
    <section className="panel panel-pad stack" aria-labelledby="ref-h">
      <h2 id="ref-h" className="gr-h">When a buyer asks for a refund</h2>
      <div role="radiogroup" aria-labelledby="ref-h" className="stack" style={{ gap: 8 }}>
        {option(false, 'Give the fee back', 'They get everything they paid for that ticket.')}
        {option(true, 'Keep the fee', 'They get the ticket price back. The refund screen says so.')}
      </div>
      {error && <div className="notice notice-error" role="alert">{error}</div>}
      <span className="small faint">Cancelled or changed events: the fee always goes back.</span>
    </section>
  );
}

type Choice = { id: string; name: string; sub: string };

function AddDeal({ taken, onSaved, onClose }: { taken: string[]; onSaved: (v: FeeView) => void; onClose: () => void }) {
  const [target, setTarget] = useState<'host' | 'event'>('host');
  const [q, setQ] = useState('');
  const [found, setFound] = useState<Choice[]>([]);
  const [chosen, setChosen] = useState<Choice | null>(null);
  const [kind, setKind] = useState<FeeKind>('none');
  const [amt, setAmt] = useState('10');
  const [pct, setPct] = useState('3');
  const [flat, setFlat] = useState('5');
  const [until, setUntil] = useState('');
  const [note, setNote] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    const term = q.trim();
    if (chosen || term.length < 2) return setFound([]);
    const t = setTimeout(() => {
      const req =
        target === 'host'
          ? api<{ id: string; businessName: string; user?: { email: string } }[]>(`/admin/organizers?q=${encodeURIComponent(term)}`).then((rows) => rows.map((r) => ({ id: r.id, name: r.businessName, sub: r.user?.email ?? '' })))
          : api<{ items: { id: string; name: string; startDate: string; organizer?: { businessName: string } }[] }>(`/events?search=${encodeURIComponent(term)}&limit=8`, { auth: false }).then((r) =>
              r.items.map((x) => ({ id: x.id, name: x.name, sub: `${x.organizer?.businessName ?? ''} · ${new Date(x.startDate).toLocaleDateString('en-GB', { weekday: 'short', day: 'numeric', month: 'short' })}` })),
            );
      req.then((rows) => setFound(rows.filter((r) => !taken.includes(r.id)).slice(0, 6))).catch(() => setFound([]));
    }, 250);
    return () => clearTimeout(t);
  }, [q, chosen, taken, target]);

  const fee: Fee =
    kind === 'none' ? { kind, amount: 0, percentBp: 0, cap: null }
    : kind === 'pct' ? { kind, amount: toMinor(flat), percentBp: Math.round(Number(pct || 0) * 100), cap: null }
    : { kind, amount: toMinor(amt), percentBp: 0, cap: null };
  const bad = kind === 'pct' ? !(num(pct) <= 20) || !(num(flat) <= 500) : kind !== 'none' && !(num(amt) <= 500);
  const today = new Date().toISOString().slice(0, 10);

  async function save() {
    if (!chosen) return;
    setBusy(true);
    setError(null);
    try {
      const body = { ...fee, note: note.trim() || undefined, endsAt: until ? new Date(`${until}T23:59:59Z`).toISOString() : null };
      onSaved(await api<FeeView>(`/admin/fees/${target === 'host' ? 'hosts' : 'events'}/${chosen.id}`, { method: 'PUT', body }));
    } catch (e) {
      setError(e instanceof ApiError ? e.message : 'Could not save');
      setBusy(false);
    }
  }

  return (
    <div className="modal-backdrop" role="presentation" onClick={(e) => e.target === e.currentTarget && !busy && onClose()}>
      <div className="modal" role="dialog" aria-modal="true" aria-labelledby="deal-h">
        <div className="spread"><h2 id="deal-h" style={{ margin: 0 }}>Add a deal</h2><button className="btn btn-quiet btn-small" aria-label="Close" onClick={onClose}><Icon name="close" size={16} /></button></div>
        <div className="stack" style={{ gap: 6 }}>
          <strong className="small" style={{ display: 'block' }}>For</strong>
          <div className="segmented" role="group" aria-label="For">
            {(['host', 'event'] as const).map((k) => <button key={k} type="button" aria-pressed={target === k} onClick={() => { setTarget(k); setChosen(null); setQ(''); }}>{k === 'host' ? 'A host' : 'One event'}</button>)}
          </div>
        </div>
        <div className="field" style={{ position: 'relative' }}>
          <label htmlFor="deal-q">{target === 'host' ? 'Host' : 'Event'}</label>
          {chosen ? (
            <div className="fee-chosen"><span><strong>{chosen.name}</strong><span className="small muted">{chosen.sub}</span></span><button type="button" className="btn btn-quiet btn-small" onClick={() => { setChosen(null); setQ(''); }}>Change</button></div>
          ) : (
            <>
              <input id="deal-q" autoFocus placeholder={target === 'host' ? 'Type a host’s name' : 'Type an event’s name'} value={q} onChange={(e) => setQ(e.target.value)} />
              {found.length > 0 && (
                <ul className="vs-found" role="listbox">
                  {found.map((o) => <li key={o.id}><button type="button" onClick={() => setChosen(o)}>{o.name}<span className="small muted"> · {o.sub}</span></button></li>)}
                </ul>
              )}
            </>
          )}
        </div>
        <div className="stack" style={{ gap: 6 }}>
          <strong className="small" style={{ display: 'block' }}>Fee</strong>
          <div className="segmented" role="group" aria-label="Fee">
            {(
              [
                ['none', 'No fee'],
                ['order', 'Per order'],
                ['ticket', 'Per ticket'],
                ['pct', 'Percentage'],
              ] as const
            ).map(([k, l]) => <button key={k} type="button" aria-pressed={kind === k} onClick={() => setKind(k)}>{l}</button>)}
          </div>
        </div>
        {(kind === 'order' || kind === 'ticket') && <Money label={kind === 'order' ? 'Per order' : 'Per ticket'} value={amt} onChange={setAmt} error={!(num(amt) <= 500) ? 'At most D500' : ''} />}
        {kind === 'pct' && (
          <div className="fee-three">
            <Money label="Percentage" value={pct} onChange={setPct} suffix="%" error={!(num(pct) <= 20) ? 'At most 20%' : ''} />
            <Money label="Plus, per ticket" value={flat} onChange={setFlat} />
          </div>
        )}
        <div className="field">
          <label htmlFor="deal-until">Until <span className="faint">(optional)</span></label>
          <input id="deal-until" type="date" min={today} value={until} onChange={(e) => setUntil(e.target.value)} style={{ maxWidth: 200 }} />
          <span className="small muted">{until ? 'Then the usual fee applies.' : target === 'event' ? 'No date: until the event.' : 'No date: until you remove it.'}</span>
        </div>
        <div className="field">
          <label htmlFor="deal-note">Why <span className="faint">(only admins see this)</span></label>
          <input id="deal-note" maxLength={120} placeholder={target === 'event' ? 'e.g. charity match' : 'e.g. launch partner'} value={note} onChange={(e) => setNote(e.target.value)} />
        </div>
        {chosen && !bad && (
          <div className="fee-say">
            Buyers pay <strong>{kind === 'none' ? 'no booking fee' : describeFee(fee)}</strong> for {chosen.name}{until ? ` until ${day(`${until}T12:00:00Z`, true)}` : ''}.
          </div>
        )}
        {error && <div className="notice notice-error" role="alert">{error}</div>}
        <div className="row" style={{ justifyContent: 'flex-end' }}>
          <button className="btn btn-quiet" onClick={onClose}>Cancel</button>
          <button className="btn" onClick={save} disabled={busy || !chosen || bad}>{busy ? 'Saving…' : 'Save deal'}</button>
        </div>
      </div>
    </div>
  );
}

function Deals({ view, setView }: { view: FeeView; setView: (v: FeeView) => void }) {
  const [adding, setAdding] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const live = view.deals.filter((d) => !d.ended);

  async function remove(d: Deal) {
    setError(null);
    try {
      setView(await api<FeeView>(d.event ? `/admin/fees/events/${d.event.id}` : `/admin/fees/hosts/${d.organizer!.id}`, { method: 'DELETE' }));
    } catch (e) {
      setError(e instanceof ApiError ? e.message : 'Could not remove');
    }
  }
  const left = (iso: string) => Math.max(0, Math.ceil((new Date(iso).getTime() - Date.now()) / 86_400_000));

  return (
    <section className="panel" aria-labelledby="deals-h">
      <div className="panel-head">
        <div>
          <div className="row" style={{ gap: 10 }}><h2 id="deals-h">Deals</h2>{live.length > 0 && <span className="badge">{live.length}</span>}</div>
          <span className="small muted">Hosts and events with their own fee. Everyone else pays the booking fee.</span>
        </div>
        <button className="btn btn-small" onClick={() => setAdding(true)}><Icon name="plus" size={16} /> Add a deal</button>
      </div>
      {error && <div className="panel-pad"><div className="notice notice-error" role="alert">{error}</div></div>}
      {view.deals.length === 0 ? (
        <div className="panel-pad"><p className="muted">No deals. Every host pays the booking fee.</p></div>
      ) : (
        <div className="table-wrap">
          <table>
            <thead>
              <tr><th>For</th><th>Fee</th><th>Until</th><th>Why</th><th /></tr>
            </thead>
            <tbody>
              {view.deals.map((d) => (
                <tr key={d.event?.id ?? d.organizer!.id} className={d.ended ? 'fee-ended' : ''}>
                  <td>
                    <strong>{d.event?.name ?? d.organizer!.name}</strong>
                    <span className="small muted"> · {d.event ? `event, ${day(d.event.startDate)}` : 'host'}</span>
                  </td>
                  <td><span className={`badge ${d.ended ? '' : d.fee.kind === 'none' ? 'badge-green' : 'badge-blue'}`}>{d.fee.kind === 'none' ? 'No fee' : d.fee.summary}</span></td>
                  <td className="small">
                    {d.ended ? `Ended ${d.endsAt ? day(d.endsAt) : ''}` : d.endsAt ? <>{day(d.endsAt, true)} <span className="muted">· {left(d.endsAt)} days left</span></> : d.event ? 'The event' : 'No end date'}
                  </td>
                  <td className="small">{d.note ?? <span className="faint">—</span>}</td>
                  <td className="num">{!d.ended && <button className="btn btn-quiet btn-small" onClick={() => remove(d)}>Remove</button>}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
      {adding && <AddDeal taken={live.map((d) => d.event?.id ?? d.organizer!.id)} onSaved={(v) => { setView(v); setAdding(false); }} onClose={() => setAdding(false)} />}
    </section>
  );
}

export default function FeesPage() {
  const { data, error, reload } = useApi<FeeView>('/admin/fees');
  const [view, setView] = useState<FeeView | null>(null);
  const [saved, setSaved] = useState<string | null>(null);
  const [editing, setEditing] = useState(false);
  const [period, setPeriod] = useState<Period>('30d');
  useEffect(() => {
    if (data) setView(data);
  }, [data]);

  if (error) return <ErrorNotice message={error} onRetry={reload} />;
  if (!view) return <Loading />;

  return (
    <div className="stack-l">
      <div className="page-head">
        <div><h1>Fees</h1></div>
      </div>

      {saved && <div className="notice notice-ok" role="status">Saved. New orders pay {saved}.</div>}

      <div className="fee-layout">
        <EarningsPanel key={saved ?? ''} period={period} setPeriod={setPeriod} />
        <div className="stack">
          <section className="panel panel-pad stack" aria-labelledby="cur-h">
            <h2 id="cur-h" className="gr-h">Booking fee</h2>
            <div className="fee-current">
              <strong>{view.fee.summary.split(', at most')[0]}</strong>
              <span className="small muted">
                {view.fee.cap !== null && view.fee.kind === 'pct' ? `At most ${D(view.fee.cap)} a ticket. ` : ''}Free tickets: no fee.
              </span>
            </div>
            <span className="small faint">{view.lastChanged ? `Changed ${dateTime(view.lastChanged.at)}${view.lastChanged.by ? ` by ${view.lastChanged.by}` : ''}` : 'Not changed yet (from the server settings)'}</span>
            {!editing && <div><button className="btn btn-quiet btn-small" onClick={() => { setEditing(true); setSaved(null); }}>Change</button></div>}
          </section>
          <RefundRule keep={view.keepOnRefund} onSaved={setView} />
        </div>
      </div>

      {editing && <BookingFee key={view.fee.summary} view={view} onClose={() => setEditing(false)} onSaved={(v, s) => { setView(v); setSaved(s); setEditing(false); }} />}

      <Deals view={view} setView={setView} />
    </div>
  );
}
