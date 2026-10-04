'use client';

import Link from 'next/link';
import { useSearchParams } from 'next/navigation';
import { Suspense, useEffect, useState } from 'react';
import { api, ApiError } from '@/lib/api';
import { useSessionUser } from '@/lib/hooks';
import { StoreOrder, bankNote, dalasi, eventColour, orderKey, saveCart, when } from '@/lib/store';
import { Icon } from '@/components/Icon';
import { StoreFooter, StoreHeader } from '@/components/store/Chrome';
import { seatLabel } from '@/lib/seating';

// Where Wave and card send the buyer back, and where every checkout ends
// (Phase 16). Waits for the payment to be confirmed, then shows the tickets.

function OrderInner() {
  const id = useSearchParams().get('order');
  const user = useSessionUser();
  const [order, setOrder] = useState<StoreOrder | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [bank, setBank] = useState<string | null>(null);
  const [waited, setWaited] = useState(0);

  useEffect(() => {
    if (!id) return;
    setBank(bankNote(id));
    let stop = false;
    let tries = 0;
    const load = async () => {
      try {
        const o = await api<StoreOrder>(`/orders/${id}`, { headers: orderKey(id) });
        if (stop) return;
        setOrder(o);
        if (o.status === 'PAID') saveCart(null);
        // Wave and card confirm a few seconds after the buyer comes back.
        const waiting = o.status === 'PENDING' && o.payments.some((p) => p.status === 'PENDING' && p.provider !== 'BANK_TRANSFER');
        if (waiting && tries < 40) {
          tries += 1;
          setWaited(tries);
          setTimeout(load, 3000);
        }
      } catch (err) {
        if (!stop) setError((err as ApiError).status === 404 ? 'missing' : (err as ApiError).message);
      }
    };
    void load();
    return () => {
      stop = true;
    };
  }, [id, user?.id]);

  const shell = (children: React.ReactNode) => (
    <>
      <StoreHeader back="/" />
      <main className="s-main s-wrap s-narrow s-page">{children}</main>
      <StoreFooter />
    </>
  );

  if (!id || error === 'missing') {
    return shell(
      <>
        <h1>Order not found</h1>
        <p className="s-note">If you bought tickets, they’re in your email. Sign in with that email to see them here.</p>
        <Link href="/signin?next=/tickets" className="s-btn">Sign in</Link>
      </>,
    );
  }
  if (error) return shell(<div className="s-notice s-notice-bad" role="alert">{error}</div>);
  if (!order) return shell(<p className="s-empty">Loading…</p>);

  const ev = order.event;
  const d = when(ev.startDate);
  const live = order.tickets.filter((t) => t.status === 'ACTIVE');
  const signedIn = user?.role === 'CUSTOMER';

  if (order.status === 'PAID' || order.status === 'PARTIALLY_REFUNDED') {
    return shell(
      <>
        <div className="s-notice s-notice-good" role="status"><Icon name="checkins" />Paid · {live.length} ticket{live.length === 1 ? '' : 's'}</div>
        <h1>You’re going to {ev.name}</h1>
        <p className="s-note">{d.long}, {d.time} · {ev.venue.name}. Your tickets are also in your email.</p>
        <div style={{ display: 'grid', gap: 16 }}>
          {live.map((t, i) => (
            <article key={t.id} className="s-ticket">
              <div className="s-ticket-top" style={{ background: eventColour(ev.id) }}>
                <small>Ticket {i + 1} of {live.length}</small>
                <strong>{t.ticketType.name}</strong>
                {t.seat && <span>{t.seat.section.name} · {seatLabel(t.seat.row, t.seat.number)}</span>}
              </div>
              <div className="s-perf" />
              <div className="s-ticket-mid">
                {/* The QR is drawn by the server when the ticket is made. */}
                {t.qrCodeSvg ? <div className="s-qr" dangerouslySetInnerHTML={{ __html: t.qrCodeSvg }} role="img" aria-label="Ticket QR code" /> : <div className="s-qr s-qr-void">QR in your email</div>}
              </div>
            </article>
          ))}
        </div>
        {signedIn ? (
          <Link href="/tickets" className="s-btn s-btn-block">My tickets</Link>
        ) : (
          <>
            <Link href="/signin?next=/tickets" className="s-btn s-btn-block">Keep them in My tickets</Link>
            <p className="s-note">Sign in with the email you used. We’ll send you a code; no password needed.</p>
          </>
        )}
      </>,
    );
  }

  if (order.status === 'PENDING') {
    const bankPending = order.payments.some((p) => p.provider === 'BANK_TRANSFER' && p.status === 'PENDING');
    if (bankPending) {
      return shell(
        <>
          <h1>Pay by bank transfer</h1>
          <div className="s-bank">{bank ?? 'The bank details are in your email.'}</div>
          <p className="s-note">
            We hold your tickets until {order.expiresAt ? `${when(order.expiresAt).short}, ${when(order.expiresAt).time}` : 'the deadline'}. They’re emailed to you once the money arrives.
          </p>
          <Link href={`/checkout?order=${order.id}`} className="s-btn s-btn-quiet">Pay another way</Link>
        </>,
      );
    }
    const waiting = order.payments.some((p) => p.status === 'PENDING');
    return shell(
      <>
        <h1>{waiting ? 'Confirming your payment…' : 'Not paid yet'}</h1>
        <p className="s-note">
          {waiting
            ? waited >= 40
              ? 'This is taking longer than usual. If money left your account, your tickets will be emailed to you as soon as it’s confirmed.'
              : 'This usually takes a few seconds.'
            : 'Your tickets are still held for a few minutes.'}
        </p>
        <Link href={`/checkout?order=${order.id}`} className="s-btn s-btn-quiet">{waiting ? 'Pay another way' : 'Back to checkout'}</Link>
      </>,
    );
  }

  return shell(
    <>
      <h1>This order was closed</h1>
      <p className="s-note">{order.status === 'CANCELLED' ? 'It wasn’t paid in time, so the tickets went back on sale.' : 'It was refunded.'}</p>
      <Link href={`/e/${ev.slug}`} className="s-btn">Choose again</Link>
    </>,
  );
}

export default function OrderPage() {
  return (
    <Suspense fallback={null}>
      <OrderInner />
    </Suspense>
  );
}
