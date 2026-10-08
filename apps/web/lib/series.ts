// Repeating events (Phase 24, docs/series.md): the same date rules as the
// API (apps/backend/src/series/series-rule.ts), for the host's preview.
// Banjul is on UTC all year, so days and weekdays are UTC ones.

export type Frequency = 'WEEKLY' | 'BIWEEKLY' | 'MONTHLY';
export type SeriesEnd = 'DATE' | 'COUNT' | 'OPEN';
export interface Repeat { frequency: Frequency; endMode: SeriesEnd; endsOn?: string; count?: number }

const DAY = 86_400_000;
const WEEKDAYS = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];
const ORDINALS = ['First', 'Second', 'Third', 'Fourth'];
export const KEEP_AHEAD = 8;
export const MAX_SESSIONS = 52;

const nthOfMonth = (d: Date): number | 'last' => {
  const n = Math.ceil(d.getUTCDate() / 7);
  return n >= 5 ? 'last' : n;
};

export function occurrence(anchor: Date, frequency: Frequency, n: number): Date {
  if (frequency === 'WEEKLY') return new Date(anchor.getTime() + n * 7 * DAY);
  if (frequency === 'BIWEEKLY') return new Date(anchor.getTime() + n * 14 * DAY);
  const weekday = anchor.getUTCDay();
  const nth = nthOfMonth(anchor);
  const timeOfDay = anchor.getTime() - Date.UTC(anchor.getUTCFullYear(), anchor.getUTCMonth(), anchor.getUTCDate());
  const y = anchor.getUTCFullYear();
  const m = anchor.getUTCMonth() + n;
  let day: number;
  if (nth === 'last') {
    const last = new Date(Date.UTC(y, m + 1, 0));
    day = last.getUTCDate() - ((last.getUTCDay() - weekday + 7) % 7);
  } else {
    const first = new Date(Date.UTC(y, m, 1));
    day = 1 + ((weekday - first.getUTCDay() + 7) % 7) + (nth - 1) * 7;
  }
  return new Date(Date.UTC(y, m, day) + timeOfDay);
}

export function seriesLabel(frequency: Frequency, anchor: Date): string {
  const wd = WEEKDAYS[anchor.getUTCDay()];
  if (frequency === 'WEEKLY') return `Every ${wd}`;
  if (frequency === 'BIWEEKLY') return `Every other ${wd}`;
  const nth = nthOfMonth(anchor);
  return `${nth === 'last' ? 'Last' : ORDINALS[nth - 1]} ${wd} of the month`;
}

/** The first `max` session starts. */
export function previewDates(r: Repeat, anchor: Date, max = KEEP_AHEAD): Date[] {
  const out: Date[] = [];
  const lastDay = r.endsOn ? Date.UTC(+r.endsOn.slice(0, 4), +r.endsOn.slice(5, 7) - 1, +r.endsOn.slice(8, 10)) + DAY : null;
  for (let n = 0; out.length < max; n++) {
    if (r.endMode !== 'OPEN' && n >= MAX_SESSIONS) break;
    if (r.endMode === 'COUNT' && n >= (r.count ?? 1)) break;
    const d = occurrence(anchor, r.frequency, n);
    if (r.endMode === 'DATE' && (lastDay === null || d.getTime() >= lastDay)) break;
    out.push(d);
  }
  return out;
}

/** How many sessions in all (null = keeps going). */
export function totalSessions(r: Repeat, anchor: Date): number | null {
  if (r.endMode === 'OPEN') return null;
  return previewDates(r, anchor, MAX_SESSIONS).length;
}
