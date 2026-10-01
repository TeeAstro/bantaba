'use client';

import { money } from '@/lib/format';

interface Day { date: string; tickets: number; revenue: number }

// Tickets sold per day, as bars. Days with no sales between the first and
// last sale are filled with zero so gaps read as gaps, not as squeezed-
// together bars. Capped to the most recent 45 days.
export function SalesChart({ days, currency }: { days: Day[]; currency: string }) {
  if (days.length === 0) {
    return <div className="empty"><p>No tickets sold yet.</p></div>;
  }

  const byDate = new Map(days.map((d) => [d.date, d]));
  const start = new Date(`${days[0].date}T00:00:00Z`);
  const end = new Date(`${days[days.length - 1].date}T00:00:00Z`);
  const series: Day[] = [];
  for (let t = start.getTime(); t <= end.getTime(); t += 86_400_000) {
    const key = new Date(t).toISOString().slice(0, 10);
    series.push(byDate.get(key) ?? { date: key, tickets: 0, revenue: 0 });
  }
  const shown = series.slice(-45);

  const W = 720, H = 180, padL = 32, padB = 22, padT = 8;
  const max = Math.max(1, ...shown.map((d) => d.tickets));
  const step = (W - padL) / shown.length;
  const barW = Math.max(2, Math.min(28, step * 0.7));
  const y = (n: number) => padT + (H - padT - padB) * (1 - n / max);
  const ticks = max <= 4 ? Array.from({ length: max + 1 }, (_, i) => i) : [0, Math.round(max / 2), max];
  const labelEvery = Math.ceil(shown.length / 8);
  const fmt = (iso: string) => new Date(`${iso}T00:00:00Z`).toLocaleDateString('en-GB', { day: 'numeric', month: 'short', timeZone: 'UTC' });

  return (
    <svg className="chart" viewBox={`0 0 ${W} ${H}`} role="img" aria-label={`Tickets sold per day, ${shown.length} days`}>
      {ticks.map((t) => (
        <g key={t}>
          <line className="grid" x1={padL} x2={W} y1={y(t)} y2={y(t)} />
          <text className="axis" x={padL - 6} y={y(t) + 4} textAnchor="end">{t}</text>
        </g>
      ))}
      {shown.map((d, i) => {
        const x = padL + i * step + (step - barW) / 2;
        return (
          <g key={d.date}>
            <rect className="bar" x={x} y={y(d.tickets)} width={barW} height={Math.max(0, H - padB - y(d.tickets))} rx={2}>
              <title>{`${fmt(d.date)}: ${d.tickets} tickets, ${money(d.revenue, currency)}`}</title>
            </rect>
            {i % labelEvery === 0 && (
              <text className="axis" x={x + barW / 2} y={H - 6} textAnchor="middle">{fmt(d.date)}</text>
            )}
          </g>
        );
      })}
    </svg>
  );
}
