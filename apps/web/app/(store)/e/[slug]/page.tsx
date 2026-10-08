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
import { useSessionUser } from '@/lib/hooks';

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
  // Phase 24: "I'm going" on an open-entry event.
  const user = useSessionUser();
  const [going, setGoing] = useState<{ count: number; me: boolean } | null>(null);
  const [goingBusy, setGoingBusy] = useState(false);
  const [goingError, setGoingError] = useState<string | null>(null);

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
        setGoing(e.going ?? null);
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
  const open = event.entryMode === 'OPEN';
  const sessions = event.series?.sessions ?? [];
  const allFree = types.length > 0 && types.every((t) => t.price === 0);
  const toggleGoing = async () => {
    if (!user) {
      router.push(`/signin?next=/e/${event.slug}`);
      return;
    }
    setGoingBusy(true);
    setGoingError(null);
    try {
      setGoing(await api<{ count: number; me: boolean }>(`/events/${event.id}/going`, { method: going?.me ? 'DELETE' : 'POST' }));
    } catch (err) {
      setGoingError((err as ApiError).message);
    } finally {
      setGoingBusy(false);
    }
  };
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

  const allSeated = types.length > 0 && types.every((t) => t.seated);
  const buyLabel = allFree ? (count > 1 ? `Get ${count} free tickets` : 'Get free ticket') : 'Get tickets';
  const summary = (
    <div className="s-bar-sum">
      <span>{countLabel}</span>
      <strong>{count ? dalasi(total + bookingFee, currency) : '—'}</strong>
      {count > 0 && bookingFee > 0 && <span className="s-bar-fee">Includes {dalasi(bookingFee, currency)} booking fee</span>}
      {count > 0 && fee?.included && fee.kind !== 'none' && total > 0 && <span className="s-bar-fee">Fees included</span>}
    </div>
  );

  return (
    <>
      <StoreHeader back="/" />
      {/* Phase 27 (docs/store-rework.md): a short colour band with the poster
          over it, the details on the left and tickets in a box that stays
          in view on a computer; on a phone the total sits in the bottom bar. */}
      <main className={`s-main s-ev2${!over && types.length > 0 && !(allSeated && count === 0) ? ' has-bar' : ''}`}>
        <section className="s-ev2-band" style={{ background: `linear-gradient(135deg, ${colour}, var(--plum))` }}>
          <div className="s-wrap">
            <button type="button" className="s-round" aria-label={copied ? 'Link copied' : 'Share this event'} onClick={share}>
              <Icon name={copied ? 'check' : 'share'} />
            </button>
          </div>
        </section>
        <div className="s-wrap s-ev2-head">
          <div className={`s-ev2-poster${!picture ? ' is-none' : ''}`} style={{ background: colour }}>
            {picture ? (
              // eslint-disable-next-line @next/next/no-img-element
              <img src={picture} alt={`${event.name} poster`} />
            ) : (
              <span className="s-noimg" aria-hidden="true">{event.name.slice(0, 1)}</span>
            )}
          </div>
          <div className="s-ev2-title">
            <div className="s-pills">
              <span className="s-pill">{event.category.name}</span>
              {event.series && <span className="s-pill">{event.series.label}</span>}
              {(open || allFree) && <span className="s-pill">{open ? 'Free entry' : 'Free'}</span>}
              {event.ageRestriction ? <span className="s-pill">{event.ageRestriction}+</span> : null}
            </div>
            <h1>{event.name}</h1>
            <span className="s-ev2-when">{event.series ? event.series.label : start.short} · {start.time} · {event.venue.name}</span>
          </div>
        </div>

        <div className="s-wrap s-ev2-body">
          <div className="s-ev2-main">
            <div className="s-box">
                <div className="s-info">
                  <span className="s-info-icon"><Icon name="calendar" size={20} /></span>
                  <span className="s-info-text">
                    <strong>{event.series ? event.series.label : start.long}</strong>
                    <span>{event.series ? `${start.short}, ` : ''}{start.time} – {sameDay ? end.time : `${end.short}, ${end.time}`}</span>
                  </span>
                  {!over && <button type="button" className="s-link-btn" onClick={calendar}>Add to calendar</button>}
                </div>
                <div className="s-info">
                  <span className="s-info-icon"><Icon name="pin" size={20} /></span>
                  <span className="s-info-text">
                    <strong>{event.venue.name}</strong>
                    <span>{event.venue.address ? `${event.venue.address}, ` : ''}{event.venue.city}</span>
                    {event.venue.directions && <span className="s-venue-dir">{event.venue.directions}</span>}
                  </span>
                  <a href={mapsUrl(event.venue)} target="_blank" rel="noopener noreferrer">Directions</a>
                </div>
              </div>

              {sessions.length > 1 && (
                <section aria-labelledby="dates-h">
                  <h2 id="dates-h" className="s-h2">Choose a date</h2>
                  <div className="s-dates" role="list">
                    {sessions.map((x) => {
                      const d = when(x.startDate);
                      const on = x.id === event.id;
                      const full = x.kind === 'soldOut';
                      const left = x.kind === 'open' ? 'Open' : full ? 'Full' : x.left !== null && x.left <= 10 ? `${x.left} left` : x.kind === 'free' ? 'Free' : '';
                      return (
                        <Link
                          role="listitem"
                          key={x.id}
                          href={`/e/${x.slug}`}
                          replace
                          scroll={false}
                          aria-current={on ? 'date' : undefined}
                          aria-disabled={full || undefined}
                          className={`s-dt${on ? ' s-dt-on' : ''}${full ? ' s-dt-full' : ''}`}
                          onClick={(e) => full && e.preventDefault()}
                        >
                          <span>{d.weekday}</span>
                          <strong>{d.day}</strong>
                          <span>{d.month}</span>
                          {left && <em>{left}</em>}
                        </Link>
                      );
                    })}
                  </div>
                </section>
              )}
            <div className={`s-ev2-narrow${!open && !over && types.length > 0 ? ' has-side' : ''}`}>
              {open ? (
                <section className="s-types" aria-labelledby="entry-h">
                  <h2 id="entry-h" className="s-sr">Entry</h2>
                  <div className="s-free-entry">
                    <Icon name="check" size={20} />
                    <span><strong>Free entry, no ticket needed</strong><span>Just come along.</span></span>
                  </div>
                  {goingError && <div className="s-notice s-notice-bad" role="alert">{goingError}</div>}
                </section>
              ) : (
              <section className="s-types" aria-labelledby="tickets-h">
                <h2 id="tickets-h" className="s-h2">{event.series ? `Tickets · ${start.short}` : 'Tickets'}</h2>
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
                {!over && types.length > 0 && <p className="s-note">{allFree ? 'Can’t come? Give your place back from My tickets so someone else can come.' : refundLine(event)}</p>}
              </section>
              )}

            </div>
              {event.description && (
                <section aria-labelledby="about-h">
                  <h2 id="about-h" className="s-h2">About</h2>
                  <p className="s-about">{event.description}</p>
                </section>
              )}
            {hostCard('')}
          </div>

          {!open && !over && types.length > 0 && (
            <aside className="s-ev2-side">
              <div className="s-ev2-box">
              {open ? (
                <section className="s-types" aria-label="Entry">
                  <h2 className="s-sr">Entry</h2>
                  <div className="s-free-entry">
                    <Icon name="check" size={20} />
                    <span><strong>Free entry, no ticket needed</strong><span>Just come along.</span></span>
                  </div>
                  {goingError && <div className="s-notice s-notice-bad" role="alert">{goingError}</div>}
                </section>
              ) : (
              <section className="s-types" aria-label="Tickets">
                <h2 className="s-h2">{event.series ? `Tickets · ${start.short}` : 'Tickets'}</h2>
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
                {!over && types.length > 0 && <p className="s-note">{allFree ? 'Can’t come? Give your place back from My tickets so someone else can come.' : refundLine(event)}</p>}
              </section>
              )}

                {allSeated && count === 0 ? (
                  <span className="s-ev2-pay"><Icon name="shield" size={14} />Choose your seats, then pay with Wave, Afrimoney, QMoney, card or bank transfer</span>
                ) : (
                  <div className="s-ev2-buy">
                    {summary}
                    <button type="button" className="s-btn" disabled={count === 0} onClick={() => router.push('/checkout')}>{buyLabel}</button>
                    <span className="s-ev2-pay"><Icon name="shield" size={14} />Wave, Afrimoney, QMoney, card or bank transfer</span>
                  </div>
                )}
              </div>
            </aside>
          )}
        </div>
      </main>

      {!over && open && going && (
        <div className="s-bar">
          <div className="s-wrap">
            <div className="s-bar-sum">
              <span>{start.short} · {start.time}</span>
              <strong>{going.count} going</strong>
            </div>
            <button type="button" className={`s-btn s-btn-going${going.me ? ' is-on' : ''}`} aria-pressed={going.me} disabled={goingBusy} onClick={toggleGoing}>
              {going.me ? '✓ You’re going' : 'I’m going'}
            </button>
          </div>
        </div>
      )}
      {!over && !open && types.length > 0 && !(allSeated && count === 0) && (
        <div className="s-bar s-ev2-bar">
          <div className="s-wrap">
            {summary}
            <button type="button" className="s-btn" disabled={count === 0} onClick={() => router.push('/checkout')}>{buyLabel}</button>
          </div>
        </div>
      )}
      <StoreFooter />
    </>
  );
}
