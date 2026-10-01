import { CancellationRefundMode, EventStatus, RefundPolicy } from '@prisma/client';

// When may a ticket holder ask for their money back? (docs/refunds-transfers.md)
//
//   1. Event cancelled, organizer chose to handle refunds → yes, any time.
//      (Cancelled with automatic refunds → no: they've been refunded.)
//   2. Event's date/time or venue changed after they bought → yes, until it starts,
//      whatever the policy says. They bought for a different date or place.
//   3. Otherwise the event's refund policy, until the start:
//        NONE → no; ANYTIME → yes; UNTIL_DAYS_BEFORE → until N days before.
//
// Only for tickets still valid (not scanned, refunded or cancelled), held
// by the person who paid for them. A ticket someone received as a
// transfer can't be refunded to them: the money went to the buyer.

export interface RuleEvent {
  status: EventStatus;
  startDate: Date;
  refundPolicy: RefundPolicy;
  refundDaysBefore: number | null;
  scheduleChangedAt: Date | null;
  cancellationRefundMode: CancellationRefundMode | null;
}

export type Eligibility =
  | { allowed: true; basis: 'cancelled' | 'changed' | 'policy'; includeFee: boolean; until: Date | null }
  | { allowed: false; reason: string };

const DAY = 86_400_000;

export function refundEligibility(
  event: RuleEvent,
  ticket: { status: string; ownerId: string; purchasedAt: Date },
  order: { customerId: string },
  now = new Date(),
): Eligibility {
  if (ticket.ownerId !== order.customerId) {
    return { allowed: false, reason: 'This ticket was transferred to you, so the refund belongs to the person who bought it.' };
  }
  if (ticket.status === 'USED') return { allowed: false, reason: 'This ticket has already been used to get in.' };
  if (ticket.status === 'REFUNDED') return { allowed: false, reason: 'This ticket has already been refunded.' };
  if (ticket.status !== 'ACTIVE') return { allowed: false, reason: 'This ticket is no longer valid.' };

  if (event.status === EventStatus.CANCELLED) {
    if (event.cancellationRefundMode === CancellationRefundMode.AUTOMATIC) {
      return { allowed: false, reason: 'The event was cancelled and everyone is being refunded automatically.' };
    }
    return { allowed: true, basis: 'cancelled', includeFee: true, until: null };
  }
  if (event.status !== EventStatus.PUBLISHED && event.status !== EventStatus.SOLD_OUT) {
    return { allowed: false, reason: 'Refunds can only be requested for upcoming events.' };
  }
  if (now >= event.startDate) return { allowed: false, reason: 'The event has already started.' };

  if (event.scheduleChangedAt && ticket.purchasedAt < event.scheduleChangedAt) {
    return { allowed: true, basis: 'changed', includeFee: false, until: event.startDate };
  }

  switch (event.refundPolicy) {
    case RefundPolicy.ANYTIME:
      return { allowed: true, basis: 'policy', includeFee: false, until: event.startDate };
    case RefundPolicy.UNTIL_DAYS_BEFORE: {
      const until = new Date(event.startDate.getTime() - (event.refundDaysBefore ?? 0) * DAY);
      return now <= until
        ? { allowed: true, basis: 'policy', includeFee: false, until }
        : { allowed: false, reason: `Refunds closed ${event.refundDaysBefore} day${event.refundDaysBefore === 1 ? '' : 's'} before the event.` };
    }
    default:
      return { allowed: false, reason: 'This event doesn’t offer refunds.' };
  }
}

export function policyText(e: Pick<RuleEvent, 'refundPolicy' | 'refundDaysBefore'>): string {
  switch (e.refundPolicy) {
    case RefundPolicy.ANYTIME:
      return 'Refunds on request until the event starts (booking fee not refunded).';
    case RefundPolicy.UNTIL_DAYS_BEFORE:
      return `Refunds on request until ${e.refundDaysBefore} day${e.refundDaysBefore === 1 ? '' : 's'} before the event (booking fee not refunded).`;
    default:
      return 'No refunds on request. You get your money back if the event is cancelled, and can ask for it if the date or venue changes.';
  }
}
