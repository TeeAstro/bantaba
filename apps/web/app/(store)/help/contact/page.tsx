'use client';

import Link from 'next/link';
import { FormEvent, useEffect, useState } from 'react';
import { api, ApiError } from '@/lib/api';
import { useSessionUser } from '@/lib/hooks';
import { dalasi, when } from '@/lib/store';
import { SupportThread } from '@/lib/help';
import { StoreFooter, StoreHeader } from '@/components/store/Chrome';

// Send us a message (Phase 25, docs/support.md). Signed-in buyers only, so
// we know who wrote and can show them their orders to choose from.

type Kind = 'order' | 'event' | 'account' | 'other';
const KINDS: [Kind, string][] = [['order', 'An order'], ['event', 'An event'], ['account', 'My account'], ['other', 'Something else']];
interface MyOrder { id: string; status: string; total: number; currency: string; createdAt: string; event: { name: string; startDate: string }; items: { quantity: number }[] }

const ORDER_STATUS: Record<string, [string, string]> = {
  PAID: ['Paid', 's-pill-ok'],
  PENDING: ['Paying', 's-pill-wait'],
  CANCELLED: ['Not paid', 's-pill-off'],
  REFUNDED: ['Refunded', 's-pill-off'],
  PARTIALLY_REFUNDED: ['Part refunded', 's-pill-off'],
};

export default function ContactPage() {
  const user = useSessionUser();
  const buyer = user?.role === 'CUSTOMER';
  const [kind, setKind] = useState<Kind>('order');
  const [orders, setOrders] = useState<MyOrder[] | null>(null);
  const [orderId, setOrderId] = useState<string | null>(null);
  const [message, setMessage] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [sent, setSent] = useState<SupportThread | null>(null);

  useEffect(() => {
    if (!buyer) return;
    api<MyOrder[]>('/orders/mine')
      .then((o) => {
        const recent = o.slice(0, 8);
        setOrders(recent);
        if (recent[0]) setOrderId(recent[0].id);
        else setKind('other');
      })
      .catch(() => setOrders([]));
  }, [buyer]);

  async function send(e: FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError(null);
    try {
      setSent(await api<SupportThread>('/support', { method: 'POST', body: { topic: kind, message: message.trim(), ...(kind === 'order' && orderId ? { orderId } : {}) } }));
    } catch (err) {
      setError((err as ApiError).message);
    } finally {
      setBusy(false);
    }
  }

  return (
    <>
      <StoreHeader back="/help" />
      <main className="s-main s-wrap s-narrow s-help-contact">
        <h1 className="s-h1">Send us a message</h1>
        {user === undefined ? (
          <p className="s-empty">Loading…</p>
        ) : !buyer ? (
          <div className="s-auth">
            <p className="s-note">Sign in first, so we can see your orders and reply to you. We email you a code, no password needed.</p>
            <Link href="/signin?next=/help/contact" className="s-btn s-btn-plum">Sign in</Link>
            {user && <p className="s-note">You’re signed in to Bantaba Host as {user.email}. Hosts write to us from Help in Bantaba Host.</p>}
          </div>
        ) : sent ? (
          <div className="s-help-sent" role="status">
            <strong>Sent ✓</strong>
            <span>We’ll reply to {user.email}, usually within a day. Your reference is <b>{sent.ref}</b>.</span>
            <Link href={`/help/messages/${sent.id}`}>See your message</Link>
          </div>
        ) : (
          <form onSubmit={send} className="s-help-form">
            <fieldset>
              <legend>What’s it about?</legend>
              <div className="s-help-kinds">
                {KINDS.map(([id, label]) => (
                  <button key={id} type="button" aria-pressed={kind === id} onClick={() => setKind(id)}>{label}</button>
                ))}
              </div>
            </fieldset>
            {kind === 'order' && (
              <fieldset>
                <legend>Which order?</legend>
                {!orders ? (
                  <p className="s-note">Loading your orders…</p>
                ) : orders.length === 0 ? (
                  <p className="s-note">You have no orders yet.</p>
                ) : (
                  <div className="s-help-orders">
                    {orders.map((o) => {
                      const [label, cls] = ORDER_STATUS[o.status] ?? [o.status, 's-pill-off'];
                      const n = o.items.reduce((s, i) => s + i.quantity, 0);
                      return (
                        <button key={o.id} type="button" aria-pressed={orderId === o.id} onClick={() => setOrderId(o.id)}>
                          <span>
                            <strong>{o.event.name}</strong>
                            <span className="s-meta">{when(o.event.startDate).short} · {n} ticket{n === 1 ? '' : 's'} · {o.total === 0 ? 'Free' : dalasi(o.total, o.currency)}</span>
                          </span>
                          <span className={`s-pill-st ${cls}`}>{label}</span>
                        </button>
                      );
                    })}
                  </div>
                )}
              </fieldset>
            )}
            <label className="s-help-msgbox">
              <span>Your message</span>
              <textarea required maxLength={4000} rows={5} value={message} onChange={(e) => setMessage(e.target.value)} placeholder={kind === 'order' ? 'e.g. I paid with Wave but my tickets haven’t come.' : 'How can we help?'} />
            </label>
            <span className="s-note">We reply to {user.email}.</span>
            {error && <div className="s-notice s-notice-bad" role="alert">{error}</div>}
            <button className="s-btn s-btn-plum s-btn-block" disabled={busy || !message.trim() || (kind === 'order' && !orderId)}>{busy ? 'Sending…' : 'Send'}</button>
          </form>
        )}
      </main>
      <StoreFooter />
    </>
  );
}
