'use client';

import { useState } from 'react';
import { api, ApiError } from '@/lib/api';
import { useApi } from '@/lib/hooks';
import { AttendeeRow, Paged } from '@/lib/types';
import { dateTime, label, money } from '@/lib/format';
import { ErrorNotice, Loading, Pager, StatusBadge } from '@/components/ui';
import { useDebounced } from './OrdersTab';
import { seatLong } from '@/lib/seating';

const STATUSES = ['', 'ACTIVE', 'USED', 'CANCELLED', 'REFUNDED'];

export function AttendeesTab({ eventId, onChange }: { eventId: string; onChange?: () => void }) {
  const [status, setStatus] = useState('');
  const [search, setSearch] = useState('');
  const [page, setPage] = useState(1);
  const q = useDebounced(search);
  const qs = new URLSearchParams({ page: String(page), pageSize: '25', ...(status ? { status } : {}), ...(q ? { search: q } : {}) });
  const { data, error, loading, reload } = useApi<Paged<AttendeeRow>>(`/events/${eventId}/tickets?${qs}`);
  // Phase 13: refund selected tickets directly.
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [confirming, setConfirming] = useState(false);
  const [reason, setReason] = useState('');
  const [busy, setBusy] = useState(false);
  const [notice, setNotice] = useState<{ ok: boolean; text: string } | null>(null);
  const refundable = (t: AttendeeRow) => t.status === 'ACTIVE' || t.status === 'USED';
  const toggle = (id: string) => setSelected((s) => { const n = new Set(s); n.has(id) ? n.delete(id) : n.add(id); return n; });

  async function refund() {
    setBusy(true);
    setNotice(null);
    try {
      const res = await api<{ amount: number; currency: string }[]>(`/events/${eventId}/refunds`, { method: 'POST', body: { ticketIds: [...selected], ...(reason.trim() ? { reason: reason.trim() } : {}) } });
      const total = res.reduce((s, r) => s + r.amount, 0);
      setNotice({ ok: true, text: `Refunded ${selected.size} ticket${selected.size === 1 ? '' : 's'} (${money(total, res[0]?.currency)}). The buyers are emailed; tickets bought by bank transfer are paid back by hand.` });
      setSelected(new Set());
      setConfirming(false);
      setReason('');
      reload();
      onChange?.();
    } catch (err) {
      setNotice({ ok: false, text: err instanceof ApiError ? err.message : 'Refund failed' });
    } finally {
      setBusy(false);
    }
  }

  return (
    <section className="panel">
      <div className="panel-head">
        <h2>Attendees</h2>
        <div className="row">
          <input aria-label="Search attendees" placeholder="Search name or email" value={search} onChange={(e) => { setSearch(e.target.value); setPage(1); }} style={{ width: 220 }} />
          <select aria-label="Filter by ticket status" value={status} onChange={(e) => { setStatus(e.target.value); setPage(1); }} style={{ width: 170 }}>
            {STATUSES.map((s) => <option key={s} value={s}>{s === 'USED' ? 'Checked in' : s ? label(s) : 'All tickets'}</option>)}
          </select>
        </div>
      </div>
      <div className="panel-pad stack">
        {notice && <div className={`notice ${notice.ok ? 'notice-ok' : 'notice-error'}`} role="status">{notice.text}</div>}
        {selected.size > 0 && (
          <div className="notice notice-info stack-s">
            {!confirming ? (
              <div className="spread">
                <span>{selected.size} ticket{selected.size === 1 ? '' : 's'} selected</span>
                <div className="row">
                  <button className="btn btn-danger btn-small" onClick={() => setConfirming(true)}>Refund selected…</button>
                  <button className="btn btn-quiet btn-small" onClick={() => setSelected(new Set())}>Clear</button>
                </div>
              </div>
            ) : (
              <>
                <p>Refund {selected.size} ticket{selected.size === 1 ? '' : 's'}? They stop working at the gate straight away and go back on sale. Buyers get the ticket price back (not the booking fee) and are emailed.</p>
                <input aria-label="Reason (optional, shown to the buyer)" placeholder="Reason (optional, shown to the buyer)" maxLength={500} value={reason} onChange={(e) => setReason(e.target.value)} />
                <div className="row">
                  <button className="btn btn-danger btn-small" disabled={busy} onClick={refund}>{busy ? 'Refunding…' : `Refund ${selected.size}`}</button>
                  <button className="btn btn-quiet btn-small" disabled={busy} onClick={() => setConfirming(false)}>Back</button>
                </div>
              </>
            )}
          </div>
        )}
        {error && <ErrorNotice message={error} onRetry={reload} />}
        {loading && !data && <Loading />}
        {data && (data.items.length === 0 ? (
          <div className="empty"><p>{q || status ? 'No tickets match.' : 'No tickets issued yet.'}</p></div>
        ) : (
          <>
            <div className="table-wrap">
              <table>
                <thead>
                  <tr><th style={{ width: 36 }}><span className="sr-only">Select</span></th><th>Ticket holder</th><th>Ticket</th><th>Seat</th><th>Status</th><th>Checked in</th></tr>
                </thead>
                <tbody>
                  {data.items.map((t) => (
                    <tr key={t.id}>
                      <td>{refundable(t) && <input type="checkbox" aria-label={`Select ticket of ${t.owner.email}`} checked={selected.has(t.id)} onChange={() => toggle(t.id)} style={{ width: 'auto' }} />}</td>
                      <td>{t.owner.fullName ?? t.owner.email}<span className="cell-sub">{t.owner.fullName ? t.owner.email : ''}</span></td>
                      <td>{t.ticketType.name}<span className="cell-sub">Bought {dateTime(t.purchasedAt)}</span></td>
                      <td>{t.seat ? `${t.seat.section}, ${seatLong(t.seat.row, t.seat.number)}` : <span className="faint">—</span>}</td>
                      <td><StatusBadge status={t.status} /></td>
                      <td className="small">{t.checkedInAt ? <>{dateTime(t.checkedInAt)}{t.checkedInGate && <span className="cell-sub">{t.checkedInGate}</span>}</> : <span className="faint">Not yet</span>}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            <Pager page={data.page} pageSize={data.pageSize} total={data.total} onPage={setPage} />
          </>
        ))}
      </div>
    </section>
  );
}
