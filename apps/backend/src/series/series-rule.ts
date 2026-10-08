import { SeriesEnd, SeriesFrequency } from '@prisma/client';

// When the sessions of a repeating event fall (docs/series.md). Banjul is
// on UTC all year, so days and weekdays are UTC ones.

const DAY = 86_400_000;
const WEEKDAYS = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];
const ORDINALS = ['first', 'second', 'third', 'fourth'];

/** Sessions kept on sale ahead for a series that keeps going. */
export const KEEP_AHEAD = 8;
/** At most this many sessions in a series with an end date or a count. */
export const MAX_SESSIONS = 52;

// Which weekday of its month a date is: 1–4, or 'last' from the 29th on
// (there isn't always a fifth Saturday).
function nthOfMonth(d: Date): number | 'last' {
  const n = Math.ceil(d.getUTCDate() / 7);
  return n >= 5 ? 'last' : n;
}

/** The n-th session's start (n = 0 is the anchor itself). */
export function occurrence(anchor: Date, frequency: SeriesFrequency, n: number): Date {
  if (frequency === SeriesFrequency.WEEKLY) return new Date(anchor.getTime() + n * 7 * DAY);
  if (frequency === SeriesFrequency.BIWEEKLY) return new Date(anchor.getTime() + n * 14 * DAY);
  const weekday = anchor.getUTCDay();
  const nth = nthOfMonth(anchor);
  const timeOfDay = anchor.getTime() - Date.UTC(anchor.getUTCFullYear(), anchor.getUTCMonth(), anchor.getUTCDate());
  const y = anchor.getUTCFullYear();
  const m = anchor.getUTCMonth() + n;
  let day: number;
  if (nth === 'last') {
    const last = new Date(Date.UTC(y, m + 1, 0)); // last day of month m
    day = last.getUTCDate() - ((last.getUTCDay() - weekday + 7) % 7);
  } else {
    const first = new Date(Date.UTC(y, m, 1));
    day = 1 + ((weekday - first.getUTCDay() + 7) % 7) + (nth - 1) * 7;
  }
  return new Date(Date.UTC(y, m, day) + timeOfDay);
}

/** "Every Saturday", "Every other Saturday", "First Saturday of the month". */
export function seriesLabel(frequency: SeriesFrequency, anchor: Date): string {
  const wd = WEEKDAYS[anchor.getUTCDay()];
  if (frequency === SeriesFrequency.WEEKLY) return `Every ${wd}`;
  if (frequency === SeriesFrequency.BIWEEKLY) return `Every other ${wd}`;
  const nth = nthOfMonth(anchor);
  const which = nth === 'last' ? 'Last' : ORDINALS[nth - 1][0].toUpperCase() + ORDINALS[nth - 1].slice(1);
  return `${which} ${wd} of the month`;
}

/** What a card shows instead of a date: "EVERY SAT", "MONTHLY". */
export function seriesBadge(frequency: SeriesFrequency, anchor: Date) {
  const day = WEEKDAYS[anchor.getUTCDay()].slice(0, 3).toUpperCase();
  const top = frequency === SeriesFrequency.MONTHLY ? 'Monthly' : frequency === SeriesFrequency.BIWEEKLY ? 'Every 2 wks' : 'Every';
  return { top, day };
}

export interface SeriesRule {
  frequency: SeriesFrequency;
  endMode: SeriesEnd;
  endsOn: Date | null;
  count: number | null;
}

/** Whether session n is part of the series at all (ignoring "keep going"). */
export function withinEnd(rule: SeriesRule, anchor: Date, n: number): boolean {
  if (n >= MAX_SESSIONS && rule.endMode !== SeriesEnd.OPEN) return false;
  if (rule.endMode === SeriesEnd.COUNT) return n < (rule.count ?? 1);
  if (rule.endMode === SeriesEnd.DATE) {
    if (!rule.endsOn) return n === 0;
    const lastDay = Date.UTC(rule.endsOn.getUTCFullYear(), rule.endsOn.getUTCMonth(), rule.endsOn.getUTCDate()) + DAY;
    return occurrence(anchor, rule.frequency, n).getTime() < lastDay;
  }
  return true;
}

/** The first `max` session starts, for the host's preview. */
export function preview(rule: SeriesRule, anchor: Date, max = KEEP_AHEAD): Date[] {
  const out: Date[] = [];
  for (let n = 0; out.length < max && withinEnd(rule, anchor, n); n++) out.push(occurrence(anchor, rule.frequency, n));
  return out;
}
