'use client';

import Link from 'next/link';
import { useState } from 'react';
import { api, ApiError } from '@/lib/api';
import { useApi } from '@/lib/hooks';
import { EventDashboard, RefundRow } from '@/lib/types';
import { dateTime, money } from '@/lib/format';
import { ErrorNotice, Loading, StatusBadge } from '@/components/ui';

// Phase 13: refund requests to decide, and every refund for the event.
// docs/refunds-transfers.md

const POLICY: Record<string, string> = {
  NONE: 'No refunds on request',
  ANYTIME: 'Refunds on request until the event starts',
  UNTIL_DAYS_BEFORE: 'Refunds on request until',
};
const KIND: Record<string, string> = { CUSTOMER_REQUEST: 'Requested', ORGANIZER: 'Refunded by you', EVENT_CANCELLED: 'Event cancelled' };

function Request({ r, onDone }: { r: RefundRow; onDone: () => void }) {
  const [mode, setMode] = useState<'idle' | 'reject'>('idle');
  const [note, setNote] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function decide(action: 'approve' | 'reject') {
    if (action === 'reject' && !note.trim()) return setError('Tell the customer why.');
    setBusy(true);
    setError(null);
    try {
      await api(`/refunds/${r.id}/${action}`, { method: 'POST', body: note.trim() ? { note: note.trim() } : {} });
      onDone();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : `Could not ${action}`);
      setBusy(false);
    }
  }

  return (
    <div className="request">
      <div className="spread" style={{ alignItems: 'flex-start' }}>
        <div>
          <div style={{ fontWeight: 650 }}>{r.customer.fullName ?? r.customer.email}</div>
          <div className="small muted">{r.customer.fullName ? r.customer.email : ''} · asked {dateTime(r.createdAt)}</div>
        </div>
        <div className="num" style={{ fontWeight: 700, fontSize: 18 }}>{money(r.amount, r.currency)}</div>
      </div>
      <ul className="request-tickets">
        {r.tickets.map((t) => (
          <li key={t.id}>{t.ticketType}{t.seat ? `, ${t.seat}` : ''} <span className="faint">{money(t.amount, r.currency)}</span></li>
        ))}
        {r.feeAmount > 0 && <li className="faint">Booking fee {money(r.feeAmount, r.currency)} (event cancelled)</li>}
      </ul>
      {r.reason && <p className="small" style={{ marginBottom: 10 }}><span className="faint">Reason:</span> {r.reason}</p>}
      {error && <div className="notice notice-error" role="alert" style={{ marginBottom: 10 }}>{error}</div>}
      {mode === 'reject' ? (
        <div className="stack-s">
          <div className="field">
            <label htmlFor={`note-${r.id}`}>Why are you declining? (sent to the customer)</label>
            <textarea id={`note-${r.id}`} rows={2} maxLength={500} value={note} onChange={(e) => setNote(e.target.value)} />
          </div>
          <div className="row">
            <button className="btn btn-danger btn-small" disabled={busy} onClick={() => decide('reject')}>Decline request</button>
            <button className="btn btn-quiet btn-small" disabled={busy} onClick={() => { setMode('idle'); setError(null); }}>Back</button>
          </div>
        </div>
      ) : (
        <div className="row">
          <button className="btn btn-small" disabled={busy} onClick={() => decide('approve')}>{busy ? 'Approving…' : 'Approve refund'}</button>
          <button className="btn btn-quiet btn-small" disabled={busy} onClick={() => setMode('reject')}>Decline…</button>
          <span className="small faint">Approving stops these tickets working and puts them back on sale.</span>
        </div>
      )}
    </div>
  );
}

export function RefundsTab({ d, onChange }: { d: EventDashboard; onChange: () => void }) {
  const { data, error, loading, reload } = useApi<RefundRow[]>(`/events/${d.event.id}/refunds`);
  const done = () => {
    reload();
    onChange();
  };
  if (error) return <ErrorNotice message={error} onRetry={reload} />;
  if (loading && !data) return <Loading />;
  const rows = data ?? [];
  const requests = rows.filter((r) => r.status === 'REQUESTED');
  const others = rows.filter((r) => r.status !== 'REQUESTED');
  const s = d.settings;
  const cur = d.summary.currency;

  return (
    <div className="stack-l">
      <dl className="stats">
        <div className="stat"><dt>Refunded</dt><dd className="num">{money(d.refunds.refunded, cur)}</dd><p className="sub">approved or paid back</p></div>
        <div className="stat"><dt>Requests to decide</dt><dd className="num">{d.refunds.requests}</dd><p className="sub">from ticket holders</p></div>
        <div className="stat"><dt>Being paid back</dt><dd className="num">{d.refunds.awaitingPayout}</dd><p className="sub">approved, money not yet returned</p></div>
      </dl>

      <p className="small muted">
        Policy: <b>{POLICY[s.refundPolicy]}{s.refundPolicy === 'UNTIL_DAYS_BEFORE' ? ` ${s.refundDaysBefore} day${s.refundDaysBefore === 1 ? '' : 's'} before the event` : ''}</b>.{' '}
        {d.event.status === 'CANCELLED'
          ? s.cancellationRefundMode === 'AUTOMATIC'
            ? 'The event was cancelled and everyone was refunded automatically.'
            : 'The event was cancelled and you’re handling refunds: ticket holders can request one at any time.'
          : 'If you change the date or venue, people who bought before can always request a refund.'}{' '}
        <Link href={`/organizer/events/${d.event.id}/edit`}>Change policy</Link> · To refund tickets yourself, select them in the <Link href={`/organizer/events/${d.event.id}?tab=attendees`}>Attendees</Link> tab.
      </p>

      <section className="panel">
        <div className="panel-head"><h2>Requests to decide</h2></div>
        {requests.length === 0 ? (
          <div className="empty"><p>No refund requests waiting.</p></div>
        ) : (
          <div className="panel-pad stack">{requests.map((r) => <Request key={r.id} r={r} onDone={done} />)}</div>
        )}
      </section>

      <section className="panel">
        <div className="panel-head"><h2>All refunds</h2></div>
        {others.length === 0 ? (
          <div className="empty"><p>No refunds yet.</p></div>
        ) : (
          <div className="table-wrap">
            <table>
              <thead>
                <tr><th>Customer</th><th>Tickets</th><th>Why</th><th>Status</th><th className="right">Amount</th></tr>
              </thead>
              <tbody>
                {others.map((r) => (
                  <tr key={r.id}>
                    <td>{r.customer.fullName ?? r.customer.email}<span className="cell-sub">{dateTime(r.decidedAt ?? r.createdAt)}</span></td>
                    <td className="small">{r.tickets.map((t) => t.ticketType).join(', ') || '—'}{r.feeAmount > 0 && <span className="cell-sub">incl. booking fee</span>}</td>
                    <td className="small">{KIND[r.kind]}{r.decisionNote && <span className="cell-sub">“{r.decisionNote}”</span>}</td>
                    <td>
                      <StatusBadge status={r.status} />
                      <span className="cell-sub">
                        {r.status === 'APPROVED' ? (r.method === 'MANUAL' ? 'to be paid back by hand' : r.lastError ? 'provider refund failed; admin will retry' : 'being returned') : r.status === 'PROCESSED' ? `paid back ${r.processedAt ? dateTime(r.processedAt) : ''}` : ''}
                      </span>
                    </td>
                    <td className="right num">{money(r.amount, r.currency)}</td>
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
