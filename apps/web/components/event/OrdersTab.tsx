'use client';

import { useEffect, useState } from 'react';
import { useApi } from '@/lib/hooks';
import { OrderRow, Paged } from '@/lib/types';
import { dateTime, label, money } from '@/lib/format';
import { ErrorNotice, Loading, Pager, StatusBadge } from '@/components/ui';

const STATUSES = ['', 'PAID', 'PENDING', 'CANCELLED', 'REFUNDED'];

// Debounce free-text search so typing doesn't fire a request per key.
export function useDebounced(value: string, ms = 300) {
  const [v, setV] = useState(value);
  useEffect(() => {
    const t = setTimeout(() => setV(value), ms);
    return () => clearTimeout(t);
  }, [value, ms]);
  return v;
}

export function OrdersTab({ eventId }: { eventId: string }) {
  const [status, setStatus] = useState('');
  const [search, setSearch] = useState('');
  const [page, setPage] = useState(1);
  const q = useDebounced(search);
  const qs = new URLSearchParams({ page: String(page), pageSize: '25', ...(status ? { status } : {}), ...(q ? { search: q } : {}) });
  const { data, error, loading, reload } = useApi<Paged<OrderRow>>(`/events/${eventId}/orders?${qs}`);

  return (
    <section className="panel">
      <div className="panel-head">
        <h2>Orders</h2>
        <div className="row">
          <input aria-label="Search orders" placeholder="Search name, email or order ID" value={search} onChange={(e) => { setSearch(e.target.value); setPage(1); }} style={{ width: 260 }} />
          <select aria-label="Filter by status" value={status} onChange={(e) => { setStatus(e.target.value); setPage(1); }} style={{ width: 150 }}>
            {STATUSES.map((s) => <option key={s} value={s}>{s ? label(s) : 'All statuses'}</option>)}
          </select>
        </div>
      </div>
      <div className="panel-pad stack">
        {error && <ErrorNotice message={error} onRetry={reload} />}
        {loading && !data && <Loading />}
        {data && (data.items.length === 0 ? (
          <div className="empty"><p>{q || status ? 'No orders match.' : 'No orders yet.'}</p></div>
        ) : (
          <>
            <div className="table-wrap">
              <table>
                <thead>
                  <tr><th>Customer</th><th>Items</th><th>Status</th><th>Payment</th><th className="right">Total</th><th>Placed</th></tr>
                </thead>
                <tbody>
                  {data.items.map((o) => (
                    <tr key={o.id}>
                      <td>{o.customer.fullName ?? o.customer.email}<span className="cell-sub">{o.customer.fullName ? o.customer.email : ''} #{o.id.slice(0, 8)}</span></td>
                      <td>{o.items.map((i) => `${i.quantity} × ${i.ticketType}`).join(', ')}</td>
                      <td><StatusBadge status={o.status} /></td>
                      <td className="small">{o.payment ? `${label(o.payment.provider)}` : '—'}</td>
                      <td className="right num">{money(o.total, o.currency)}</td>
                      <td className="num small">{dateTime(o.createdAt)}</td>
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
