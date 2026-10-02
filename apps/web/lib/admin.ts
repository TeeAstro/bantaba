'use client';

// Admin dashboard (Phase 14, docs/admin-dashboard.md): response types and
// the shared "needs attention" counts the layout keeps for the sidebar.

import { createContext, useContext } from 'react';
import type { OrganizerPermissions, Payout, PayoutAccount } from './types';

export interface AttentionCounts {
  eventsInReview: number;
  payoutRequests: number;
  payoutsToSend: number;
  payoutsToSendAuto: number;
  payoutAccountsToCheck: number;
  manualRefundsToPay: number;
  failedProviderRefunds: number;
  failedEmails: number;
  cardPaymentsFlagged: number;
  organizersPending: number;
  lookalikeWarnings: number;
}

export interface Attention {
  counts: AttentionCounts;
  oldest: Partial<Record<keyof AttentionCounts, string | null>>;
  total: number;
}

export const AttentionContext = createContext<{ attention: Attention | null; refresh: () => void }>({
  attention: null,
  refresh: () => undefined,
});
export const useAttention = () => useContext(AttentionContext);

export type VerificationStatus = 'PENDING' | 'APPROVED' | 'REJECTED' | 'SUSPENDED';
export type TrustLevel = 'NEW' | 'TRUSTED';

export interface AdminOrganizer {
  id: string;
  businessName: string;
  email: string;
  contactName: string | null;
  verificationStatus: VerificationStatus;
  verifiedAt: string | null;
  trustLevel: TrustLevel;
  verifiedBadge: boolean;
  verifiedBadgeAt: string | null;
  lookalikeOf: { id: string; businessName: string } | null;
  payoutAdvancePercent: number;
  payoutAutoApprove: boolean;
  payoutAutoApproveMax: number | null;
  payoutAccount: (Omit<PayoutAccount, 'verifiedAt'> & { verified: boolean }) | null;
  overrides: {
    requireEventReview: boolean | null;
    canConfirmBankTransfers: boolean | null;
    canHandleCancellationRefunds: boolean | null;
    customLimits: boolean;
    maxTicketsPerEvent: number | null;
    maxTicketPrice: number | null;
  };
  levelDefaults: Omit<OrganizerPermissions, 'trustLevel'> & Record<string, unknown>;
  permissions: OrganizerPermissions;
  note: string | null;
  trustUpdatedAt: string | null;
  events: number;
  createdAt: string;
  stats?: { ticketsSold: number; refunds: number; eventsInReview: number };
}

export interface ReviewEvent {
  id: string;
  name: string;
  startDate: string;
  endDate: string;
  submittedForReviewAt: string | null;
  venue: { name: string; city: string | null } | null;
  organizer: { id: string; businessName: string; trustLevel: TrustLevel; verifiedBadge: boolean; user: { email: string }; lookalikeOf: { id: string; businessName: string } | null };
  description: string | null;
  posterUrl: string | null;
  bannerUrl: string | null;
  ticketTypes: { name: string; price: number; quantityTotal: number }[];
  contactEmail: string | null;
}

export interface AdminPayout extends Payout {
  organizer: { id: string; businessName: string; verificationStatus: VerificationStatus; trustLevel: TrustLevel };
  accountWarning: string | null;
}

export interface AdminRefund {
  id: string;
  status: 'REQUESTED' | 'APPROVED' | 'REJECTED' | 'PROCESSED' | 'WITHDRAWN';
  kind: string;
  method: 'PROVIDER' | 'MANUAL';
  amount: number;
  feeAmount: number;
  currency: string;
  reason: string | null;
  decisionNote: string | null;
  decidedAt: string | null;
  processedAt: string | null;
  reference: string | null;
  lastError: string | null;
  createdAt: string;
  provider: string;
  order: { id: string; total: number; event?: { id: string; name: string } };
  customer: { id: string; email: string; fullName: string | null } | null;
  tickets: { id: string; ticketType: string; seat: string | null; status: string; amount: number }[];
}

export interface CardFlag {
  paymentId: string;
  amount: number;
  currency: string;
  providerReference: string | null;
  chargeId: string | null;
  paidAt: string | null;
  flaggedAt: string;
  status: 'OPEN' | 'RESOLVED';
  resolution: { reference: string; note: string | null; byId: string; at: string } | null;
  order: { id: string; status: string; total: number };
  customer: { id: string; email: string; fullName: string | null };
  event: { id: string; name: string };
}

export interface AdminNotification {
  id: string;
  type: string;
  status: 'PENDING' | 'SENT' | 'FAILED' | 'CANCELLED';
  channel: string;
  toAddress: string;
  subject: string | null;
  attempts: number;
  lastError: string | null;
  sendAfter: string;
  sentAt: string | null;
  createdAt: string;
  eventId: string | null;
  orderId: string | null;
}

export interface AuditEntry {
  id: string;
  action: string;
  entityType: string;
  entityId: string | null;
  metadata: unknown;
  createdAt: string;
  actor: { id: string; role: string | null; email: string | null; name: string | null } | null;
}

export interface Paged<T> {
  page: number;
  pageSize: number;
  total: number;
  items: T[];
}

// "organizer_trust_updated" -> "Organizer trust updated"
export const actionLabel = (a: string) => (a.charAt(0).toUpperCase() + a.slice(1)).replace(/_/g, ' ');

// "3 days", "5 hours": how long something has been waiting.
export function waitingFor(iso: string | null | undefined, now = Date.now()): string | null {
  if (!iso) return null;
  const mins = Math.max(0, Math.round((now - new Date(iso).getTime()) / 60000));
  if (mins < 60) return `${mins} min`;
  const hours = Math.round(mins / 60);
  if (hours < 48) return `${hours} hour${hours === 1 ? '' : 's'}`;
  const days = Math.round(hours / 24);
  return `${days} days`;
}
