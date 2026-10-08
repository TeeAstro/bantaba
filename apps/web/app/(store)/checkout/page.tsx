'use client';

import Link from 'next/link';
import { useRouter, useSearchParams } from 'next/navigation';
import { Suspense, useCallback, useEffect, useRef, useState } from 'react';
import { api, ApiError, logout } from '@/lib/api';
import { useSessionUser } from '@/lib/hooks';
import { Cart, PayResult, StoreEvent, StoreOrder, StoreTicketType, dalasi, eventColour, loadCart, orderKey, refundLine, saveBankNote, saveOrderKey, when } from '@/lib/store';
import { Icon } from '@/components/Icon';
import { CheckoutHeader } from '@/components/store/CheckoutHeader';

// Checkout (Phase 16, docs/storefront.md): the tickets are held for 5
// minutes once the buyer is known (signed in: straight away; a guest: after
// their details), then they choose how to pay.

type Provider = 'WAVE' | 'AFRIMONEY' | 'QMONEY' | 'CARD' | 'BANK_TRANSFER' | 'MOCK';
type Method = { id: Provider; name: string; note: string; logo?: string };
// Phase 23: which methods are on comes from the server (Admin → Ways to
// pay); how each looks lives here. Logos are the companies' own files
// (public/pay); bank transfer and the test payment have icons.
const LOOK: Record<Provider, { note: string; logo?: string }> = {
  WAVE: { note: 'Approve in the Wave app', logo: '/pay/wave.png' },
  AFRIMONEY: { note: 'Approve on your phone', logo: '/pay/afrimoney.png' },
  QMONEY: { note: 'Approve on your phone', logo: '/pay/qmoney.png' },
  CARD: { note: 'Debit or credit' },
  BANK_TRANSFER: { note: 'Pay within 24 hours' },
  MOCK: { note: 'For trying Bantaba out: pays at once, no money moves' },
};

const BUYER_KEY = 'bantaba.buyer';
type Buyer = { fullName: string; email: string; phone: string };
const loadBuyer = (): Buyer => {
  try {
    return { fullName: '', email: '', phone: '', ...JSON.parse(window.localStorage.getItem(BUYER_KEY) ?? '{}') };
  } catch {
    return { fullName: '', email: '', phone: '' };
  }
};

function useCountdown(until: string | null) {
  const [left, setLeft] = useState<number | null>(null);
  useEffect(() => {
    if (!until) return setLeft(null);
    const tick = () => setLeft(Math.max(0, Math.floor((new Date(until).getTime() - Date.now()) / 1000)));
    tick();
    const t = setInterval(tick, 1000);
    return () => clearInterval(t);
  }, [until]);
  return left;
}

function CheckoutInner() {
  const router = useRouter();
  const resume = useSearchParams().get('order');
  const user = useSessionUser();
  const buyerSignedIn = user?.role === 'CUSTOMER';

  const [cart, setCart] = useState<Cart | null>(null);
  const [event, setEvent] = useState<StoreEvent | null>(null);
  const [types, setTypes] = useState<StoreTicketType[]>([]);
  const [order, setOrder] = useState<StoreOrder | null>(null);
  const [buyer, setBuyer] = useState<Buyer>({ fullName: '', email: '', phone: '' });
  const [methods, setMethods] = useState<Method[]>([]);
  const [method, setMethod] = useState<Provider>('WAVE');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [ready, setReady] = useState(false);
  const holding = useRef(false);

  // Ways to pay that are on right now.
  useEffect(() => {
    api<{ id: Provider; name: string }[]>('/payments/methods', { auth: false })
      .then((list) => {
        const known = list.filter((m) => m.id in LOOK).map((m) => ({ ...m, ...LOOK[m.id] }));
        setMethods(known);
        setMethod((cur) => (known.some((m) => m.id === cur) ? cur : known[0]?.id ?? cur));
      })
      .catch(() => setMethods([]));
  }, []);

  // What's being bought: the cart, or an order already held (?order=).
  useEffect(() => {
    setBuyer(loadBuyer());
    (async () => {
      try {
        if (resume) {
          const o = await api<StoreOrder>(`/orders/${resume}`, { headers: orderKey(resume) });
          setOrder(o);
          setEvent(o.event);
        } else {
          const c = loadCart();
          setCart(c);
          if (c) {
            const e = await api<StoreEvent>(`/events/${encodeURIComponent(c.slug)}`);
            setEvent(e);
            setTypes(await api<StoreTicketType[]>(`/events/${e.id}/ticket-types`));
          }
        }
      } catch (err) {
        setError((err as ApiError).message);
      } finally {
        setReady(true);
      }
    })();
  }, [resume]);

  const items = (cart?.items ?? []).map((i) => ({ ...i, type: types.find((t) => t.id === i.ticketTypeId) }));
  const body = (c: Cart) => ({ eventId: c.eventId, items: c.items.map(({ ticketTypeId, quantity, seatIds }) => ({ ticketTypeId, quantity, ...(seatIds?.length ? { seatIds } : {}) })) });

  // Signed-in buyers: hold as soon as the page opens.
  const holdSignedIn = useCallback(async (c: Cart) => {
    if (holding.current) return;
    holding.current = true;
    setBusy(true);
    setError(null);
    try {
      const r = await api<{ order: StoreOrder }>('/orders/checkout', { method: 'POST', body: body(c) });
      setOrder(r.order);
    } catch (err) {
      setError((err as ApiError).message);
    } finally {
      setBusy(false);
    }
  }, []);
  useEffect(() => {
    if (ready && buyerSignedIn && cart && !order && !error) void holdSignedIn(cart);
  }, [ready, buyerSignedIn, cart, order, error, holdSignedIn]);

  async function holdAsGuest(e: React.FormEvent) {
    e.preventDefault();
    if (!cart) return;
    setBusy(true);
    setError(null);
    try {
      const details = { fullName: buyer.fullName.trim(), email: buyer.email.trim(), ...(buyer.phone.trim() ? { phone: buyer.phone.trim() } : {}) };
      const r = await api<{ order: StoreOrder; orderToken: string }>('/orders/guest-checkout', { method: 'POST', body: { ...body(cart), ...details }, auth: false });
      saveOrderKey(r.order.id, r.orderToken);
      try {
        window.localStorage.setItem(BUYER_KEY, JSON.stringify(buyer));
      } catch {
        // fine
      }
      setOrder(r.order);
    } catch (err) {
      setError((err as ApiError).message);
    } finally {
      setBusy(false);
    }
  }

  async function pay() {
    if (!order) return;
    setBusy(true);
    setError(null);
    try {
      const r = await api<PayResult>(`/orders/${order.id}/pay`, { method: 'POST', body: { provider: method }, headers: orderKey(order.id) });
      if (r.redirectUrl) {
        window.location.assign(r.redirectUrl);
        return;
      }
      if (r.instructions) saveBankNote(order.id, r.instructions);
      router.replace(`/checkout/success?order=${order.id}`);
    } catch (err) {
      const e = err as ApiError;
      setError(e.status === 503 ? `${methods.find((m) => m.id === method)?.name ?? 'That way to pay'} isn’t available right now. Choose another way to pay.` : e.message);
      setBusy(false);
    }
  }

  // Already paid or closed (e.g. reopened from the back button): show the order.
  useEffect(() => {
    if (order && order.status !== 'PENDING') router.replace(`/checkout/success?order=${order.id}`);
  }, [order, router]);

  const left = useCountdown(order?.status === 'PENDING' ? order.expiresAt : null);
  const expired = left === 0;
  const back = event ? `/e/${event.slug}` : '/';

  if (!ready) return <><CheckoutHeader back={back} /><main className="s-main"><p className="s-empty">Loading…</p></main></>;

  if (!order && (!cart || !event)) {
    return (
      <>
        <CheckoutHeader back="/" />
        <main className="s-main s-wrap s-narrow s-auth">
          <h1>Nothing to check out</h1>
          {error && <div className="s-notice s-notice-bad" role="alert">{error}</div>}
          <Link href="/" className="s-btn s-btn-quiet">See what’s on</Link>
        </main>
      </>
    );
  }

  if (order && order.status !== 'PENDING') return null; // on its way to the order page

  const ev = order?.event ?? event!;
  const lines = order
    ? order.items.map((i) => {
        const seats = cart?.items.find((c) => c.ticketTypeId === i.ticketTypeId)?.seatLabels ?? loadCart()?.items.find((c) => c.ticketTypeId === i.ticketTypeId)?.seatLabels;
        return { key: i.ticketTypeId, label: `${i.quantity} × ${i.ticketType.name}${seats?.length ? ` (${seats.join(', ')})` : ''}`, amount: i.quantity * i.unitPrice };
      })
    : items.map((i) => ({ key: i.ticketTypeId, label: `${i.quantity} × ${i.type?.name ?? 'Ticket'}${i.seatLabels?.length ? ` (${i.seatLabels.join(', ')})` : ''}`, amount: i.quantity * (i.type?.price ?? 0) }));
  const currency = order?.currency ?? items[0]?.type?.currency ?? 'GMD';
  const d = when(ev.startDate);
  const clock = left === null ? '' : `${Math.floor(left / 60)}:${String(left % 60).padStart(2, '0')}`;
  const total = order ? order.total : lines.reduce((n, l) => n + l.amount, 0);

  return (
    <>
      <CheckoutHeader back={back} />
      {order && !expired && (
        <div className="s-hold" role="status">
          <div className="s-wrap"><Icon name="clock" /><span>Held for <strong>{clock}</strong></span></div>
        </div>
      )}
      {/* Phase 27 (docs/store-rework.md): ways to pay on the left, the order
          and Pay on the right on a computer; on a phone the order is on top
          and Pay sits in the bar at the bottom. */}
      <main className={`s-main s-wrap s-page s-co2${order && !expired ? ' has-pay' : ''}`}>
        <h1>Checkout</h1>
        <div className="s-co2-grid">
          <div className="s-co2-main">
        {error && <div className="s-notice s-notice-bad" role="alert"><Icon name="close" />{error}{!order && <> <Link href={back}>Change tickets</Link></>}</div>}

        {expired ? (
          <section className="s-form">
            <div className="s-notice s-notice-warn" role="alert"><Icon name="clock" />Your hold ran out and the tickets went back on sale.</div>
            <Link href={back} className="s-btn">Choose again</Link>
          </section>
        ) : !order ? (
          buyerSignedIn ? (
            <p className="s-note">{busy ? 'Holding your tickets…' : ''}</p>
          ) : (
            <form className="s-form" onSubmit={holdAsGuest}>
              <div className="s-row" style={{ justifyContent: 'space-between' }}>
                <h2 className="s-h2" style={{ fontSize: 20 }}>Your details</h2>
                <Link href="/signin?next=/checkout" style={{ fontSize: 14, fontWeight: 600 }}>Sign in</Link>
              </div>
              <label className="s-field">Full name
                <input required minLength={2} autoComplete="name" value={buyer.fullName} onChange={(e) => setBuyer({ ...buyer, fullName: e.target.value })} />
              </label>
              <label className="s-field">Email
                <input required type="email" autoComplete="email" value={buyer.email} onChange={(e) => setBuyer({ ...buyer, email: e.target.value })} />
              </label>
              <label className="s-field">Phone number
                <input type="tel" autoComplete="tel" inputMode="tel" placeholder="+220" value={buyer.phone} onChange={(e) => setBuyer({ ...buyer, phone: e.target.value })} />
              </label>
              <button className="s-btn s-btn-block" disabled={busy}>{busy ? 'Holding your tickets…' : 'Continue'}</button>
            </form>
          )
        ) : (
          <>
            {buyerSignedIn ? (
              <div className="s-who"><span>Signed in as</span><strong style={{ overflowWrap: 'anywhere' }}>{user!.email}</strong>
                <button type="button" className="s-link-btn" onClick={() => logout()}>Not you?</button></div>
            ) : buyer.email ? (
              <div className="s-who"><span>Tickets go to</span><strong style={{ overflowWrap: 'anywhere' }}>{buyer.email}</strong></div>
            ) : null}
            <section className="s-methods" aria-labelledby="pay-h">
              <h2 id="pay-h" className="s-h2" style={{ fontSize: 20 }}>Pay with</h2>
              {methods.map((m) => (
                <button key={m.id} type="button" className="s-method" aria-pressed={method === m.id} onClick={() => setMethod(m.id)}>
                  <span className="s-dot" />
                  <span className="s-method-mark" aria-hidden="true">
                    {m.logo ? <img src={m.logo} alt="" width={40} height={40} /> : <span className="s-method-icon"><Icon name={m.id === 'BANK_TRANSFER' ? 'bank' : m.id === 'CARD' ? 'card' : 'check'} size={22} /></span>}
                  </span>
                  <span className="s-method-text"><strong>{m.name}</strong><span>{m.note}</span></span>
                  {m.id === 'CARD' && (
                    <span className="s-cardmarks">
                      <img src="/pay/visa.png" alt="Visa" width={40} height={13} />
                      <img src="/pay/mastercard.png" alt="Mastercard" width={45} height={32} />
                    </span>
                  )}
                </button>
              ))}
              {methods.length === 0 && <p className="s-note">Loading ways to pay…</p>}
            </section>
            <p className="s-note">{refundLine(ev)}</p>
          </>
        )}
          </div>
          <aside className="s-co2-side">
        <section aria-label="Your order" className="s-box">
          <div className="s-summary-top" style={{ background: eventColour(ev.id) }}>
            <span className="s-summary-thumb">
              {ev.posterUrl && (
                // eslint-disable-next-line @next/next/no-img-element
                <img src={ev.posterUrl} alt="" />
              )}
            </span>
            <span style={{ display: 'flex', flexDirection: 'column' }}>
              <strong style={{ fontSize: 17 }}>{ev.name}</strong>
              <span style={{ fontSize: 13, opacity: 0.88 }}>{d.short} · {d.time} · {ev.venue.name}</span>
            </span>
          </div>
          <div className="s-lines">
            {lines.map((l) => <div key={l.key} className="s-line"><span>{l.label}</span><span>{dalasi(l.amount, currency)}</span></div>)}
            {order && order.platformFee > 0 && !order.feeIncluded && <div className="s-line s-line-soft"><span>Booking fee</span><span>{dalasi(order.platformFee, currency)}</span></div>}
            {order && order.platformFee > 0 && order.feeIncluded && <div className="s-line s-line-soft"><span>Fees included</span><span /></div>}
            <div className="s-line s-line-total"><span>{order ? 'Total' : 'Tickets'}</span><span>{dalasi(total, currency)}</span></div>
          </div>
        </section>

            {order && !expired && (
              <button type="button" className="s-btn s-btn-block s-co2-pay" disabled={busy} onClick={pay}>
                {busy ? 'One moment…' : method === 'BANK_TRANSFER' ? `Get bank details · ${dalasi(order.total, order.currency)}` : `Pay ${dalasi(order.total, order.currency)}${method === 'MOCK' ? '' : ` with ${method === 'CARD' ? 'card' : methods.find((m) => m.id === method)?.name ?? ''}`}`}
              </button>
            )}
          </aside>
        </div>
      </main>

      {order && !expired && (
        <div className="s-paybar s-co2-bar">
          <div className="s-wrap s-narrow">
            <button type="button" className="s-btn s-btn-block" disabled={busy} onClick={pay}>
              {busy ? 'One moment…' : method === 'BANK_TRANSFER' ? `Get bank details · ${dalasi(order.total, order.currency)}` : `Pay ${dalasi(order.total, order.currency)}${method === 'MOCK' ? '' : ` with ${method === 'CARD' ? 'card' : methods.find((m) => m.id === method)?.name ?? ''}`}`}
            </button>
          </div>
        </div>
      )}
    </>
  );
}

export default function CheckoutPage() {
  return (
    <Suspense fallback={null}>
      <CheckoutInner />
    </Suspense>
  );
}
