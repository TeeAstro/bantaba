'use client';

import Link from 'next/link';
import { Suspense, useState } from 'react';
import { usePathname, useRouter, useSearchParams } from 'next/navigation';
import { api } from '@/lib/api';
import { useApi } from '@/lib/hooks';
import { AdminRefund, Paged, useAttention, waitingFor } from '@/lib/admin';
import { dateTime, label, money } from '@/lib/format';
import { ErrorNotice, Loading, Pager, StatusBadge } from '@/components/ui';
import { ActionModal } from '@/components/admin/ActionModal';

const VIEWS = {
  manual: { label: 'To pay by hand', query: 'status=APPROVED&method=MANUAL&pageSize=100' },
  failed: { label: 'Failed', query: 'status=APPROVED&method=PROVIDER&pageSize=100' },
  all: { label: 'All', query: '' },
} as const;
type View = keyof typeof VIEWS;

function RefundsList() {
  const params = useSearchParams();
  const router = useRouter();
  const pathname = usePathname();
  const view = ((params.get('view') as View) in VIEWS ? params.get('view') : 'manual') as View;
  const [page, setPage] = useState(1);
  const path = `/admin/refunds?${VIEWS[view].query}${view === 'all' ? `page=${page}&pageSize=50` : ''}`;
  const { data, error, loading, reload } = useApi<Paged<AdminRefund>>(path);
  const { attention, refresh } = useAttention();
  const [act, setAct] = useState<{ kind: 'paid' | 'retry'; r: AdminRefund } | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [running, setRunning] = useState(false);

  // "Failed" = provider refunds the provider refused (they keep an error until retried).
  const items = data ? (view === 'failed' ? data.items.filter((r) => r.lastError) : data.items) : null;
  const after = (msg: string) => {
    setNotice(msg);
    reload();
    refresh();
  };
  const counts: Partial<Record<View, number>> = { manual: attention?.counts.manualRefundsToPay, failed: attention?.counts.failedProviderRefunds };

  return (
    <div className="stack-l">
      <div className="page-head">
        <div>
          <h1>Refunds</h1>
          <p className="muted">Money owed back to customers. Organizers approve refunds; admins make sure the money arrives.</p>
        </div>
        <button className="btn btn-quiet" disabled={running} onClick={async () => {
          setRunning(true);
          try {
            const r = await api<{ processed: number }>('/admin/refunds/run', { method: 'POST' });
            after(r.processed ? `${r.processed} provider ${r.processed === 1 ? 'refund' : 'refunds'} sent.` : 'No provider refunds were due.');
          } catch (e) {
            setNotice(e instanceof Error ? e.message : 'Failed');
          } finally {
            setRunning(false);
          }
        }}>{running ? 'Sending…' : 'Send due provider refunds now'}</button>
      </div>

      <nav className="tabs" aria-label="Refunds">
        {(Object.keys(VIEWS) as View[]).map((v) => (
          <a key={v} href={`${pathname}?view=${v}`} aria-current={view === v ? 'page' : undefined}
            onClick={(e) => { e.preventDefault(); setNotice(null); setPage(1); router.replace(`${pathname}?view=${v}`); }}>
            {VIEWS[v].label}{counts[v] ? ` (${counts[v]})` : ''}
          </a>
        ))}
      </nav>

      {view === 'manual' && <p className="small muted">Bank-transfer and card refunds, and partial Wave refunds, are paid back by hand (bank transfer, Wave, or the Modem Pay dashboard for cards). Record each one once the money has gone; the customer is emailed.</p>}
      {view === 'failed' && <p className="small muted">The payment provider refused these. Check the error: retry, or pay the customer by hand and record it.</p>}

      {notice && <div className="notice notice-ok" role="status">{notice}</div>}
      {error && <ErrorNotice message={error} onRetry={reload} />}
      {loading && !data && <Loading />}

      {items && (
        <section className="panel">
          {items.length === 0 ? (
            <div className="empty"><p>{view === 'manual' ? 'No refunds waiting to be paid.' : view === 'failed' ? 'No failed refunds.' : 'No refunds yet.'}</p></div>
          ) : (
            <div className="table-wrap">
              <table>
                <thead>
                  <tr><th>Customer</th><th>Event</th><th className="num">Amount</th><th>Paid with</th><th>Status</th><th>Approved</th><th /></tr>
                </thead>
                <tbody>
                  {items.map((r) => (
                    <tr key={r.id}>
                      <td>{r.customer?.fullName ?? r.customer?.email ?? '—'}<span className="cell-sub">{r.customer?.email}</span></td>
                      <td>{r.order.event?.name ?? '—'}<span className="cell-sub">{r.tickets.length} {r.tickets.length === 1 ? 'ticket' : 'tickets'}{r.feeAmount ? ' + booking fee' : ''}</span></td>
                      <td className="num"><strong>{money(r.amount, r.currency)}</strong></td>
                      <td>{label(r.provider)}<span className="cell-sub">{r.method === 'MANUAL' ? 'by hand' : 'through the provider'}</span></td>
                      <td>
                        <StatusBadge status={r.status} />
                        {r.lastError && <span className="cell-warn">{r.lastError}</span>}
                        {r.reference && <span className="cell-sub">ref {r.reference}</span>}
                      </td>
                      <td className="num small">
                        {r.decidedAt ? dateTime(r.decidedAt) : dateTime(r.createdAt)}
                        {r.status === 'APPROVED' && r.decidedAt && <span className="cell-sub">{waitingFor(r.decidedAt)} ago</span>}
                      </td>
                      <td>
                        <div className="row row-end">
                          {r.status === 'APPROVED' && r.method === 'PROVIDER' && r.lastError && (
                            <button className="btn btn-quiet btn-small" onClick={() => setAct({ kind: 'retry', r })}>Retry</button>
                          )}
                          {r.status === 'APPROVED' && (r.method === 'MANUAL' || r.lastError) && (
                            <button className="btn btn-small" onClick={() => setAct({ kind: 'paid', r })}>Record as paid</button>
                          )}
                        </div>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
          {view === 'all' && data && <div className="panel-pad"><Pager page={data.page} pageSize={data.pageSize} total={data.total} onPage={setPage} /></div>}
        </section>
      )}

      {act?.kind === 'paid' && (
        <ActionModal
          title={`Record ${money(act.r.amount)} as paid back`}
          confirmLabel="Record as paid"
          field={{ label: 'Reference of the money sent back', required: true, hint: 'Bank transfer or Wave reference, or the Modem Pay refund id.' }}
          onClose={() => setAct(null)}
          onConfirm={async (reference) => {
            await api(`/admin/refunds/${act.r.id}/mark-paid`, { method: 'POST', body: { reference } });
            after(`Recorded. ${act.r.customer?.email ?? 'The customer'} has been emailed.`);
          }}
        >
          <p className="small">To {act.r.customer?.fullName ?? act.r.customer?.email} · {act.r.order.event?.name} · paid with {label(act.r.provider)}</p>
          <p className="small muted">Only record it once the money has actually gone.</p>
        </ActionModal>
      )}
      {act?.kind === 'retry' && (
        <ActionModal
          title={`Retry ${money(act.r.amount)} refund?`}
          confirmLabel="Retry now"
          onClose={() => setAct(null)}
          onConfirm={async () => {
            const r = await api<AdminRefund>(`/admin/refunds/${act.r.id}/retry`, { method: 'POST' });
            after(r.status === 'PROCESSED' ? 'Refund sent.' : r.lastError ? `Still failing: ${r.lastError}` : 'Retry queued.');
          }}
        >
          <p className="small muted">Last error: {act.r.lastError}</p>
        </ActionModal>
      )}

      <p className="small faint">Refunds for a single event are also on that event’s page in the organizer app. <Link href="/admin/audit?entityType=Refund">Refund history in the audit log</Link>.</p>
    </div>
  );
}

export default function RefundsPage() {
  return (
    <Suspense fallback={<Loading />}>
      <RefundsList />
    </Suspense>
  );
}
