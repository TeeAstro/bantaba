'use client';

import { ReactNode } from 'react';

// One headline figure with a bar showing what it's made of, and smaller
// figures stacked beside it (Phase 15). The split bar gives the headline
// panel real content, so it isn't a big box around one number, and the two
// columns come out about the same height.

export interface Part {
  label: string;
  value: number; // minor units or a count; only used for the proportions
  shown: string; // formatted value
  other?: boolean; // the "N other …" bucket, drawn grey
}

export interface SideStat {
  label: string;
  value: ReactNode;
  note?: ReactNode; // a Delta, a link or a short line, on the right
  extra?: ReactNode; // e.g. a meter under the value
  tone?: 'alert';
}

// Validated categorical order (dataviz validator, light surface): blue,
// orange, aqua; "Other" is neutral grey. Colour follows position in the
// list, which callers keep in a fixed order (largest first, then Other).
const SLOTS = ['#2a78d6', '#eb6834', '#1baf7a'];
const OTHER = '#cbd5e1';

export function HeroStats({
  label,
  period,
  value,
  change,
  parts = [],
  partsTitle = '',
  body,
  emptyText = 'Nothing sold in this period yet.',
  side,
  aria,
}: {
  label: string;
  period?: string;
  value: ReactNode;
  change?: ReactNode;
  parts?: Part[]; // largest first; an "other" bucket last
  partsTitle?: string; // e.g. "By event", for screen readers and the tooltip
  body?: ReactNode; // shown instead of the split bar
  emptyText?: string;
  side: SideStat[];
  aria: string;
}) {
  const total = parts.reduce((n, p) => n + Math.max(0, p.value), 0);
  const colour = (i: number, p: Part) => (p.other ? OTHER : SLOTS[i] ?? OTHER);

  return (
    <section className="hstats" aria-label={aria}>
      <div className="hstat-main">
        <div className="hstat-head">
          <div className="hstat-top">
            <span className="hstat-label">{label}</span>
            {period && <span className="hstat-period">{period}</span>}
          </div>
          <div className="hstat-figure">
            <span className="hstat-value">{value}</span>
            {change}
          </div>
        </div>
        {body ? body : total > 0 ? (
          <>
            <div className="split-bar" role="img" aria-label={`${partsTitle}: ${parts.map((p) => `${p.label} ${p.shown}`).join(', ')}`}>
              {parts.map((p, i) =>
                p.value > 0 ? (
                  <span key={p.label} style={{ flexGrow: p.value, background: colour(i, p) }} title={`${p.label}: ${p.shown} (${Math.round((p.value / total) * 100)}%)`} />
                ) : null,
              )}
            </div>
            <ul className="split-legend">
              {parts.map((p, i) => (
                <li key={p.label}>
                  <span className="split-name"><i style={{ background: colour(i, p) }} />{p.label}</span>
                  <span className="split-value">{p.shown} <span className="split-pct">{Math.round((p.value / total) * 100)}%</span></span>
                </li>
              ))}
            </ul>
          </>
        ) : (
          <>
            <div className="split-bar split-empty" aria-hidden />
            <p className="split-none">{emptyText}</p>
          </>
        )}
      </div>
      <div className="hstat-side">
        {side.map((x) => (
          <div key={x.label} className={`hstat-card ${x.tone === 'alert' ? 'hstat-alert' : ''}`}>
            <div className="hstat-card-text">
              <span className="hstat-card-label">{x.label}</span>
              <span className="hstat-small">{x.value}</span>
              {x.extra}
            </div>
            {x.note && <span className="hstat-note">{x.note}</span>}
          </div>
        ))}
      </div>
    </section>
  );
}
