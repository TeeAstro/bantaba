'use client';

import { useEffect, useMemo, useState } from 'react';
import { api, ApiError } from '@/lib/api';
import { useApi } from '@/lib/hooks';
import { dateTime } from '@/lib/format';
import { describeFee, Fee, FeeKind, feeFor } from '@/lib/fees';
import { Icon } from '@/components/Icon';
import { ErrorNotice, Loading } from '@/components/ui';

// Admin Fees (Phase 20, docs/payments.md, "Booking fee"): Bantaba's booking
// fee, a preview of what buyers pay, and hosts with their own fee.
// Designed on the "Bantaba Host screens" canvas (Fees).

interface FeeView {
  fee: Fee & { summary: string };
  lastChanged: { at: string; by: string | null } | null;
  hosts: { organizer: { id: string; name: string; verified: boolean }; fee: Fee & { summary: string }; note: string | null; since: string }[];
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

function BookingFee({ view, onSaved }: { view: FeeView; onSaved: (v: FeeView, summary: string) => void }) {
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
        <h2 id="fee-h">Booking fee</h2>
        <span className="small faint">{view.lastChanged ? `Changed ${dateTime(view.lastChanged.at)}${view.lastChanged.by ? ` by ${view.lastChanged.by}` : ''}` : 'Not changed yet: D50 per order'}</span>
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
          <strong className="small">What buyers pay</strong>
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

type Org = { id: string; name: string };

function AddHost({ taken, onSaved, onClose }: { taken: string[]; onSaved: (v: FeeView) => void; onClose: () => void }) {
  const [q, setQ] = useState('');
  const [found, setFound] = useState<Org[]>([]);
  const [host, setHost] = useState<Org | null>(null);
  const [kind, setKind] = useState<'none' | 'ticket' | 'pct'>('none');
  const [amt, setAmt] = useState('10');
  const [pct, setPct] = useState('3');
  const [flat, setFlat] = useState('5');
  const [note, setNote] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    const term = q.trim();
    if (host || term.length < 2) return setFound([]);
    const t = setTimeout(() => {
      api<{ id: string; businessName: string }[]>(`/admin/organizers?q=${encodeURIComponent(term)}`)
        .then((rows) => setFound(rows.map((r) => ({ id: r.id, name: r.businessName })).filter((r) => !taken.includes(r.id)).slice(0, 6)))
        .catch(() => setFound([]));
    }, 250);
    return () => clearTimeout(t);
  }, [q, host, taken]);

  async function add() {
    if (!host) return;
    setBusy(true);
    setError(null);
    const body =
      kind === 'none'
        ? { kind, amount: 0 }
        : kind === 'ticket'
          ? { kind, amount: toMinor(amt) }
          : { kind, amount: toMinor(flat), percentBp: Math.round(Number(pct || 0) * 100), cap: null };
    try {
      onSaved(await api<FeeView>(`/admin/fees/hosts/${host.id}`, { method: 'PUT', body: { ...body, note: note.trim() || undefined } }));
    } catch (e) {
      setError(e instanceof ApiError ? e.message : 'Could not save');
      setBusy(false);
    }
  }

  return (
    <div className="fee-add stack">
      <div className="field" style={{ position: 'relative' }}>
        <label htmlFor="fee-host">Host</label>
        {host ? (
          <div className="row" style={{ gap: 8 }}><strong>{host.name}</strong><button type="button" className="btn btn-quiet btn-small" onClick={() => { setHost(null); setQ(''); }}>Change</button></div>
        ) : (
          <>
            <input id="fee-host" autoFocus placeholder="Type a host’s name" value={q} onChange={(e) => setQ(e.target.value)} />
            {found.length > 0 && (
              <ul className="vs-found" role="listbox">
                {found.map((o) => <li key={o.id}><button type="button" onClick={() => setHost(o)}>{o.name}</button></li>)}
              </ul>
            )}
          </>
        )}
      </div>
      <div className="stack" style={{ gap: 8 }}>
        <strong className="small">Their fee</strong>
        <div className="segmented" role="group" aria-label="Their fee">
          {(
            [
              ['none', 'No fee'],
              ['ticket', 'Per ticket'],
              ['pct', 'Percentage + flat'],
            ] as const
          ).map(([k, l]) => <button key={k} type="button" aria-pressed={kind === k} onClick={() => setKind(k)}>{l}</button>)}
        </div>
      </div>
      {kind === 'ticket' && <Money label="Per ticket" value={amt} onChange={setAmt} error={!(num(amt) <= 500) ? 'At most D500 a ticket' : ''} />}
      {kind === 'pct' && (
        <div className="fee-three">
          <Money label="Percentage" value={pct} onChange={setPct} suffix="%" error={!(num(pct) <= 20) ? 'At most 20%' : ''} />
          <Money label="Plus, per ticket" value={flat} onChange={setFlat} />
        </div>
      )}
      <div className="field">
        <label htmlFor="fee-note">Why <span className="faint">(optional)</span></label>
        <input id="fee-note" maxLength={120} placeholder="e.g. federation matches" value={note} onChange={(e) => setNote(e.target.value)} />
      </div>
      {error && <div className="notice notice-error" role="alert">{error}</div>}
      <div className="row">
        <button className="btn" onClick={add} disabled={busy || !host}>Add</button>
        <button className="btn btn-quiet" onClick={onClose}>Cancel</button>
      </div>
    </div>
  );
}

export default function FeesPage() {
  const { data, error, reload } = useApi<FeeView>('/admin/fees');
  const [view, setView] = useState<FeeView | null>(null);
  const [saved, setSaved] = useState<string | null>(null);
  const [adding, setAdding] = useState(false);
  const [removeError, setRemoveError] = useState<string | null>(null);
  useEffect(() => {
    if (data) setView(data);
  }, [data]);

  if (error) return <ErrorNotice message={error} onRetry={reload} />;
  if (!view) return <Loading />;

  async function remove(id: string) {
    setRemoveError(null);
    try {
      setView(await api<FeeView>(`/admin/fees/hosts/${id}`, { method: 'DELETE' }));
    } catch (e) {
      setRemoveError(e instanceof ApiError ? e.message : 'Could not remove');
    }
  }

  return (
    <div className="stack-l">
      <div className="page-head">
        <div>
          <h1>Fees</h1>
          <p className="muted">The booking fee buyers pay on top of the ticket price.</p>
        </div>
      </div>

      {saved && <div className="notice notice-ok" role="status">Saved. New orders pay {saved}.</div>}

      <BookingFee key={view.fee.summary} view={view} onSaved={(v, s) => { setView(v); setSaved(s); }} />

      <section className="panel" aria-labelledby="hosts-h">
        <div className="panel-head">
          <div className="row" style={{ gap: 10 }}>
            <h2 id="hosts-h">Different fee for a host</h2>
            {view.hosts.length > 0 && <span className="badge">{view.hosts.length}</span>}
          </div>
          {!adding && <button className="btn btn-quiet btn-small" onClick={() => setAdding(true)}><Icon name="plus" size={16} /> Add a host</button>}
        </div>
        <div className="panel-pad stack">
          {adding && <AddHost taken={view.hosts.map((h) => h.organizer.id)} onSaved={(v) => { setView(v); setAdding(false); }} onClose={() => setAdding(false)} />}
          {removeError && <div className="notice notice-error" role="alert">{removeError}</div>}
          {view.hosts.length === 0 && !adding && <p className="muted">Every host uses the fee above.</p>}
          {view.hosts.map((h) => (
            <div key={h.organizer.id} className="fee-host">
              <span className="fee-avatar" aria-hidden="true">{initials(h.organizer.name)}</span>
              <div className="fee-host-name">
                <strong>{h.organizer.name}{h.organizer.verified && <span className="faint small"> · blue tick</span>}</strong>
                <span className="small muted">Since {new Date(h.since).toLocaleDateString('en-GB', { day: 'numeric', month: 'short' })}{h.note ? ` · ${h.note}` : ''}</span>
              </div>
              <span className="fee-host-fee">{h.fee.summary}</span>
              <button className="btn btn-quiet btn-small" onClick={() => remove(h.organizer.id)}>Remove</button>
            </div>
          ))}
        </div>
      </section>
    </div>
  );
}
