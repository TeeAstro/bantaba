'use client';

import Link from 'next/link';
import { useRouter, useSearchParams } from 'next/navigation';
import { FormEvent, Suspense, useCallback, useEffect, useState } from 'react';
import { api, ApiError } from '@/lib/api';
import { useAttention } from '@/lib/admin';
import { dateTime, label, money } from '@/lib/format';
import { AdminSupportThread, ago } from '@/lib/help';
import { ErrorNotice, Loading } from '@/components/ui';

// Admin → Support (Phase 25, docs/support.md): messages from buyers and
// hosts, with their order or event beside each one. Replies go by email.

type Tab = 'open' | 'waiting' | 'closed';
interface Row { id: string; ref: string; name: string; fromRole: 'buyer' | 'host'; subject: string; status: string; lastAt: string }
interface List { counts: Record<Tab, number>; threads: Row[] }

const ORDER_STATUS: Record<string, string> = { PAID: 'Paid', PENDING: 'Waiting for payment', CANCELLED: 'Not paid (closed)', REFUNDED: 'Refunded', PARTIALLY_REFUNDED: 'Part refunded' };

function SupportInbox() {
  const router = useRouter();
  const params = useSearchParams();
  const { refresh } = useAttention();
  const [tab, setTab] = useState<Tab>('open');
  const [list, setList] = useState<List | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [current, setCurrent] = useState<AdminSupportThread | null>(null);
  const [reply, setReply] = useState('');
  const [busy, setBusy] = useState(false);
  const [actionError, setActionError] = useState<string | null>(null);
  const selected = params.get('thread');

  const load = useCallback(() => {
    api<List>(`/admin/support?status=${tab}`).then(setList).catch((e: ApiError) => setError(e.message));
  }, [tab]);
  useEffect(load, [load]);

  useEffect(() => {
    if (!selected) return setCurrent(null);
    setActionError(null);
    api<AdminSupportThread>(`/admin/support/${selected}`).then(setCurrent).catch((e: ApiError) => setActionError(e.message));
  }, [selected]);

  const pick = (id: string) => router.replace(`/admin/support?thread=${id}`, { scroll: false });

  async function act(path: 'reply' | 'close' | 'reopen', e?: FormEvent) {
    e?.preventDefault();
    if (!current) return;
    setBusy(true);
    setActionError(null);
    try {
      const t = await api<AdminSupportThread>(`/admin/support/${current.id}/${path}`, { method: 'POST', ...(path === 'reply' ? { body: { message: reply.trim() } } : {}) });
      setCurrent(t);
      if (path === 'reply') setReply('');
      load();
      refresh();
    } catch (err) {
      setActionError(err instanceof ApiError ? err.message : 'Could not do that');
    } finally {
      setBusy(false);
    }
  }

  if (error) return <ErrorNotice message={error} onRetry={load} />;

  const c = current?.context;
  return (
    <div>
      <div className="page-head">
        <div>
          <h1>Support</h1>
          <p className="muted">Messages from buyers and hosts. Replies go by email.</p>
        </div>
        <div className="segmented" role="tablist" aria-label="Status">
          {(['open', 'waiting', 'closed'] as Tab[]).map((t) => (
            <button key={t} type="button" role="tab" aria-checked={tab === t} onClick={() => setTab(t)}>
              {t === 'open' ? `Open${list ? ` (${list.counts.open})` : ''}` : t === 'waiting' ? 'Waiting on them' : 'Closed'}
            </button>
          ))}
        </div>
      </div>

      <div className="support-grid">
        <section className="panel support-list" aria-label="Messages">
          {!list ? <Loading /> : list.threads.length === 0 ? (
            <p className="muted" style={{ padding: 20 }}>{tab === 'open' ? 'Nothing waiting. 🎉' : 'None.'}</p>
          ) : list.threads.map((r) => (
            <button key={r.id} type="button" aria-pressed={selected === r.id} onClick={() => pick(r.id)}>
              <span className="support-row-top"><b>{r.name}</b><span className="small muted">{ago(r.lastAt)}</span></span>
              <span className="support-row-sub"><span className={`who who-${r.fromRole}`}>{r.fromRole === 'host' ? 'Host' : 'Buyer'}</span><span>{r.subject}</span></span>
            </button>
          ))}
        </section>

        <section className="panel support-thread-panel">
          {!current ? (
            <p className="muted" style={{ padding: 20 }}>{actionError ?? 'Choose a message.'}</p>
          ) : (
            <>
              <div className="support-head">
                <div>
                  <b>{current.subject}</b>
                  <div className="small muted">
                    {current.person.name ?? current.person.email} · <a href={`mailto:${current.person.email}`}>{current.person.email}</a>{current.person.phone ? ` · ${current.person.phone}` : ''} · {current.ref}
                  </div>
                </div>
                {current.status === 'CLOSED'
                  ? <button className="btn btn-quiet" disabled={busy} onClick={() => act('reopen')}>Reopen</button>
                  : <button className="btn btn-quiet" disabled={busy} onClick={() => act('close')}>Close</button>}
              </div>
              {(c?.order || c?.event || current.person.organizerId) && (
                <dl className="support-ctx">
                  {c?.order && <div><dt>Order</dt><dd>{c.order.short}</dd></div>}
                  {c?.event && <div><dt>Event</dt><dd>{c.event.name} · {dateTime(c.event.startDate)}</dd></div>}
                  {c?.order && <div><dt>Amount</dt><dd>{c.order.total === 0 ? 'Free' : money(c.order.total, c.order.currency)} · {c.order.tickets} ticket{c.order.tickets === 1 ? '' : 's'}</dd></div>}
                  {c?.order && <div><dt>Paid with</dt><dd>{c.order.payment ? `${label(c.order.payment.provider)}${c.order.payment.gateway ? ` (${label(c.order.payment.gateway)})` : ''}` : '—'}</dd></div>}
                  {c?.order && <div><dt>Status</dt><dd className={c.order.status === 'PENDING' ? 'warn' : ''}>{ORDER_STATUS[c.order.status] ?? c.order.status}</dd></div>}
                  {current.person.organizerId && <div><dt>Host</dt><dd><Link href={`/admin/organizers/${current.person.organizerId}`}>Open host</Link></dd></div>}
                </dl>
              )}
              <ol className="support-thread">
                {current.messages.map((m) => (
                  <li key={m.id} className={m.fromBantaba ? 'is-me' : 'is-them'}>
                    <span className="small">{m.fromBantaba ? `Bantaba${m.by ? ` (${m.by})` : ''}` : current.person.name ?? 'Them'} · {dateTime(m.at)}</span>
                    <p>{m.body}</p>
                  </li>
                ))}
              </ol>
              <form className="support-reply" onSubmit={(e) => act('reply', e)}>
                <textarea aria-label="Reply" placeholder="Write a reply…" rows={3} maxLength={4000} value={reply} onChange={(e) => setReply(e.target.value)} />
                {actionError && <div className="notice notice-error" role="alert">{actionError}</div>}
                <div className="row" style={{ justifyContent: 'space-between' }}>
                  <span className="small muted">Sent to {current.person.email}</span>
                  <button className="btn" disabled={busy || !reply.trim()}>{busy ? 'Sending…' : 'Send reply'}</button>
                </div>
              </form>
            </>
          )}
        </section>
      </div>
    </div>
  );
}

export default function SupportPage() {
  return (
    <Suspense fallback={<Loading />}>
      <SupportInbox />
    </Suspense>
  );
}
