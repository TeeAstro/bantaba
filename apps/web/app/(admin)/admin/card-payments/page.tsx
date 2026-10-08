'use client';

import { useState } from 'react';
import { api } from '@/lib/api';
import { useApi } from '@/lib/hooks';
import { CardFlag, useAttention, waitingFor } from '@/lib/admin';
import { dateTime, label, money } from '@/lib/format';
import { ErrorNotice, Loading } from '@/components/ui';
import { ActionModal } from '@/components/admin/ActionModal';
import { ListPager, ListSearch, useListTools } from '@/components/admin/ListTools';

// docs/payments.md, "Paid after the order closed": a card payment came
// through after the reservation lapsed. The customer was charged but has
// no tickets, so the money goes back by hand from the Modem Pay dashboard.
export default function CardPaymentsPage() {
  const [state, setState] = useState<'open' | 'resolved'>('open');
  const { data, error, loading, reload } = useApi<CardFlag[]>(`/admin/card-flags?state=${state}`);
  const { refresh } = useAttention();
  const [resolving, setResolving] = useState<CardFlag | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const lt = useListTools(data, (f) => `${f.customer.fullName ?? ''} ${f.customer.email} ${f.event.name} ${f.chargeId ?? ''} ${f.providerReference ?? ''}`);

  return (
    <div className="stack-l">
      <div className="hl-head">
        <h1>Card payments with no tickets</h1>
        <ListSearch value={lt.term} onChange={lt.setTerm} placeholder="Buyer, event or charge" />
      </div>
      <div className="row" style={{ justifyContent: 'space-between' }}>
        <p className="small muted" style={{ margin: 0 }}>Charged after their order had closed. Refund each one in the Modem Pay dashboard, then record it here.</p>
        <div className="segmented" role="group" aria-label="Show">
          <button type="button" aria-pressed={state === 'open'} onClick={() => { setState('open'); setNotice(null); }}>To refund</button>
          <button type="button" aria-pressed={state === 'resolved'} onClick={() => { setState('resolved'); setNotice(null); }}>Refunded</button>
        </div>
      </div>

      {notice && <div className="notice notice-ok" role="status">{notice}</div>}
      {error && <ErrorNotice message={error} onRetry={reload} />}
      {loading && !data && <Loading />}

      {data && (
        <section className="panel">
          {lt.total === 0 ? (
            <div className="empty"><p>{lt.term ? 'Nothing matches.' : state === 'open' ? 'None. Every card payment has its tickets.' : 'Nothing refunded yet.'}</p></div>
          ) : (
            <div className="table-wrap">
              <table>
                <thead>
                  <tr><th>Customer</th><th>Event</th><th className="num">Charged</th><th>Modem Pay</th><th>{state === 'open' ? 'Flagged' : 'Refunded'}</th><th /></tr>
                </thead>
                <tbody>
                  {lt.shown.map((f) => (
                    <tr key={f.paymentId}>
                      <td><b>{f.customer.fullName ?? f.customer.email}</b><span className="cell-sub">{f.customer.fullName ? f.customer.email : ''}</span></td>
                      <td>{f.event.name}<span className="cell-sub">order {label(f.order.status).toLowerCase()}</span></td>
                      <td className="num"><strong>{money(f.amount, f.currency)}</strong></td>
                      <td className="small">
                        {f.chargeId ? <>charge <code>{f.chargeId}</code></> : <span className="faint">no charge id</span>}
                        {f.providerReference && <span className="cell-sub">ref {f.providerReference}</span>}
                      </td>
                      <td className="num small">
                        {state === 'open' ? (
                          <>{dateTime(f.flaggedAt)}<span className="cell-sub">{waitingFor(f.flaggedAt)} ago</span></>
                        ) : f.resolution ? (
                          <>{dateTime(f.resolution.at)}<span className="cell-sub">ref {f.resolution.reference}</span>{f.resolution.note && <span className="cell-sub">{f.resolution.note}</span>}</>
                        ) : null}
                      </td>
                      <td>
                        {f.status === 'OPEN' && (
                          <div className="row row-end"><button className="btn btn-small" onClick={() => setResolving(f)}>Record refund</button></div>
                        )}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
          <ListPager page={lt.page} pageSize={lt.pageSize} total={lt.total} onPage={lt.setPage} />
        </section>
      )}

      {resolving && (
        <ActionModal
          title={`Record the ${money(resolving.amount)} refund`}
          confirmLabel="Record refund"
          field={{ label: 'Modem Pay refund reference', required: true }}
          onClose={() => setResolving(null)}
          onConfirm={async (reference) => {
            await api(`/admin/card-flags/${resolving.paymentId}/resolve`, { method: 'POST', body: { reference } });
            setNotice(`Recorded the refund to ${resolving.customer.email}.`);
            reload();
            refresh();
          }}
        >
          <p className="small">{resolving.customer.email} · {resolving.event.name}{resolving.chargeId ? <> · charge <code>{resolving.chargeId}</code></> : null}</p>
          <p className="small muted">First refund the charge in the Modem Pay dashboard. This only records that you did; no money moves from here.</p>
        </ActionModal>
      )}
    </div>
  );
}
