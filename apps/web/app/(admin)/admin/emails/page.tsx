'use client';

import { useState } from 'react';
import { api, ApiError } from '@/lib/api';
import { useApi } from '@/lib/hooks';
import { AdminNotification, actionLabel, Paged, useAttention } from '@/lib/admin';
import { dateTime } from '@/lib/format';
import { ErrorNotice, Loading, Pager } from '@/components/ui';

type Status = 'FAILED' | 'PENDING' | 'SENT' | 'CANCELLED';
const STATUSES: { s: Status; label: string }[] = [
  { s: 'FAILED', label: 'Failed' },
  { s: 'PENDING', label: 'Waiting to send' },
  { s: 'SENT', label: 'Sent' },
  { s: 'CANCELLED', label: 'Cancelled' },
];

// The email outbox (docs/notifications.md).
export default function EmailsPage() {
  const [status, setStatus] = useState<Status>('FAILED');
  const [page, setPage] = useState(1);
  const list = useApi<Paged<AdminNotification>>(`/admin/notifications?status=${status}&page=${page}&pageSize=50`);
  const summary = useApi<Partial<Record<Status, number>>>('/admin/notifications/summary');
  const { refresh } = useAttention();
  const [notice, setNotice] = useState<{ ok: boolean; text: string } | null>(null);
  const [busy, setBusy] = useState<string | null>(null);

  async function run(key: string, fn: () => Promise<string>) {
    setBusy(key);
    setNotice(null);
    try {
      setNotice({ ok: true, text: await fn() });
      list.reload();
      summary.reload();
      refresh();
    } catch (e) {
      setNotice({ ok: false, text: e instanceof ApiError ? e.message : 'Failed' });
    } finally {
      setBusy(null);
    }
  }

  return (
    <div className="stack-l">
      <div className="page-head">
        <div>
          <h1>Emails</h1>
          <p className="muted">Everything the platform sends: tickets, receipts, refunds, reminders, organizer notices.</p>
        </div>
        <div className="row">
          <button className="btn btn-quiet" disabled={!!busy} onClick={() => run('run', async () => {
            const r = await api<{ handled: number }>('/admin/notifications/run', { method: 'POST' });
            return r.handled ? `Handled ${r.handled} ${r.handled === 1 ? 'email' : 'emails'}.` : 'Nothing was due.';
          })}>{busy === 'run' ? 'Sending…' : 'Send due emails now'}</button>
          <button className="btn btn-quiet" disabled={!!busy} onClick={() => run('scan', async () => {
            const r = await api<{ queued: number }>('/admin/notifications/scan-reminders', { method: 'POST' });
            return r.queued ? `Queued ${r.queued} event ${r.queued === 1 ? 'reminder' : 'reminders'}.` : 'No reminders were due.';
          })}>{busy === 'scan' ? 'Checking…' : 'Queue due reminders'}</button>
        </div>
      </div>

      <nav className="tabs" aria-label="Email status">
        {STATUSES.map(({ s, label }) => (
          <a key={s} href="#" aria-current={status === s ? 'page' : undefined} onClick={(e) => { e.preventDefault(); setStatus(s); setPage(1); setNotice(null); }}>
            {label}{summary.data?.[s] ? ` (${summary.data[s]!.toLocaleString()})` : ''}
          </a>
        ))}
      </nav>

      {notice && <div className={`notice ${notice.ok ? 'notice-ok' : 'notice-error'}`} role="status">{notice.text}</div>}
      {status === 'FAILED' && <p className="small muted">Usually the mail settings or a bad address. Fix the cause first, then retry. Password-reset emails can’t be resent: the person asks for a new link.</p>}
      {list.error && <ErrorNotice message={list.error} onRetry={list.reload} />}
      {list.loading && !list.data && <Loading />}

      {list.data && (
        <section className="panel">
          {list.data.items.length === 0 ? (
            <div className="empty"><p>{status === 'FAILED' ? 'No failed emails.' : 'Nothing here.'}</p></div>
          ) : (
            <div className="table-wrap">
              <table>
                <thead><tr><th>To</th><th>Email</th><th>{status === 'SENT' ? 'Sent' : 'Created'}</th><th className="num">Tries</th><th /></tr></thead>
                <tbody>
                  {list.data.items.map((n) => (
                    <tr key={n.id}>
                      <td className="small">{n.toAddress}</td>
                      <td>
                        {n.subject ?? actionLabel(n.type)}
                        <span className="cell-sub">{actionLabel(n.type)}</span>
                        {n.lastError && <span className="cell-warn">{n.lastError}</span>}
                      </td>
                      <td className="num small">{dateTime(n.sentAt ?? n.createdAt)}</td>
                      <td className="num">{n.attempts}</td>
                      <td>
                        {(n.status === 'FAILED' || n.status === 'CANCELLED') && n.type !== 'password_reset' && (
                          <div className="row row-end">
                            <button className="btn btn-quiet btn-small" disabled={!!busy} onClick={() => run(n.id, async () => {
                              await api(`/admin/notifications/${n.id}/retry`, { method: 'POST' });
                              return `Queued again for ${n.toAddress}. It goes out with the next send.`;
                            })}>{busy === n.id ? '…' : 'Retry'}</button>
                          </div>
                        )}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
          <div className="panel-pad"><Pager page={list.data.page} pageSize={list.data.pageSize} total={list.data.total} onPage={setPage} /></div>
        </section>
      )}
    </div>
  );
}
