'use client';

import { useEffect, useRef, useState } from 'react';

// Bars over time for the dashboards (Phase 15). Optionally a lighter bar
// beside each one for the same slot in the previous period. Amounts are in
// minor units; the axis rounds to a readable step.

export interface Slot {
  label: string; // shown under the bar when there's room, and in the tooltip
  value: number;
  previous?: number;
  future?: boolean; // later in the period than now: drawn empty
}

const niceMax = (n: number) => {
  if (n <= 0) return 1;
  const p = 10 ** Math.floor(Math.log10(n));
  const f = n / p;
  return (f <= 1 ? 1 : f <= 2 ? 2 : f <= 2.5 ? 2.5 : f <= 5 ? 5 : 10) * p;
};

export function BarChart({
  slots,
  format,
  axisFormat = format,
  height = 200,
  label,
  showPrevious = false,
  labelEvery,
  width = 900,
}: {
  slots: Slot[];
  format: (n: number) => string;
  axisFormat?: (n: number) => string;
  height?: number;
  label: string;
  showPrevious?: boolean;
  labelEvery?: number;
  width?: number; // drawing width; roughly the space it gets, so the text stays its normal size
}) {
  // Drawn at the width it actually gets, so labels stay readable on a phone.
  const ref = useRef<SVGSVGElement>(null);
  const [measured, setMeasured] = useState<number | null>(null);
  useEffect(() => {
    const el = ref.current?.parentElement;
    if (!el || typeof ResizeObserver === 'undefined') return;
    const ro = new ResizeObserver(([e]) => setMeasured(Math.round(e.contentRect.width)));
    ro.observe(el);
    return () => ro.disconnect();
  }, []);
  const W = measured && measured > 0 ? measured : width;
  const narrow = W < 520;
  const H = height;
  const padL = narrow ? 44 : 56, padB = 24, padT = 8;
  const max = niceMax(Math.max(0, ...slots.map((s) => Math.max(s.value, showPrevious ? s.previous ?? 0 : 0))));
  const step = (W - padL) / Math.max(1, slots.length);
  const group = Math.min(44, step * 0.78);
  const barW = showPrevious ? group / 2 - 1 : group;
  const y = (n: number) => padT + (H - padT - padB) * (1 - n / max);
  const every = Math.max(labelEvery ?? Math.ceil(slots.length / 6), narrow ? Math.ceil(slots.length / 4) : 1);
  // Counts don't get a half-way line at 2.5.
  const whole = slots.every((x) => Number.isInteger(x.value));
  const ticks = whole && !Number.isInteger(max / 2) ? [0, max] : [0, max / 2, max];

  return (
    <svg ref={ref} className="chart bar-chart" width={W} height={H} viewBox={`0 0 ${W} ${H}`} role="img" aria-label={label}>
      {ticks.map((t) => (
        <g key={t}>
          <line className="grid" x1={padL} x2={W} y1={y(t)} y2={y(t)} />
          <text className="axis" x={padL - 8} y={y(t) + 4} textAnchor="end">{axisFormat(t)}</text>
        </g>
      ))}
      {slots.map((s, i) => {
        const x0 = padL + i * step + (step - group) / 2;
        const tip = `${s.label}: ${format(s.value)}${showPrevious ? ` (before: ${format(s.previous ?? 0)})` : ''}`;
        return (
          <g key={i}>
            <title>{tip}</title>
            {showPrevious && (
              <rect className="bar-prev" x={x0} y={y(s.previous ?? 0)} width={barW} height={Math.max(0, H - padB - y(s.previous ?? 0))} rx={2} />
            )}
            {!s.future && (
              <rect className="bar" x={showPrevious ? x0 + barW + 2 : x0} y={y(s.value)} width={barW} height={Math.max(0, H - padB - y(s.value))} rx={2} />
            )}
            {(i === slots.length - 1 || (i % every === 0 && (slots.length - 1 - i) * step > 64)) && (
              <text className="axis" x={i === slots.length - 1 ? Math.min(W - 1, x0 + group) : x0 + group / 2} y={H - 6} textAnchor={i === slots.length - 1 ? 'end' : 'middle'}>{s.label}</text>
            )}
          </g>
        );
      })}
    </svg>
  );
}

/** Whole dalasi, no decimals: D12,400. For axes and big figures. */
export function dalasi(minor: number) {
  return `D${Math.round(minor / 100).toLocaleString('en-GB')}`;
}

/** Short dalasi for chart axes: D15k, D1.2m. */
export function dalasiShort(minor: number) {
  const d = minor / 100;
  if (d >= 1_000_000) return `D${+(d / 1_000_000).toFixed(1)}m`;
  if (d >= 1000) return `D${+(d / 1000).toFixed(1)}k`;
  return `D${Math.round(d)}`;
}

/** A coloured "↗ 12%" label against the previous period, or null when there's nothing to compare with. */
export function Delta({ value, previous, goodWhenDown = false, suffix = '' }: { value: number; previous: number; goodWhenDown?: boolean; suffix?: string }) {
  if (!previous) return null;
  const change = Math.round(((value - previous) / previous) * 100);
  if (change === 0) return <span className="delta delta-flat">no change{suffix}</span>;
  const up = change > 0;
  const good = up !== goodWhenDown;
  return (
    <span className={`delta ${good ? 'delta-good' : 'delta-bad'}`}>
      <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2.5} strokeLinecap="round" strokeLinejoin="round" aria-hidden>
        {up ? <><path d="M22 7 13.5 15.5 8.5 10.5 2 17" /><path d="M16 7h6v6" /></> : <><path d="M22 17 13.5 8.5 8.5 13.5 2 7" /><path d="M16 17h6v-6" /></>}
      </svg>
      <span className="sr-only">{up ? 'up' : 'down'}</span>
      {up ? '+' : '−'}{Math.abs(change)}%{suffix}
    </span>
  );
}
