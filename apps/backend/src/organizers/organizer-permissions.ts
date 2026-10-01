import { ForbiddenException } from '@nestjs/common';
import { Organizer, OrganizerTrustLevel, OrganizerVerificationStatus } from '@prisma/client';

// What an organizer is allowed to do (docs/organizer-trust.md).
//
// Every approved organizer starts as NEW, with the restrictions that block
// the common ticketing scams: a fake event goes live only after an admin
// has looked at it; they can't mark bank transfers as paid (customers pay
// the platform's account, so a false "paid" would be money that doesn't
// exist); cancelling always refunds everyone; and each event has ticket
// and price limits, so a fraud can't take much before it's noticed.
// An admin promotes them to TRUSTED, or loosens/tightens single
// permissions with per-organizer overrides.

export interface OrganizerPermissions {
  trustLevel: OrganizerTrustLevel;
  verificationStatus: OrganizerVerificationStatus;
  canPublish: boolean; // approved (not pending, rejected or suspended)
  canSell: boolean; // not suspended: suspension stops sales at once
  requireEventReview: boolean;
  canConfirmBankTransfers: boolean;
  canHandleCancellationRefunds: boolean;
  maxTicketsPerEvent: number | null; // null = no limit
  maxTicketPrice: number | null; // minor units; null = no limit
}

const num = (v: string | undefined, d: number) => (v !== undefined && v !== '' && !Number.isNaN(Number(v)) ? Number(v) : d);

// Level defaults. The NEW limits can be changed with env vars.
export function levelDefaults(level: OrganizerTrustLevel) {
  if (level === OrganizerTrustLevel.TRUSTED) {
    return { requireEventReview: false, canConfirmBankTransfers: true, canHandleCancellationRefunds: true, maxTicketsPerEvent: null, maxTicketPrice: null };
  }
  return {
    requireEventReview: true,
    canConfirmBankTransfers: false,
    canHandleCancellationRefunds: false,
    maxTicketsPerEvent: num(process.env.NEW_ORGANIZER_MAX_TICKETS_PER_EVENT, 300) as number | null,
    maxTicketPrice: num(process.env.NEW_ORGANIZER_MAX_TICKET_PRICE, 250_000) as number | null, // D2,500.00
  };
}

export function organizerPermissions(o: Pick<Organizer, 'trustLevel' | 'verificationStatus' | 'requireEventReview' | 'canConfirmBankTransfers' | 'canHandleCancellationRefunds' | 'customLimits' | 'maxTicketsPerEvent' | 'maxTicketPrice'>): OrganizerPermissions {
  const d = levelDefaults(o.trustLevel);
  return {
    trustLevel: o.trustLevel,
    verificationStatus: o.verificationStatus,
    canPublish: o.verificationStatus === OrganizerVerificationStatus.APPROVED,
    canSell: o.verificationStatus !== OrganizerVerificationStatus.SUSPENDED,
    requireEventReview: o.requireEventReview ?? d.requireEventReview,
    canConfirmBankTransfers: o.canConfirmBankTransfers ?? d.canConfirmBankTransfers,
    canHandleCancellationRefunds: o.canHandleCancellationRefunds ?? d.canHandleCancellationRefunds,
    maxTicketsPerEvent: o.customLimits ? o.maxTicketsPerEvent : d.maxTicketsPerEvent,
    maxTicketPrice: o.customLimits ? o.maxTicketPrice : d.maxTicketPrice,
  };
}

const money = (minor: number) => `D${(minor / 100).toLocaleString('en-GB', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;

// Ticket limits for one event: all its ticket types together (after the
// change being made) and each price.
export function assertWithinLimits(p: OrganizerPermissions, totalTickets: number, prices: number[]) {
  if (p.maxTicketsPerEvent !== null && totalTickets > p.maxTicketsPerEvent) {
    throw new ForbiddenException(
      `Your account can sell up to ${p.maxTicketsPerEvent} tickets per event (this would make ${totalTickets}). Contact the platform to raise the limit.`,
    );
  }
  const top = Math.max(0, ...prices);
  if (p.maxTicketPrice !== null && top > p.maxTicketPrice) {
    throw new ForbiddenException(`Your account can sell tickets up to ${money(p.maxTicketPrice)} each. Contact the platform to raise the limit.`);
  }
}
