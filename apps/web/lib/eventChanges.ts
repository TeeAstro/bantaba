import type { EventRecord, ReviewedField } from './types';

// docs/event-change-review.md
export const FIELD_LABELS: Record<ReviewedField, string> = {
  name: 'name', description: 'description', startDate: 'start time', endDate: 'end time', venueId: 'venue', posterUrl: 'poster', bannerUrl: 'banner',
};

/** Changes still waiting for an admin, or {} */
export function pendingChanges(e: EventRecord) {
  return e.changeRequest?.status === 'PENDING' ? e.changeRequest.changes : {};
}

/** The event as it will look once the waiting changes are approved: what the organizer edits. */
export function withPending(e: EventRecord): EventRecord {
  const c = pendingChanges(e);
  const v = <K extends ReviewedField>(k: K, cur: EventRecord[K]) => (k in c ? (c[k] as EventRecord[K]) : cur);
  return {
    ...e,
    name: v('name', e.name),
    description: v('description', e.description),
    startDate: v('startDate', e.startDate),
    endDate: v('endDate', e.endDate),
    venueId: v('venueId', e.venueId),
    posterUrl: v('posterUrl', e.posterUrl),
    bannerUrl: v('bannerUrl', e.bannerUrl),
  };
}

/** "name, date and poster": fixed order, start and end shown as one "date" */
const ORDER: ReviewedField[] = ['name', 'description', 'startDate', 'endDate', 'venueId', 'posterUrl', 'bannerUrl'];
export function fieldList(fields: string[]): string {
  const names = [...new Set(ORDER.filter((f) => fields.includes(f)).map((f) => (f === 'startDate' || f === 'endDate' ? 'date' : FIELD_LABELS[f])))];
  return names.length <= 1 ? names.join('') : `${names.slice(0, -1).join(', ')} and ${names[names.length - 1]}`;
}
