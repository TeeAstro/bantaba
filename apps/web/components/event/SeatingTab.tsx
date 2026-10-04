'use client';

import Link from 'next/link';
import { useCallback, useEffect, useMemo, useState } from 'react';
import { api, ApiError } from '@/lib/api';
import { useApi } from '@/lib/hooks';
import { money } from '@/lib/format';
import { EventSeating, MAP, SectionSeats, toneColour } from '@/lib/seating';
import { ErrorNotice, Loading } from '@/components/ui';
import { Icon } from '@/components/Icon';
import { SectionLook, VenueMap } from '@/components/VenueMap';
import { GridCell, SeatGrid } from '@/components/SeatGrid';

// The event's seating (Phase 17, docs/seating.md): what each section of the
// venue is sold as, and seats closed for this event. The layout itself is
// Bantaba's (admin Venues). Designed on the "Bantaba Host screens" canvas
// (EventSeating).

const fmt = (n: number) => n.toLocaleString('en-GB');

export function SeatingTab({ eventId, onChange }: { eventId: string; onChange: () => void }) {
  const { data: loaded, error, reload } = useApi<EventSeating>(`/events/${eventId}/seating`);
  const [data, setData] = useState<EventSeating | null>(null);
  const [selId, setSelId] = useState<string | null>(null);
  const [seats, setSeats] = useState<SectionSeats | null>(null);
  const [soldAs, setSoldAs] = useState<string | null>(null);
  const [closed, setClosed] = useState<Set<string>>(new Set());
  const [note, setNote] = useState<{ text: string; bad: boolean } | null>(null);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    if (!loaded) return;
    setData(loaded);
    setSelId((cur) => cur ?? loaded.sections.find((s) => s.ticketTypeId)?.id ?? loaded.sections[0]?.id ?? null);
  }, [loaded]);

  const sel = data?.sections.find((s) => s.id === selId) ?? null;

  const loadSeats = useCallback(
    async (id: string) => {
      setSeats(null);
      try {
        const s = await api<SectionSeats>(`/events/${eventId}/seating/sections/${id}`);
        setSeats(s);
        setClosed(new Set(s.rows.flatMap((r) => r.seats.filter((x) => x.status === 'CLOSED').map((x) => x.id))));
      } catch (err) {
        setNote({ text: err instanceof ApiError ? err.message : 'Could not load the seats', bad: true });
      }
    },
    [eventId],
  );

  useEffect(() => {
    if (!selId || !data) return;
    setSoldAs(data.sections.find((s) => s.id === selId)?.ticketTypeId ?? null);
    loadSeats(selId);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selId, loadSeats]);

  const typeById = useMemo(() => new Map((data?.ticketTypes ?? []).map((t) => [t.id, t])), [data]);
  const colourOf = useCallback((typeId: string | null) => (typeId && typeById.has(typeId) ? toneColour(typeById.get(typeId)!.tone) : MAP.notOnSale), [typeById]);

  const looks = useMemo(() => {
    const out: Record<string, SectionLook> = {};
    for (const s of data?.sections ?? []) {
      if (!s.key) continue;
      const typeId = s.id === selId ? soldAs : s.ticketTypeId;
      out[s.key] = { fill: colourOf(typeId), title: `${s.name}, ${typeId ? typeById.get(typeId)?.name : 'not on sale'}`, clickable: true };
    }
    return out;
  }, [data, selId, soldAs, colourOf, typeById]);

  if (error) return <ErrorNotice message={error} onRetry={reload} />;
  if (!data) return <Loading />;
  if (data.sections.length === 0) {
    return (
      <div className="panel empty">
        <p>No seat map for {data.venue.name} yet. Bantaba adds venue maps; ask the platform team if you need one.</p>
      </div>
    );
  }

  const live = new Set(seats?.rows.flatMap((r) => r.seats.filter((x) => x.status === 'SOLD' || x.status === 'HELD').map((x) => x.id)) ?? []);
  const dirty =
    !!sel &&
    !!seats &&
    (soldAs !== sel.ticketTypeId ||
      seats.rows.some((r) => r.seats.some((x) => (x.status === 'CLOSED') !== closed.has(x.id))));
  const locked = !data.editable;
  const sold = seats?.rows.reduce((n, r) => n + r.seats.filter((x) => x.status === 'SOLD').length, 0) ?? 0;
  const total = seats?.rows.reduce((n, r) => n + r.seats.length, 0) ?? 0;
  const open = seats ? seats.rows.reduce((n, r) => n + r.seats.filter((x) => x.status !== 'BLOCKED' && !closed.has(x.id)).length, 0) : 0;
  const cols = seats?.perRow ?? 0;

  const gridRows = (seats?.rows ?? []).map((r) => ({
    label: r.label,
    cells: r.seats.map((x): GridCell => {
      const n = x.col;
      const base = seats?.numbering === 'seats' ? x.label : `Row ${r.row}, seat ${x.number}`;
      if (x.status === 'SOLD') return { n, kind: 'sold', aria: `${base}, sold` };
      if (x.status === 'HELD') return { n, kind: 'held', aria: `${base}, on hold` };
      if (x.status === 'BLOCKED') return { n, kind: 'blocked', aria: `${base}, not in use` };
      const isClosed = closed.has(x.id);
      const toggle = locked
        ? undefined
        : () => {
            setClosed((cur) => {
              const next = new Set(cur);
              if (next.has(x.id)) next.delete(x.id);
              else next.add(x.id);
              return next;
            });
            setNote(null);
          };
      return { n, kind: isClosed ? 'closed' : 'seat', aria: `${base}${isClosed ? ', closed: tap to open' : ': tap to close for this event'}`, onToggle: toggle };
    }),
  }));

  async function save() {
    if (!sel) return;
    setBusy(true);
    setNote(null);
    try {
      const next = await api<EventSeating>(`/events/${eventId}/seating/sections/${sel.id}`, {
        method: 'PUT',
        body: { ticketTypeId: soldAs, closedSeatIds: [...closed].filter((id) => !live.has(id)) },
      });
      setData(next);
      await loadSeats(sel.id);
      setNote({ text: 'Saved.', bad: false });
      onChange();
    } catch (err) {
      setNote({ text: err instanceof ApiError ? err.message : 'Could not save', bad: true });
    } finally {
      setBusy(false);
    }
  }

  const pick = (id: string) => {
    if (id === selId) return;
    setSelId(id);
    setNote(null);
  };
  const seatedTypes = data.ticketTypes.filter((t) => t.seated);
  const assignedTo = (typeId: string) => data.sections.filter((s) => s.ticketTypeId === typeId).reduce((n, s) => n + s.seats - s.closed, 0);

  return (
    <section aria-label="Seating" className="vm-grid">
      <div className="vm-side">
        <div className="vm-lock"><Icon name="lock" size={15} /><span>{data.venue.name} map by Bantaba</span></div>
        {data.svg ? (
          <VenueMap
            svg={data.svg}
            looks={looks}
            selectedKey={sel?.key}
            onPick={(key) => {
              const s = data.sections.find((x) => x.key === key);
              if (s) pick(s.id);
            }}
            label={`${data.venue.name} map: tap a section`}
          />
        ) : (
          <div className="vm-list">
            {data.sections.map((s) => (
              <button key={s.id} className="vm-chip" aria-pressed={s.id === selId} style={{ background: colourOf(s.id === selId ? soldAs : s.ticketTypeId), color: (s.id === selId ? soldAs : s.ticketTypeId) ? '#fff' : 'var(--ink)' }} onClick={() => pick(s.id)}>
                {s.name}
              </button>
            ))}
          </div>
        )}
        <div className="vm-tiers">
          {seatedTypes.map((t) => (
            <div key={t.id} className="vm-tier">
              <i className="vm-sw" style={{ background: toneColour(t.tone), width: 14, height: 14 }} />
              <span>{t.name} <span className="muted">· {money(t.price, t.currency)}</span></span>
              <span className="num">{fmt(assignedTo(t.id))} seats</span>
            </div>
          ))}
          <div className="vm-tier">
            <i className="vm-sw" style={{ background: MAP.notOnSale, width: 14, height: 14 }} />
            <span>Not on sale</span>
            <span className="num">{data.sections.filter((s) => !s.ticketTypeId).length} sections</span>
          </div>
        </div>
      </div>

      <div className="vm-main">
        {!sel ? null : (
          <>
            <div className="vm-head">
              <h2>{sel.name}</h2>
              {sel.gate && <span>{sel.gate}</span>}
            </div>
            <div className="field">
              <label id="sold-as">Sold as</label>
              {data.ticketTypes.length === 0 ? (
                <p className="small muted">
                  Add a ticket type first, e.g. “VIP” at D1,500: <Link href="?tab=tickets" scroll={false}>Ticket types</Link>.
                </p>
              ) : (
                <div className="vm-pills" role="group" aria-labelledby="sold-as">
                  {data.ticketTypes.map((t) => (
                    <button
                      key={t.id}
                      type="button"
                      className="vm-pill"
                      aria-pressed={soldAs === t.id}
                      disabled={locked || (!t.canSeat && soldAs !== t.id)}
                      title={!t.canSeat ? 'Already sold without seats' : undefined}
                      onClick={() => {
                        setSoldAs(t.id);
                        setNote(null);
                      }}
                    >
                      <span className="vm-dot" style={{ background: toneColour(t.tone) }} />
                      {t.name} · {money(t.price, t.currency)}
                    </button>
                  ))}
                  <button type="button" className="vm-pill" aria-pressed={soldAs === null} disabled={locked} onClick={() => setSoldAs(null)}>
                    <span className="vm-dot" style={{ background: MAP.notOnSale }} />
                    Not on sale
                  </button>
                </div>
              )}
            </div>
            {!seats ? (
              <Loading />
            ) : total === 0 ? (
              <p className="small muted">No seats in this section yet.</p>
            ) : (
              <>
                <SeatGrid front={seats.frontLabel} rows={gridRows} cols={cols} hideCols={seats.numbering !== 'letters'} />
                <div className="vm-legend">
                  <span><i className="vm-sw" style={{ background: '#dbeafe', border: '1px solid #93c5fd' }} />Seat</span>
                  <span><i className="vm-sw" style={{ background: '#334155' }} />Closed for this event (tap or drag)</span>
                  <span><i className="vm-sw" style={{ background: '#e2e8f0' }} />Sold</span>
                  <strong style={{ marginLeft: 'auto', color: 'var(--ink)' }}>{fmt(open)} seats · {fmt(sold)} sold</strong>
                </div>
              </>
            )}
            {!locked && (
              <div className="vm-foot">
                <span className="small muted">{soldAs ? 'The layout is fixed; close seats you can’t sell (cameras, stage).' : 'Not on sale: buyers see it grey.'}</span>
                <button className="btn" onClick={save} disabled={busy || !dirty}>Save seating</button>
              </div>
            )}
            {note && <span role="status" className={`vm-note ${note.bad ? 'vm-note-bad' : 'vm-note-ok'}`}>{note.text}</span>}
          </>
        )}
      </div>
    </section>
  );
}
