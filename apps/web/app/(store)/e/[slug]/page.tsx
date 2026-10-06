'use client';

import { EventFee, feeFor } from '@/lib/fees';
import Link from 'next/link';
import { useParams, useRouter } from 'next/navigation';
import { useEffect, useMemo, useState } from 'react';
import { api, ApiError } from '@/lib/api';
import { Cart, MAX_PER_ORDER, StoreEvent, StoreTicketType, dalasi, eventColour, icsFor, loadCart, mapsUrl, refundLine, saveCart, when } from '@/lib/store';
import { Icon } from '@/components/Icon';
import { StoreFooter, StoreHeader, Tick } from '@/components/store/Chrome';
import { HostAvatar } from '@/components/store/Cards';

// The event page (Phase 16, docs/storefront.md). The event's colour frames
// the top; the buy button is always coral.

type Sale = { kind: 'open' } | { kind: 'soon'; at: string } | { kind: 'ended' } | { kind: 'out' };

function saleState(t: StoreTicketType, now: Date): Sale {
  if (t.salesEnd && new Date(t.salesEnd) <= now) return { kind: 'ended' };
  if (t.quantitySold >= t.quantityTotal) return { kind: 'out' };
  if (t.salesStart && new Date(t.salesStart) > now) return { kind: 'soon', at: t.salesStart };
  return { kind: 'open' };
}

export default function EventPage() {
  const { slug } = useParams<{ slug: string }>();
  const router = useRouter();
  const [event, setEvent] = useState<StoreEvent | null>(null);
  const [types, setTypes] = useState<StoreTicketType[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [cart, setCart] = useState<Cart | null>(null);
  const [copied, setCopied] = useState(false);
  // Phase 20: the booking fee, so the bar shows what they'll pay before checkout.
  const [fee, setFee] = useState<EventFee | null>(null);

  useEffect(() => {
    let cancelled = false;
    api<StoreEvent>(`/events/${encodeURIComponent(slug)}`)
      .then(async (e) => {
        const [tt, f] = await Promise.all([
          api<StoreTicketType[]>(`/events/${e.id}/ticket-types`),
          api<EventFee>(`/events/${e.id}/booking-fee`, { auth: false }).catch(() => null),
        ]);
        if (!cancelled) setFee(f);
        if (cancelled) return;
        setEvent(e);
        setTypes(tt.filter((t) => t.isActive));
        const saved = loadCart();
        setCart(saved?.eventId === e.id ? saved : { eventId: e.id, slug: e.slug, items: [] });
      })
      .catch((err: ApiError) => !cancelled && setError(err.status === 404 ? 'missing' : err.message));
    return () => {
      cancelled = true;
    };
  }, [slug]);

  const now = useMemo(() => new Date(), []);
  const items = cart?.items ?? [];
  const count = items.reduce((n, i) => n + i.quantity, 0);
  const total = items.reduce((n, i) => n + i.quantity * (types.find((t) => t.id === i.ticketTypeId)?.price ?? 0), 0);
  const currency = types[0]?.currency ?? 'GMD';
  // Phase 20b: when the host includes the fee, the prices are what buyers pay.
  const bookingFee = fee && !fee.included ? feeFor(fee, items.map((i) => ({ price: types.find((t) => t.id === i.ticketTypeId)?.price ?? 0, quantity: i.quantity }))) : 0;

  const update = (next: Cart) => {
    setCart(next);
    saveCart(next);
  };
  const qty = (id: string) => items.find((i) => i.ticketTypeId === id)?.quantity ?? 0;
  const setQty = (t: StoreTicketType, n: number) => {
    if (!cart) return;
    const rest = cart.items.filter((i) => i.ticketTypeId !== t.id);
    update({ ...cart, items: n > 0 ? [...rest, { ticketTypeId: t.id, quantity: n }] : rest });
  };

  if (error === 'missing') {
    return (
      <>
        <StoreHeader back="/" />
        <main className="s-main s-wrap s-narrow s-auth">
          <h1>Event not found</h1>
          <p className="s-note">It may have ended or been taken down.</p>
          <Link href="/" className="s-btn s-btn-quiet">See what’s on</Link>
        </main>
        <StoreFooter />
      </>
    );
  }
  if (error || !event || !cart) {
    return (
      <>
        <StoreHeader back="/" />
        <main className="s-main s-wrap">{error ? <div className="s-notice s-notice-bad" style={{ marginTop: 18 }} role="alert">{error}</div> : <p className="s-empty">Loading…</p>}</main>
      </>
    );
  }

  const colour = eventColour(event.id);
  const start = when(event.startDate);
  const end = when(event.endDate);
  const over = new Date(event.endDate) < now;
  const picture = event.posterUrl ?? event.bannerUrl;
  const sameDay = start.long === end.long;

  const share = async () => {
    const url = window.location.href;
    try {
      if (navigator.share) await navigator.share({ title: event.name, url });
      else {
        await navigator.clipboard.writeText(url);
        setCopied(true);
        setTimeout(() => setCopied(false), 2000);
      }
    } catch {
      // closed the share sheet
    }
  };
  const calendar = () => {
    const blob = new Blob([icsFor(event)], { type: 'text/calendar' });
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = `${event.slug}.ics`;
    a.click();
    URL.revokeObjectURL(a.href);
  };

  const hostCard = (cls: string) => (
    <Link href={`/o/${event.organizer.slug}`} className={`s-box s-hostcard ${cls}`}>
      <HostAvatar name={event.organizer.businessName} logoUrl={event.organizer.logoUrl} size={44} />
      <span className="s-info-text">
        <span>Hosted by</span>
        <strong style={{ display: 'flex', alignItems: 'center', gap: 5 }}>{event.organizer.businessName}{event.organizer.verified && <Tick size={16} />}</strong>
      </span>
      <Icon name="right" />
    </Link>
  );

  const countLabel =
    count === 0 ? 'Pick your tickets' : items.length === 1 ? `${count} × ${types.find((t) => t.id === items[0].ticketTypeId)?.name ?? 'ticket'}` : `${count} tickets`;

  return (
    <>
      <StoreHeader back="/" />
      <main className="s-main">
        <section className="s-ev-hero" style={{ background: colour }}>
          <div className="s-wrap">
            <div className="s-ev-top">
              {/* Back is in the header, like every page. */}
              <span />
              <button type="button" className="s-round" aria-label={copied ? 'Link copied' : 'Share this event'} onClick={share}>
                <Icon name={copied ? 'check' : 'share'} />
              </button>
            </div>
            <div className="s-ev-grid">
              <div className={`s-poster${!picture ? ' s-poster-none' : !event.posterUrl ? ' s-poster-wide' : ''}`}>
                {picture ? (
                  // eslint-disable-next-line @next/next/no-img-element
                  <img src={picture} alt={`${event.name} poster`} />
                ) : (
                  <span className="s-noimg" style={{ fontSize: 72 }} aria-hidden="true">{event.name.slice(0, 1)}</span>
                )}
              </div>
              <div>
                <div className="s-pills">
                  <span className="s-pill">{event.category.name}</span>
                  {event.ageRestriction ? <span className="s-pill">{event.ageRestriction}+</span> : null}
                </div>
                <h1>{event.name}</h1>
              </div>
            </div>
          </div>
        </section>

        <div className="s-wrap">
          <div className="s-ev-body">
            <div className="s-ev-side" style={{ display: 'flex', flexDirection: 'column', gap: 22 }}>
              <div className="s-box">
                <div className="s-info">
                  <span className="s-info-icon"><Icon name="calendar" size={20} /></span>
                  <span className="s-info-text">
                    <strong>{start.long}</strong>
                    <span>{start.time} – {sameDay ? end.time : `${end.short}, ${end.time}`}</span>
                  </span>
                  {!over && <button type="button" className="s-link-btn" onClick={calendar}>Add to calendar</button>}
                </div>
                <div className="s-info">
                  <span className="s-info-icon"><Icon name="pin" size={20} /></span>
                  <span className="s-info-text">
                    <strong>{event.venue.name}</strong>
                    <span>{event.venue.address ? `${event.venue.address}, ` : ''}{event.venue.city}</span>
                  </span>
                  <a href={mapsUrl(event.venue)} target="_blank" rel="noopener noreferrer">Directions</a>
                </div>
              </div>
              {hostCard('s-only-wide')}
            </div>

            <div className="s-ev-col">
              <section className="s-types" aria-labelledby="tickets-h">
                <h2 id="tickets-h" className="s-h2">Tickets</h2>
                {over ? (
                  <p className="s-note">This event has ended.</p>
                ) : types.length === 0 ? (
                  <p className="s-note">Tickets aren’t on sale yet.</p>
                ) : (
                  types.map((t) => {
                    const s = saleState(t, now);
                    const n = qty(t.id);
                    const left = t.quantityTotal - t.quantitySold;
                    const room = MAX_PER_ORDER - count + n;
                    const chosen = items.find((i) => i.ticketTypeId === t.id);
                    return (
                      <div key={t.id} className={`s-type${n > 0 ? ' s-type-on' : ''}${s.kind !== 'open' ? ' s-type-off' : ''}`}>
                        <div className="s-type-name">
                          <strong>{t.name}</strong>
                          <span>{t.price === 0 ? 'Free' : dalasi(t.price, t.currency)}</span>
                          {s.kind === 'open' && left <= 20 && <span className="s-left">{left} left</span>}
                        </div>
                        {s.kind === 'out' ? (
                          <span className="s-badge">Sold out</span>
                        ) : s.kind === 'ended' ? (
                          <span className="s-badge">Sales ended</span>
                        ) : s.kind === 'soon' ? (
                          <span className="s-badge">On sale {when(s.at).short}</span>
                        ) : t.seated ? (
                          <Link className="s-seats-link" href={`/e/${event.slug}/seats?type=${t.id}`}>
                            {chosen?.seatLabels?.length ? `${chosen.seatLabels.join(', ')} · Change` : 'Choose seats'}
                            <Icon name="right" size={16} />
                          </Link>
                        ) : (
                          <div className="s-stepper">
                            <button type="button" className="s-step" aria-label={`One fewer ${t.name} ticket`} disabled={n === 0} onClick={() => setQty(t, n - 1)}><Icon name="minus" /></button>
                            <span className="s-qty" aria-live="polite">{n}</span>
                            <button type="button" className="s-step s-step-add" aria-label={`One more ${t.name} ticket`} disabled={n >= Math.min(left, room)} onClick={() => setQty(t, n + 1)}><Icon name="plus" /></button>
                          </div>
                        )}
                      </div>
                    );
                  })
                )}
                {!over && types.length > 0 && <p className="s-note">{refundLine(event)}</p>}
              </section>

              {hostCard('s-only-narrow')}

              {event.description && (
                <section aria-labelledby="about-h">
                  <h2 id="about-h" className="s-h2">About</h2>
                  <p className="s-about">{event.description}</p>
                </section>
              )}
            </div>
          </div>
        </div>
      </main>

      {!over && types.length > 0 && (
        <div className="s-bar">
          <div className="s-wrap">
            <div className="s-bar-sum">
              <span>{countLabel}</span>
              <strong>{count ? dalasi(total + bookingFee, currency) : '—'}</strong>
              {count > 0 && bookingFee > 0 && <span className="s-bar-fee">Includes {dalasi(bookingFee, currency)} booking fee</span>}
              {count > 0 && fee?.included && fee.kind !== 'none' && total > 0 && <span className="s-bar-fee">Fees included</span>}
            </div>
            <button type="button" className="s-btn" disabled={count === 0} onClick={() => router.push('/checkout')}>Get tickets</button>
          </div>
        </div>
      )}
      <StoreFooter />
    </>
  );
}
