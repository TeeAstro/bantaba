'use client';

import Link from 'next/link';
import { useParams, useRouter, useSearchParams } from 'next/navigation';
import { Suspense, useEffect, useMemo, useState } from 'react';
import { api, ApiError } from '@/lib/api';
import { Cart, MAX_PER_ORDER, MAX_SEATS, StoreEvent, StoreTicketType, dalasi, eventColour, loadCart, saveCart } from '@/lib/store';
import { MAP, SeatMapData, SectionSeats, shortName, toneColour } from '@/lib/seating';
import { Icon } from '@/components/Icon';
import { StoreHeader } from '@/components/store/Chrome';
import { SectionLook, VenueMap } from '@/components/VenueMap';

// Choosing seats (Phase 17, docs/seating.md): the venue map, coloured by
// price; tap a section, then its seats. Seats stay free until checkout
// holds them (5 minutes while paying). Designed on the Bantaba storefront
// canvas (Seats).

/**
 * The best `n` seats side by side in a section: the row nearest the front,
 * then nearest the middle of that row. Seats the buyer already has here
 * count as free (they're being swapped). Null if no row has `n` together.
 */
function bestSeats(section: SectionSeats, n: number, mine: (id: string) => boolean) {
  let best: { seats: SectionSeats['rows'][number]['seats']; score: number } | null = null;
  section.rows.forEach((row, ri) => {
    const seats = [...row.seats].sort((a, b) => a.col - b.col);
    if (!seats.length) return;
    const middle = (seats[0].col + seats[seats.length - 1].col) / 2;
    let run: typeof seats = [];
    for (const seat of seats) {
      const free = seat.status === 'AVAILABLE' || mine(seat.id);
      if (!free || (run.length && seat.col !== run[run.length - 1].col + 1)) run = [];
      if (!free) continue;
      run.push(seat);
      if (run.length >= n) {
        const window = run.slice(-n);
        const score = ri * 100000 + Math.abs((window[0].col + window[n - 1].col) / 2 - middle);
        if (!best || score < best.score) best = { seats: window, score };
      }
    }
  });
  return (best as { seats: SectionSeats['rows'][number]['seats'] } | null)?.seats ?? null;
}

interface Pick {
  id: string;
  label: string;
  ticketTypeId: string;
}

function SeatsInner() {
  const { slug } = useParams<{ slug: string }>();
  const typeId = useSearchParams().get('type');
  const router = useRouter();
  const [event, setEvent] = useState<StoreEvent | null>(null);
  const [types, setTypes] = useState<StoreTicketType[]>([]);
  const [map, setMap] = useState<SeatMapData | null>(null);
  const [cart, setCart] = useState<Cart | null>(null);
  const [picked, setPicked] = useState<Pick[]>([]);
  const [selId, setSelId] = useState<string | null>(null);
  const [view, setView] = useState<'overview' | 'section'>('overview');
  const [seats, setSeats] = useState<Record<string, SectionSeats>>({});
  const [error, setError] = useState<string | null>(null);
  const [want, setWant] = useState(2);
  const [bestNote, setBestNote] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const e = await api<StoreEvent>(`/events/${encodeURIComponent(slug)}`);
        const [tt, m] = await Promise.all([api<StoreTicketType[]>(`/events/${e.id}/ticket-types`), api<SeatMapData>(`/events/${e.id}/seat-map`)]);
        if (cancelled) return;
        if (m.ticketTypes.length === 0) throw new ApiError(404, 'There are no seats on sale for this event.');
        const saved = loadCart();
        const c = saved?.eventId === e.id ? saved : { eventId: e.id, slug: e.slug, items: [] };
        setEvent(e);
        setTypes(tt);
        setMap(m);
        setCart(c);
        setPicked(c.items.flatMap((i) => (i.seatIds ?? []).map((id, k) => ({ id, label: i.seatLabels?.[k] ?? '', ticketTypeId: i.ticketTypeId }))));
        // Start on the first section with free seats of the ticket type the buyer came for.
        const start = m.sections.find((s) => s.ticketTypeId && s.free > 0 && (!typeId || s.ticketTypeId === typeId));
        setSelId(start?.id ?? null);
      } catch (err) {
        if (!cancelled) setError((err as ApiError).message);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [slug, typeId]);

  const typeOf = useMemo(() => new Map((map?.ticketTypes ?? []).map((t) => [t.id, t])), [map]);
  const sel = map?.sections.find((s) => s.id === selId) ?? null;
  const selType = sel?.ticketTypeId ? typeOf.get(sel.ticketTypeId) ?? null : null;
  const colour = (s: SeatMapData['sections'][number]) => {
    const t = s.ticketTypeId ? typeOf.get(s.ticketTypeId) : null;
    if (!t) return MAP.notOnSale;
    return s.free > 0 ? toneColour(t.tone) : MAP.soldOut;
  };

  const looks = useMemo(() => {
    const out: Record<string, SectionLook> = {};
    for (const s of map?.sections ?? []) {
      if (!s.key) continue;
      const t = s.ticketTypeId ? typeOf.get(s.ticketTypeId) : null;
      out[s.key] = {
        fill: colour(s),
        title: t ? `${s.name}, ${dalasi(t.price, t.currency)}, ${s.free ? `${s.free} free` : 'sold out'}` : `${s.name}, not on sale`,
        clickable: !!t,
      };
    }
    return out;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [map, typeOf]);

  // Load a section's seats when it's opened.
  useEffect(() => {
    if (view !== 'section' || !selId || !map || seats[selId]) return;
    api<SectionSeats>(`/events/${map.eventId}/seat-map/sections/${selId}`)
      .then((s) => setSeats((all) => ({ ...all, [selId]: s })))
      .catch((err) => setError((err as ApiError).message));
  }, [view, selId, map, seats]);

  if (error || !event || !map || !cart) {
    return (
      <>
        <StoreHeader back={`/e/${slug}`} />
        <main className="s-main s-wrap">
          {error ? (
            <div className="s-auth"><div className="s-notice s-notice-bad" role="alert">{error}</div><Link href={`/e/${slug}`}>Back to the event</Link></div>
          ) : (
            <p className="s-empty">Loading…</p>
          )}
        </main>
      </>
    );
  }

  const seatedIds = new Set(types.filter((t) => t.seated).map((t) => t.id));
  const others = cart.items.filter((i) => !seatedIds.has(i.ticketTypeId)).reduce((n, i) => n + i.quantity, 0);
  const max = Math.min(MAX_SEATS, MAX_PER_ORDER - others);
  const isMine = (id: string) => picked.some((p) => p.id === id);
  const priceOf = (ticketTypeId: string) => typeOf.get(ticketTypeId)?.price ?? types.find((t) => t.id === ticketTypeId)?.price ?? 0;
  const sum = picked.reduce((n, p) => n + priceOf(p.ticketTypeId), 0);
  const currency = map.ticketTypes[0]?.currency ?? 'GMD';
  const section = selId ? seats[selId] : undefined;
  const inSection = view === 'section' && !!sel;

  const toggle = (seat: { id: string; label: string }) => {
    if (!sel?.ticketTypeId) return;
    if (isMine(seat.id)) setPicked(picked.filter((p) => p.id !== seat.id));
    else if (picked.length < max) setPicked([...picked, { id: seat.id, label: `${shortName(sel.name)} ${seat.label}`, ticketTypeId: sel.ticketTypeId }]);
  };

  // Seats picked in other sections stay; this section's are swapped for the best run.
  const pickedElsewhere = picked.filter((p) => !section?.rows.some((r) => r.seats.some((x) => x.id === p.id)));
  const room = Math.max(1, max - pickedElsewhere.length);
  const howMany = Math.min(want, room);
  const pickBest = () => {
    if (!section || !sel?.ticketTypeId) return;
    const run = bestSeats(section, howMany, isMine);
    if (!run) {
      setBestNote(`No ${howMany} seats together here. Pick them one by one, or try another section.`);
      return;
    }
    setBestNote(null);
    setPicked([...pickedElsewhere, ...run.map((x) => ({ id: x.id, label: `${shortName(sel.name)} ${x.label}`, ticketTypeId: sel.ticketTypeId! }))]);
    setTimeout(() => document.querySelector(`[data-seat="${run[0].id}"]`)?.scrollIntoView({ behavior: 'smooth', block: 'center' }), 50);
  };

  const go = () => {
    const rest = cart.items.filter((i) => !seatedIds.has(i.ticketTypeId));
    const byType = new Map<string, Pick[]>();
    for (const p of picked) byType.set(p.ticketTypeId, [...(byType.get(p.ticketTypeId) ?? []), p]);
    const next: Cart = {
      ...cart,
      items: [...rest, ...[...byType.entries()].map(([ticketTypeId, ps]) => ({ ticketTypeId, quantity: ps.length, seatIds: ps.map((p) => p.id), seatLabels: ps.map((p) => p.label) }))],
    };
    saveCart(next);
    router.push(next.items.length ? '/checkout' : `/e/${event.slug}`);
  };

  const cols = section?.perRow ?? 0;
  // Each row is a block of numbered seats that wraps to the screen width,
  // so long rows (380 seats) scroll down, not sideways. Rows keep their
  // letter on the left; "1, 2, 3…" sections have none.
  const lettered = !!section && section.numbering !== 'seats';
  const seatColour = selType ? toneColour(selType.tone) : '#d97706';

  return (
    <>
      <StoreHeader back={`/e/${slug}`} />
      <div className="s-band" style={{ background: eventColour(event.id) }}>
        <div className="s-wrap">
          <span className="s-band-event">{event.name}</span>
          <h1>{inSection ? sel!.name : 'Choose your seats'}</h1>
          <p>{inSection && selType ? `${dalasi(selType.price, selType.currency)} a seat · up to ${max}` : 'Pick a section, then your seats'}</p>
        </div>
      </div>

      <main className="s-main s-wrap s-seats">
        {!inSection ? (
          <>
            {map.svg ? (
              <div className="s-box s-map">
                <VenueMap svg={map.svg} looks={looks} selectedKey={sel?.key} selectedStroke="#18181B" onPick={(key) => setSelId(map.sections.find((s) => s.key === key)?.id ?? null)} label={`${map.venue.name}: tap a section`} />
              </div>
            ) : (
              <div className="s-box s-section-list">
                {map.sections.filter((s) => s.ticketTypeId).map((s) => (
                  <button key={s.id} type="button" aria-pressed={s.id === selId} onClick={() => setSelId(s.id)} style={{ background: colour(s) }}>{s.name}</button>
                ))}
              </div>
            )}
            <div className="s-tiers">
              {map.ticketTypes.map((t) => (
                <span key={t.id}><i style={{ background: toneColour(t.tone) }} /><strong>{t.name}</strong> {dalasi(t.price, t.currency)}</span>
              ))}
              <span className="s-tiers-out"><i style={{ background: MAP.soldOut }} />Sold out</span>
            </div>
            {sel && selType ? (
              <div className="s-box s-picked" style={{ borderColor: sel.free ? toneColour(selType.tone) : MAP.soldOut }}>
                <span>
                  <strong>{sel.name}</strong>
                  <span>{[sel.gate, sel.free ? `${dalasi(selType.price, selType.currency)} · ${sel.free} seats free` : 'Sold out'].filter(Boolean).join(' · ')}</span>
                </span>
                {sel.free > 0 && <button type="button" className="s-btn s-btn-plum" onClick={() => setView('section')}>Choose seats</button>}
              </div>
            ) : (
              <p className="s-note" style={{ textAlign: 'center' }}>Tap a section to see its seats.</p>
            )}
          </>
        ) : (
          <>
            <button type="button" className="s-pillback" onClick={() => setView('overview')}>
              <Icon name="left" size={16} /> All sections
            </button>
            {section && (
              <div className="s-box s-best">
                <div className="s-qty" role="group" aria-label="How many seats">
                  <button type="button" aria-label="Fewer" disabled={howMany <= 1} onClick={() => setWant(Math.max(1, howMany - 1))}>−</button>
                  <span aria-live="polite">{howMany}</span>
                  <button type="button" aria-label="More" disabled={howMany >= room} onClick={() => setWant(Math.min(room, howMany + 1))}>+</button>
                </div>
                <button type="button" className="s-btn s-btn-plum" onClick={pickBest}>Best seats</button>
              </div>
            )}
            {bestNote && <p className="s-note" role="status">{bestNote}</p>}
            <div className={`s-stage${/pitch|field/i.test(map.venue.frontLabel) ? ' s-stage-grass' : ''}`}>{(section?.frontLabel ?? map.venue.frontLabel).toUpperCase()}</div>
            <div className="s-box s-seatmap">
              {!section ? (
                <p className="s-note">Loading…</p>
              ) : (
                <div className="s-seatgrid">
                  {section.rows.map((row) => {
                    const byN = new Map(row.seats.map((x) => [x.col, x]));
                    const free = row.seats.filter((x) => x.status === 'AVAILABLE').length;
                    return (
                      <div key={row.label} className="s-rowblock">
                        <span className="s-rowlabel" title={`${free} free`}>{lettered ? row.row : ''}</span>
                        <div className="s-rowseats">
                          {Array.from({ length: cols }, (_, i) => {
                            const seat = byN.get(i + 1);
                            // Places taken out (aisles) only matter inside the row.
                            if (!seat) return i < (row.seats[row.seats.length - 1]?.col ?? 0) ? <span key={i} className="s-seat-gap" /> : null;
                            const mine = isMine(seat.id);
                            const taken = !mine && seat.status !== 'AVAILABLE';
                            const held = !mine && seat.status === 'HELD';
                            const cls = mine ? 's-seat s-seat-mine' : held ? 's-seat s-seat-held' : taken ? 's-seat s-seat-sold' : 's-seat';
                            const state = mine ? 'yours' : held ? 'on hold' : taken ? 'not available' : `free, ${selType ? dalasi(selType.price, selType.currency) : ''}`;
                            return (
                              <button
                                key={i}
                                type="button"
                                data-seat={seat.id}
                                className={cls}
                                style={!mine && !taken ? { background: seatColour } : undefined}
                                disabled={taken}
                                aria-pressed={mine}
                                aria-label={`${section.numbering === 'seats' ? seat.label : `Row ${row.row}, seat ${seat.number}`}, ${state}`}
                                onClick={() => toggle(seat)}
                              >
                                {mine ? '✓' : taken && !held ? '×' : held ? '' : seat.number}
                              </button>
                            );
                          })}
                        </div>
                      </div>
                    );
                  })}
                </div>
              )}
            </div>
            <div className="s-legend" aria-hidden="true">
              <span><i style={{ background: seatColour }} />Free</span>
              <span><i style={{ background: 'var(--coral)', color: '#fff' }}>✓</i>Your seats</span>
              <span><i style={{ background: '#e4e4e7', color: '#71717a' }}>×</i>Sold</span>
              <span><i style={{ background: 'repeating-linear-gradient(45deg, #e4e4e7 0 3px, #fff 3px 6px)', border: '1px solid #d4d4d8' }} />On hold</span>
            </div>
            <p className="s-note">We hold your seats for 5 minutes while you pay.</p>
          </>
        )}
      </main>

      <div className="s-bar">
        <div className="s-wrap">
          <div className="s-bar-sum">
            <span>{picked.length ? picked.map((p) => p.label).join(', ') : 'Tap a seat'}</span>
            <strong>{dalasi(sum, currency)}</strong>
          </div>
          <button type="button" className="s-btn" disabled={picked.length === 0 && !cart.items.some((i) => !seatedIds.has(i.ticketTypeId))} onClick={go}>Continue</button>
        </div>
      </div>
    </>
  );
}

export default function SeatsPage() {
  return (
    <Suspense fallback={null}>
      <SeatsInner />
    </Suspense>
  );
}
