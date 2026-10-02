'use client';

import Link from 'next/link';
import { Suspense, useState } from 'react';
import { usePathname, useRouter, useSearchParams } from 'next/navigation';
import { api } from '@/lib/api';
import { useApi } from '@/lib/hooks';
import { AdminPayout, useAttention, waitingFor } from '@/lib/admin';
import { dateTime, money } from '@/lib/format';
import { ErrorNotice, Loading, StatusBadge } from '@/components/ui';
import { ActionModal } from '@/components/admin/ActionModal';

const TABS = [
  { status: 'REQUESTED', label: 'Requests' },
  { status: 'APPROVED', label: 'To send' },
  { status: 'PAID', label: 'Paid' },
  { status: 'REJECTED', label: 'Declined' },
  { status: '', label: 'All' },
];

type Act = { kind: 'approve' | 'reject' | 'paid'; p: AdminPayout };

const where = (p: AdminPayout) => `${p.method === 'WAVE' ? 'Wave' : p.bankName ?? 'Bank'} · ${p.accountNumber} · ${p.accountName}`;

function PayoutsList() {
  const params = useSearchParams();
  const router = useRouter();
  const pathname = usePathname();
  const status = params.get('status') ?? 'REQUESTED';
  const { data, error, loading, reload } = useApi<AdminPayout[]>(`/admin/payouts${status ? `?status=${status}` : ''}`);
  const { attention, refresh } = useAttention();
  const [act, setAct] = useState<Act | null>(null);
  const [notice, setNotice] = useState<string | null>(null);

  const after = (msg: string) => {
    setNotice(msg);
    reload();
    refresh();
  };
  const counts: Record<string, number | undefined> = { REQUESTED: attention?.counts.payoutRequests, APPROVED: attention?.counts.payoutsToSend };

  return (
    <div className="stack-l">
      <div className="page-head">
        <div>
          <h1>Payouts</h1>
          <p className="muted">Approve organizers’ requests, then send the money and record the reference.</p>
        </div>
      </div>

      <nav className="tabs" aria-label="Payout status">
        {TABS.map((t) => (
          <a key={t.label} href={`${pathname}${t.status ? `?status=${t.status}` : '?status='}`} aria-current={status === t.status ? 'page' : undefined}
            onClick={(e) => { e.preventDefault(); setNotice(null); router.replace(`${pathname}?status=${t.status}`); }}>
            {t.label}{counts[t.status] ? ` (${counts[t.status]})` : ''}
          </a>
        ))}
      </nav>

      {notice && <div className="notice notice-ok" role="status">{notice}</div>}
      {error && <ErrorNotice message={error} onRetry={reload} />}
      {loading && !data && <Loading />}

      {data && (
        <section className="panel">
          {data.length === 0 ? (
            <div className="empty"><p>{status === 'REQUESTED' ? 'No payout requests waiting.' : status === 'APPROVED' ? 'Nothing waiting to be sent.' : 'No payouts here.'}</p></div>
          ) : (
            <div className="table-wrap">
              <table>
                <thead>
                  <tr><th>Organizer</th><th className="num">Amount</th><th>Send to</th><th>Status</th><th>{status === 'PAID' ? 'Paid' : 'Requested'}</th><th /></tr>
                </thead>
                <tbody>
                  {data.map((p) => (
                    <tr key={p.id}>
                      <td>
                        <Link href={`/admin/organizers/${p.organizer.id}`}>{p.organizer.businessName}</Link>
                        <span className="cell-sub">{p.organizer.trustLevel === 'NEW' ? 'New organizer' : 'Trusted'}{p.organizer.verificationStatus !== 'APPROVED' ? ` · ${p.organizer.verificationStatus.toLowerCase()}` : ''}</span>
                      </td>
                      <td className="num"><strong>{money(p.amount, p.currency)}</strong></td>
                      <td>
                        <span className="small">{where(p)}</span>
                        {p.accountWarning && <span className="cell-warn">{p.accountWarning}</span>}
                        {p.note && <span className="cell-sub">“{p.note}”</span>}
                      </td>
                      <td>
                        <StatusBadge status={p.status} />
                        {p.autoApproved && <span className="cell-sub">approved automatically</span>}
                        {p.decisionNote && <span className="cell-sub">{p.decisionNote}</span>}
                        {p.reference && <span className="cell-sub">ref {p.reference}</span>}
                      </td>
                      <td className="num small">
                        {dateTime(p.status === 'PAID' && p.paidAt ? p.paidAt : p.requestedAt)}
                        {(p.status === 'REQUESTED' || p.status === 'APPROVED') && <span className="cell-sub">{waitingFor(p.requestedAt)} ago</span>}
                      </td>
                      <td>
                        <div className="row row-end">
                          {p.status === 'REQUESTED' && (
                            <>
                              <button className="btn btn-small" disabled={!!p.accountWarning} title={p.accountWarning ?? undefined} onClick={() => setAct({ kind: 'approve', p })}>Approve</button>
                              <button className="btn btn-quiet btn-small" onClick={() => setAct({ kind: 'reject', p })}>Decline</button>
                            </>
                          )}
                          {p.status === 'APPROVED' && (
                            <button className="btn btn-small" disabled={!!p.accountWarning} title={p.accountWarning ?? undefined} onClick={() => setAct({ kind: 'paid', p })}>Record as sent</button>
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
      )}

      {act?.kind === 'approve' && (
        <ActionModal
          title={`Approve ${money(act.p.amount)} to ${act.p.organizer.businessName}?`}
          confirmLabel="Approve"
          onClose={() => setAct(null)}
          onConfirm={async () => {
            await api(`/admin/payouts/${act.p.id}/approve`, { method: 'POST' });
            after(`Approved. Send ${money(act.p.amount)} and record it under “To send”.`);
          }}
        >
          <p className="small">{where(act.p)}</p>
          <p className="small muted">The organizer is told it’s on its way. Next, send the money and record the reference.</p>
        </ActionModal>
      )}
      {act?.kind === 'reject' && (
        <ActionModal
          title={`Decline ${money(act.p.amount)} to ${act.p.organizer.businessName}`}
          confirmLabel="Decline"
          danger
          field={{ label: 'Reason', required: true, multiline: true, hint: 'Shown to the organizer.' }}
          onClose={() => setAct(null)}
          onConfirm={async (note) => {
            await api(`/admin/payouts/${act.p.id}/reject`, { method: 'POST', body: { note } });
            after('Payout declined. The organizer has been told why.');
          }}
        />
      )}
      {act?.kind === 'paid' && (
        <ActionModal
          title={`Record ${money(act.p.amount)} as sent`}
          confirmLabel="Record as sent"
          field={{ label: 'Wave or bank transfer reference', required: true, placeholder: 'e.g. WV-2610-1234' }}
          onClose={() => setAct(null)}
          onConfirm={async (reference) => {
            await api(`/admin/payouts/${act.p.id}/mark-paid`, { method: 'POST', body: { reference } });
            after(`Recorded as sent to ${act.p.organizer.businessName}.`);
          }}
        >
          <p className="small">{where(act.p)}</p>
          <p className="small muted">Only record it once the money has actually gone. The organizer is emailed the reference.</p>
        </ActionModal>
      )}
    </div>
  );
}

export default function PayoutsPage() {
  return (
    <Suspense fallback={<Loading />}>
      <PayoutsList />
    </Suspense>
  );
}
