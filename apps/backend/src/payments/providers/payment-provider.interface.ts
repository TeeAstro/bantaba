export interface InitiatePaymentInput {
  orderId: string;
  amount: number; // minor units
  currency: string;
  customerEmail: string;
}

export interface InitiatePaymentResult {
  providerReference: string;
  // Present for redirect-based providers (Wave, PayPal). Absent for
  // Bank Transfer, which instead uses `instructions`.
  redirectUrl?: string;
  // Present for providers with no online redirect (Bank Transfer) — shown
  // to the customer as what to do next.
  instructions?: string;
  // If true, PaymentsService completes the order immediately instead of
  // waiting for a webhook/confirmation call. Only ever set by MockProvider.
  autoComplete?: boolean;
  raw?: unknown;
}

export interface WebhookEvent {
  providerReference: string;
  status: 'SUCCESSFUL' | 'FAILED';
  raw: unknown;
}

// Phase 13: returning money through the provider's API.
export interface RefundInput {
  providerReference: string; // the original payment's reference
  amount: number; // minor units
  currency: string;
  fullRefund: boolean; // amount equals the whole payment
}

export interface PaymentProvider {
  readonly name: string;

  initiate(input: InitiatePaymentInput): Promise<InitiatePaymentResult>;

  // Bank Transfer has no webhook (confirmation is a manual organizer/admin
  // action instead) — these are optional so it can simply not implement them.
  verifyWebhookSignature?(rawBody: Buffer, signatureHeader: string | undefined): boolean;
  parseWebhookEvent?(rawBody: Buffer): WebhookEvent;

  // Phase 13. Absent = this provider can't return money by API (bank
  // transfer); such refunds are paid back by hand (RefundMethod.MANUAL).
  // canRefund says whether a particular refund is possible by API.
  canRefund?(input: Omit<RefundInput, 'providerReference'>): boolean;
  refund?(input: RefundInput): Promise<{ reference: string }>;
}
