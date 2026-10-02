'use client';

import Link from 'next/link';
import { Icon } from '@/components/Icon';
import { dalasi } from '@/components/BarChart';

// The organizer's week at a glance (Phase 15): sales for each of the last 7
// days, today picked out, and one line on the next event's selling pace.
// The pace line answers the question organizers actually have: "will it
// sell out before the night?"

const DAY = 86_400_000;

export interface PaceEvent {
  id: string;
  name: string;
  startDate: string;
  status: string;
  capacity: number;
  ticketsSold: number;
  soldLast7: number; // tickets for this event in the last 7 days
}

export function WeekPulse({ days, next }: { days: { date: string; tickets: number; revenue: number }[]; next: PaceEvent | null }) {
  const week = days.slice(-7);
  const max = Math.max(1, ...week.map((d) => d.revenue));
  const best = week.reduce((a, d) => (d.revenue > a.revenue ? d : a), week[0]);
  const dayName = (iso: string, long = false) => new Date(`${iso}T00:00:00Z`).toLocaleDateString('en-GB', { timeZone: 'UTC', weekday: long ? 'long' : 'short' });

  return (
    <div className="pulse">
      <div className="pulse-bars" role="img" aria-label={`Sales per day, last 7 days: ${week.map((d) => `${dayName(d.date)} ${dalasi(d.revenue)}`).join(', ')}`}>
        {week.map((d, i) => {
          const today = i === week.length - 1;
          return (
            <div key={d.date} className={`pulse-day ${today ? 'is-today' : ''}`} title={`${dayName(d.date, true)}: ${dalasi(d.revenue)} · ${d.tickets} ${d.tickets === 1 ? 'ticket' : 'tickets'}`}>
              <div className="pulse-track">
                <span style={{ height: d.revenue > 0 ? `${Math.max(6, (d.revenue / max) * 100)}%` : 0 }} />
              </div>
              <span className="pulse-label">{today ? 'Today' : dayName(d.date)}</span>
            </div>
          );
        })}
      </div>
      <PaceLine next={next} best={best && best.revenue > 0 ? `${dayName(best.date, true)} (${dalasi(best.revenue)})` : null} />
    </div>
  );
}

function PaceLine({ next, best }: { next: PaceEvent | null; best: string | null }) {
  if (!next) {
    return best ? <p className="pace pace-plain"><Icon name="gauge" size={16} />Best day this week: {best}.</p> : null;
  }
  const remaining = Math.max(0, next.capacity - next.ticketsSold);
  const link = <Link href={`/organizer/events/${next.id}`}>{next.name}</Link>;
  if (next.status === 'SOLD_OUT' || remaining === 0) {
    return <p className="pace pace-good"><Icon name="gauge" size={16} /><span>{link} is sold out.</span></p>;
  }
  const perDay = next.soldLast7 / 7;
  const daysLeft = Math.max(0, (new Date(next.startDate).getTime() - Date.now()) / DAY);
  if (perDay === 0) {
    return <p className="pace pace-warn"><Icon name="gauge" size={16} /><span>No tickets sold for {link} in the last 7 days. Share it to get sales moving.</span></p>;
  }
  const rate = perDay >= 1 ? `about ${Math.round(perDay)} ${Math.round(perDay) === 1 ? 'ticket' : 'tickets'} a day` : 'fewer than 1 ticket a day';
  const daysToSellOut = remaining / perDay;
  if (daysToSellOut <= daysLeft) {
    const when = new Date(Date.now() + Math.ceil(daysToSellOut) * DAY).toLocaleDateString('en-GB', { timeZone: 'UTC', weekday: 'short', day: 'numeric', month: 'short' });
    return <p className="pace pace-good"><Icon name="gauge" size={16} /><span>{link} is selling {rate}: on track to sell out by {when}.</span></p>;
  }
  const unsold = Math.round(remaining - perDay * daysLeft);
  const left = unsold >= remaining * 0.9
    ? `At this pace most of the ${remaining.toLocaleString()} tickets left won't sell before it starts.`
    : `At this pace about ${unsold.toLocaleString()} of the ${remaining.toLocaleString()} tickets left will still be unsold when it starts.`;
  return (
    <p className="pace pace-warn">
      <Icon name="gauge" size={16} />
      <span>{link} is selling {rate}. {left}</span>
    </p>
  );
}
