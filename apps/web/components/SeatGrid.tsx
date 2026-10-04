'use client';

import { ReactNode, useEffect, useRef, useState } from 'react';

// A section's seats as a grid with row letters and seat numbers, for the
// admin and organizer seating screens (Phase 17). Gaps (seats taken out)
// keep their column so places line up. When the numbers run on through the
// section (A1–A30, B31–B50), each row's label carries its numbers
// ("B 31–50") and the column numbers are left out.
//
// Seats can be tapped one by one, or dragged across to do a run of them
// (taking out the end of a row, closing a block for cameras): the drag
// changes every seat it passes that started out like the first one.

export type CellKind = 'seat' | 'out' | 'closed' | 'sold' | 'held' | 'blocked';

export interface GridCell {
  n: number;
  kind: CellKind;
  aria: string;
  onToggle?: () => void;
}

export function SeatGrid({
  front,
  rows,
  cols,
  hideCols = false,
  endWidth = 0,
}: {
  front: string;
  // `end`: something after the row's seats, e.g. the admin's row size box.
  rows: { label: string; cells: GridCell[]; end?: ReactNode }[];
  cols: number;
  hideCols?: boolean;
  endWidth?: number;
}) {
  const grass = /pitch|field/i.test(front);
  const labelWidth = Math.max(20, ...rows.map((r) => r.label.length * 7));
  const cells = new Map<string, GridCell>();
  rows.forEach((row, ri) => row.cells.forEach((c) => cells.set(`${ri}:${c.n}`, c)));
  const drag = useRef<{ kind: CellKind; done: Set<string>; x: number; y: number } | null>(null);

  // Seats shrink (18px down to 5px, closer together when small) so a whole
  // row fits the panel; wider rows scroll.
  const box = useRef<HTMLDivElement>(null);
  const [width, setWidth] = useState(0);
  useEffect(() => {
    const el = box.current;
    if (!el) return;
    const ro = new ResizeObserver(() => setWidth(el.clientWidth));
    ro.observe(el);
    return () => ro.disconnect();
  }, []);
  const room = width - 24 - labelWidth - 3 - (endWidth ? endWidth + 6 : 0);
  const fit = (gap: number) => (width && cols ? Math.floor((room + gap) / cols) - gap : 18);
  const gap = fit(3) >= 10 ? 3 : 1;
  const cell = Math.max(5, Math.min(18, fit(gap)));

  const cellAt = (x: number, y: number) => {
    const el = document.elementFromPoint(x, y) as HTMLElement | null;
    return el?.closest<HTMLElement>('[data-cell]')?.dataset.cell ?? null;
  };
  const start = (e: React.PointerEvent<HTMLDivElement>) => {
    if (e.button !== 0) return;
    const k = cellAt(e.clientX, e.clientY);
    const c = k ? cells.get(k) : undefined;
    if (!k || !c?.onToggle) return;
    e.preventDefault();
    e.currentTarget.setPointerCapture(e.pointerId);
    drag.current = { kind: c.kind, done: new Set([k]), x: e.clientX, y: e.clientY };
    c.onToggle();
  };
  // Every seat on the way from the last point to this one, so a quick
  // drag doesn't skip any.
  const sweep = (x: number, y: number) => {
    const d = drag.current;
    if (!d) return;
    const steps = Math.max(1, Math.ceil(Math.hypot(x - d.x, y - d.y) / 4));
    for (let i = 1; i <= steps; i++) {
      const k = cellAt(d.x + ((x - d.x) * i) / steps, d.y + ((y - d.y) * i) / steps);
      const c = k ? cells.get(k) : undefined;
      if (!k || !c?.onToggle || d.done.has(k) || c.kind !== d.kind) continue;
      d.done.add(k);
      c.onToggle();
    }
    d.x = x;
    d.y = y;
  };
  const move = (e: React.PointerEvent<HTMLDivElement>) => sweep(e.clientX, e.clientY);
  const end = (e: React.PointerEvent<HTMLDivElement>) => {
    sweep(e.clientX, e.clientY);
    drag.current = null;
  };

  return (
    <div className="sg" ref={box} style={{ ['--cell' as string]: `${cell}px`, ['--gap' as string]: `${gap}px` }}>
      <div className={`sg-front${grass ? ' sg-front-grass' : ''}`}>{front}</div>
      <div className="sg-rows" onPointerDown={start} onPointerMove={move} onPointerUp={end} onPointerCancel={() => (drag.current = null)}>
        {!hideCols && (
          <div className="sg-row" aria-hidden="true">
            <span className="sg-label" style={{ width: labelWidth }} />
            {Array.from({ length: cols }, (_, i) => (
              <span key={i} className="sg-col">{i + 1}</span>
            ))}
          </div>
        )}
        {rows.map((row, ri) => (
          <div key={ri} className="sg-row">
            <span className="sg-label" style={{ width: labelWidth }}>{row.label}</span>
            {Array.from({ length: cols }, (_, i) => {
              const c = cells.get(`${ri}:${i + 1}`);
              if (!c) return <span key={i} className="sg-gap" />;
              return (
                <button
                  key={i}
                  type="button"
                  data-cell={`${ri}:${i + 1}`}
                  className={`sg-cell sg-${c.kind}`}
                  aria-label={c.aria}
                  aria-pressed={c.kind === 'out' || c.kind === 'closed'}
                  disabled={!c.onToggle}
                  // Pointer taps are handled on pointer down (for dragging);
                  // this is for the keyboard (Enter, Space), where detail is 0.
                  onClick={(e) => e.detail === 0 && c.onToggle?.()}
                >
                  {c.kind === 'sold' ? '×' : ''}
                </button>
              );
            })}
            {row.end && <span className="sg-end" style={{ width: endWidth }}>{row.end}</span>}
          </div>
        ))}
      </div>
    </div>
  );
}
