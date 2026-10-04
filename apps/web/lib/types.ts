// Response shapes of the backend endpoints the organizer UI uses.

// docs/organizer-trust.md
export interface OrganizerPermissions {
  trustLevel: 'NEW' | 'TRUSTED';
  verificationStatus: string;
  canPublish: boolean;
  canSell: boolean;
  requireEventReview: boolean;
  canConfirmBankTransfers: boolean;
  canHandleCancellationRefunds: boolean;
  maxTicketsPerEvent: number | null;
  maxTicketPrice: number | null;
}

export interface Overview {
  organizer: { id: string; businessName: string; slug: string; logoUrl: string | null; verificationStatus: string; verified: boolean; permissions: OrganizerPermissions };
  eventsByStatus: Record<string, number>;
  totals: {
    paidOrders: number;
    ticketsSold: number;
    checkedIn: number;
    ticketRevenue: number;
    platformFees: number;
    grossCollected: number;
    currency: string;
  };
  upcoming: {
    id: string;
    name: string;
    status: string;
    startDate: string;
    venue: string;
    posterUrl: string | null;
    capacity: number;
    ticketsSold: number;
    soldToday: number;
    staff: number;
  }[];
  // Phase 15
  salesByDay: { date: string; tickets: number; revenue: number }[];
  thisWeek: { tickets: number; revenue: number; byEvent: { id: string; name: string; tickets: number; revenue: number }[] };
  lastWeek: { tickets: number; revenue: number };
  payouts: { available: number; inProgress: number; held: number };
  lastEvent: { id: string; name: string; endDate: string; ticketsSold: number; checkedIn: number } | null;
  todo: {
    refundRequests: { count: number; oldestAt: string | null; event: { id: string; name: string } | null };
    changesInReview: { id: string; name: string }[];
    eventsInReview: number;
    sentBack: { id: string; name: string }[];
    payoutAccount: { method: 'WAVE' | 'BANK' | null; account: string | null; verified: boolean };
  };
  recentOrders: {
    id: string;
    event: { id: string; name: string };
    customer: { email: string; fullName: string | null };
    total: number;
    currency: string;
    tickets: number;
    items?: { ticketType: string; quantity: number }[];
    paidAt: string;
  }[];
}

export interface EventSummary {
  id: string;
  name: string;
  slug: string;
  status: string;
  startDate: string;
  endDate: string;
  venue: { id: string; name: string };
  category: { name: string };
  changesInReview?: boolean; // docs/event-change-review.md
}

export interface TicketTypeStat {
  id: string;
  name: string;
  category: string;
  price: number;
  currency: string;
  quantityTotal: number;
  sold: number;
  reservedPending: number;
  remaining: number;
  revenue: number;
  isActive: boolean;
  salesStart?: string | null;
  salesEnd?: string | null;
  seated: boolean; // sold by seat: has sections on the Seating page (docs/seating.md)
  sections: number;
  accessZone: { id: string; name: string } | null;
}

export interface EventDashboard {
  event: {
    id: string;
    name: string;
    slug: string;
    status: string;
    startDate: string;
    endDate: string;
    venue: { id: string; name: string };
    category: string;
    description: string | null;
    posterUrl: string | null;
    bannerUrl: string | null;
    submittedForReviewAt: string | null;
    reviewNote: string | null;
  };
  permissions: OrganizerPermissions;
  // Phase 15
  today: { tickets: number; revenue: number };
  readiness: { staff: number; staffPhones: number; payoutMethod: 'WAVE' | 'BANK' | null; payoutDetailsVerified: boolean };
  summary: {
    capacity: number;
    ticketsSold: number;
    reservedPending: number;
    checkedIn: number;
    attendanceRate: number;
    ticketRevenue: number;
    platformFees: number;
    grossCollected: number;
    currency: string;
  };
  ordersByStatus: Record<string, number>;
  notifications: { pending: number; sent: number; failed: number };
  refunds: { refunded: number; requests: number; awaitingPayout: number };
  settings: { refundPolicy: RefundPolicy; refundDaysBefore: number | null; transfersEnabled: boolean; cancellationRefundMode: 'AUTOMATIC' | 'ORGANIZER' | null };
  ticketTypes: TicketTypeStat[];
  salesByDay: { date: string; tickets: number; revenue: number }[];
  checkIns: Record<string, number>;
  seats: Record<string, number> | null;
}

export interface Paged<T> {
  total: number;
  page: number;
  pageSize: number;
  items: T[];
}

export interface OrderRow {
  id: string;
  status: string;
  createdAt: string;
  customer: { id: string; email: string; fullName: string | null };
  items: { ticketType: string; quantity: number; unitPrice: number }[];
  total: number;
  currency: string;
  tickets: number;
  payment: { provider: string; status: string } | null;
}

export interface AttendeeRow {
  id: string;
  status: string;
  purchasedAt: string;
  owner: { id: string; email: string; fullName: string | null };
  ticketType: { id: string; name: string };
  seat: { section: string; row: string; number: string } | null;
  checkedInAt: string | null;
  checkedInGate: string | null;
}

export interface CheckInRow {
  id: string;
  result: string;
  scannedAt: string;
  gate: { name: string } | null;
  ticket: {
    ticketType: { name: string };
    owner: { fullName: string | null; email: string };
  };
}

export interface Venue {
  id: string;
  name: string;
  city: string;
  sections: { id: string; name: string; isVip: boolean; seatCount: number }[];
  accessZones: { id: string; name: string; level: number }[];
  gates: { id: string; name: string; accessZone: { name: string } | null }[];
}

export interface StaffAssignment {
  id: string;
  role: string;
  user: { id: string; email: string; fullName: string | null };
  assignedGate: { id: string; name: string } | null;
}

export interface ScannerEvent {
  id: string;
  name: string;
  status: string;
  startDate: string;
  endDate: string;
  role: string;
  assignedGate: { id: string; name: string } | null;
  venue: { id: string; name: string; gates: { id: string; name: string; accessZone: { name: string } | null }[] };
}

export interface ScanProgress {
  eventId: string;
  ticketsSold: number;
  checkedIn: number;
  myRecentScans: {
    id: string;
    result: string;
    scannedAt: string;
    gate: string | null;
    ticketType: string;
    seat: { section: string; row: string; number: string } | null;
  }[];
}

export interface ScanResult {
  result: string;
  gate: { id: string; name: string } | null;
  ticket: {
    id: string;
    status: string;
    ticketType: { id: string; name: string };
    event: { id: string; name: string };
    seat: { section: string; row: string; number: string } | null;
    accessZone: string | null;
  } | null;
}

// GET /events/:id — the event as stored; what the edit form works on.
export interface EventRecord {
  id: string;
  name: string;
  slug: string;
  status: string;
  categoryId: string;
  venueId: string;
  description: string | null;
  posterUrl: string | null;
  bannerUrl: string | null;
  startDate: string;
  endDate: string;
  ageRestriction: number | null;
  rules: string | null;
  contactEmail: string | null;
  contactPhone: string | null;
  socialLinks: Record<string, string> | null;
  refundPolicy: RefundPolicy;
  refundDaysBefore: number | null;
  transfersEnabled: boolean;
  // Owner/admin view only (docs/event-change-review.md)
  changeRequest?: EventChangeRequest | null;
  editsNeedReview?: boolean;
}

// Changes to an approved event waiting for (or after) an admin's review.
export type ReviewedField = 'name' | 'description' | 'startDate' | 'endDate' | 'venueId' | 'posterUrl' | 'bannerUrl';
export interface EventChangeRequest {
  id: string;
  status: 'PENDING' | 'APPROVED' | 'REJECTED';
  changes: Partial<Record<ReviewedField, string | null>>;
  submittedAt: string;
  updatedAt: string;
  decidedAt: string | null;
  decisionNote: string | null;
}

export type RefundPolicy = 'NONE' | 'UNTIL_DAYS_BEFORE' | 'ANYTIME';

// GET /events/:id/refunds (Phase 13)
export interface RefundRow {
  id: string;
  status: 'REQUESTED' | 'APPROVED' | 'REJECTED' | 'PROCESSED' | 'WITHDRAWN';
  kind: 'CUSTOMER_REQUEST' | 'ORGANIZER' | 'EVENT_CANCELLED';
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
  order: { id: string; total: number };
  customer: { id: string; email: string; fullName: string | null };
  tickets: { id: string; ticketType: string; seat: string | null; status: string; amount: number }[];
}

export type EventImageKind = 'banner' | 'poster';

// ---------- payouts (docs/payouts.md) ----------

export type PayoutStatus = 'REQUESTED' | 'APPROVED' | 'PAID' | 'REJECTED' | 'CANCELLED';

export interface Payout {
  id: string;
  amount: number;
  currency: string;
  status: PayoutStatus;
  method: 'WAVE' | 'BANK';
  accountName: string;
  accountNumber: string;
  bankName: string | null;
  note: string | null;
  decisionNote: string | null;
  autoApproved: boolean;
  reference: string | null;
  requestedAt: string;
  decidedAt: string | null;
  paidAt: string | null;
}

export interface PayoutAccount {
  method: 'WAVE' | 'BANK';
  accountName: string;
  accountNumber: string;
  bankName: string | null;
  updatedAt: string;
  verified: boolean;
  verifiedAt: string | null;
}

export interface EventMoney {
  id: string;
  name: string;
  startDate: string;
  endDate: string;
  status: string;
  earned: number;
  pendingRefunds: number;
  released: number;
  availableFrom: string | null;
  state: 'AVAILABLE' | 'AFTER_EVENT' | 'ADVANCE' | 'CANCELLED';
}

export interface PayoutSummary {
  balance: {
    currency: string;
    holdDays: number;
    minAmount: number;
    advancePercent: number;
    totals: { earned: number; held: number; released: number; paidOut: number; inProgress: number; available: number };
    events: EventMoney[];
  };
  account: PayoutAccount | null;
  openPayout: Payout | null;
  cannotRequestReason: string | null;
  autoApprove: { max: number | null } | null; // payouts approved without waiting (up to max)
}

// ---------- organizer profiles (docs/organizer-profiles.md) ----------

export type SocialPlatform = 'instagram' | 'facebook' | 'tiktok' | 'x' | 'youtube' | 'whatsapp';

export interface OrganizerProfile {
  id: string;
  slug: string;
  businessName: string;
  verified: boolean;
  logoUrl: string | null;
  bannerUrl: string | null;
  bio: string | null;
  location: string | null;
  website: string | null;
  contactEmail: string | null;
  contactPhone: string | null;
  socialLinks: Partial<Record<SocialPlatform, string>>;
  memberSince: string;
}

export interface MyOrganizerProfile extends OrganizerProfile {
  verificationStatus: string;
  profileUpdatedAt: string | null;
}

export interface ProfileEventCard {
  id: string;
  slug: string;
  name: string;
  startDate: string;
  endDate: string;
  posterUrl: string | null;
  bannerUrl: string | null;
  soldOut: boolean;
  venue: { name: string; city: string };
  category: { name: string; slug: string };
  priceFrom: number | null;
  // Phase 16: the storefront's price label (docs/storefront.md)
  price?: { label: string | null; kind: 'price' | 'from' | 'free' | 'soldOut' | 'ended' | 'soon' | 'none'; min: number | null; currency: string };
}

export interface PublicOrganizerProfile extends OrganizerProfile {
  preview: boolean; // not public yet: only the organizer and admins see it
  stats: { upcomingEvents: number; pastEvents: number };
  upcoming: ProfileEventCard[];
  past: ProfileEventCard[];
}
