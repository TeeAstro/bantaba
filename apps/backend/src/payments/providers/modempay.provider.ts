import { Injectable, Logger, ServiceUnavailableException } from '@nestjs/common';
import { createHmac, randomUUID, timingSafeEqual } from 'crypto';
import { InitiatePaymentInput, InitiatePaymentResult, PaymentProvider, returnUrl } from './payment-provider.interface';

// Modem Pay, a Gambian payment gateway (https://docs.modempay.com): cards
// (Visa / Mastercard) and, since Phase 23, mobile money (Wave, Afrimoney,
// QMoney). See docs/payments.md, "Card payments" and "Ways to pay".
//
// The buyer pays on Modem Pay's hosted checkout page, never on ours: card
// numbers never reach this server, which keeps the platform out of most
// PCI-DSS card-security requirements. For mobile money the page asks for
// the number and the buyer approves on their phone.
//
// Like Wave, this is written against the public docs and hasn't been run
// against a live account yet (none exists). Two things to confirm with
// Modem Pay when the account is opened, both configurable:
//   - amounts: the docs' examples (amount: 450) read as whole dalasis;
//     MODEMPAY_AMOUNT_UNIT=major (default) sends D750.00 as 750,
//     =minor would send 75000.
//   - the webhook payload carries the metadata we send (our reference).

const BASE = () => process.env.MODEMPAY_API_BASE_URL ?? 'https://api.modempay.com/v1';

// What Modem Pay's checkout page offers for each method we send there.
// Cards: "card". Mobile money: the docs' wallet group ("wallet"), where
// the buyer picks Wave, Afrimoney or QMoney and approves on their phone.
// Set MODEMPAY_WALLET_METHODS (comma separated) if Modem Pay names them
// differently for your account, e.g. "wave" for Wave alone.
const methodsFor = (method: string) => {
  if (method === 'CARD') return ['card'];
  const own = process.env[`MODEMPAY_METHODS_${method}`];
  return (own ?? process.env.MODEMPAY_WALLET_METHODS ?? 'wallet').split(',').map((x) => x.trim()).filter(Boolean);
};

export type ModemPayEventKind = 'SUCCEEDED' | 'FAILED' | 'IGNORED';

export interface ModemPayWebhookEvent {
  kind: ModemPayEventKind;
  event: string;
  reference: string | null; // ours, from metadata
  amountMinor: number | null;
  currency: string | null;
  chargeId: string | null;
  raw: unknown;
}

@Injectable()
export class ModemPayProvider implements PaymentProvider {
  readonly name = 'MODEMPAY';
  private readonly logger = new Logger('ModemPay');

  private isConfigured() {
    return Boolean(process.env.MODEMPAY_SECRET_KEY && process.env.MODEMPAY_WEBHOOK_SECRET);
  }

  private toProviderAmount(minor: number) {
    return process.env.MODEMPAY_AMOUNT_UNIT === 'minor' ? minor : minor / 100;
  }

  private fromProviderAmount(v: unknown): number | null {
    const n = typeof v === 'string' ? Number(v) : typeof v === 'number' ? v : NaN;
    if (!Number.isFinite(n)) return null;
    return process.env.MODEMPAY_AMOUNT_UNIT === 'minor' ? Math.round(n) : Math.round(n * 100);
  }

  async initiate(input: InitiatePaymentInput): Promise<InitiatePaymentResult> {
    if (!this.isConfigured()) {
      throw new ServiceUnavailableException(
        'Modem Pay is not configured yet (MODEMPAY_SECRET_KEY / MODEMPAY_WEBHOOK_SECRET missing). ' +
          'Use "BANK_TRANSFER", or "MOCK" outside production, until a Modem Pay account is set up.',
      );
    }
    // Our own reference, sent as metadata and matched when the webhook
    // arrives: the create response doesn't document a stable payment id.
    const method = input.method ?? 'CARD';
    const reference = `mp_${randomUUID()}`;
    const res = await fetch(`${BASE()}/payments`, {
      signal: AbortSignal.timeout(20_000),
      method: 'POST',
      headers: { Authorization: `Bearer ${process.env.MODEMPAY_SECRET_KEY}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({
        data: {
          amount: this.toProviderAmount(input.amount),
          currency: input.currency,
          payment_methods: methodsFor(method),
          title: process.env.APP_NAME ?? 'Bantaba',
          description: `Tickets, order ${input.orderId.slice(0, 8).toUpperCase()}`,
          metadata: { reference, orderId: input.orderId, method },
          return_url: returnUrl(process.env.CARD_RETURN_URL, '/checkout/success', input.orderId),
          cancel_url: returnUrl(process.env.CARD_CANCEL_URL, '/checkout/error', input.orderId),
          from_sdk: false,
        },
      }),
    }).catch((err: Error) => {
      // Can't be reached (network, timeout): the buyer is told to try again
      // or choose another way; the hold is kept.
      this.logger.warn(`Modem Pay not reachable: ${err.message}`);
      throw new ServiceUnavailableException('The payment service can’t be reached right now. Try again in a moment, or choose another way to pay.');
    });
    if (!res.ok) {
      throw new ServiceUnavailableException(`The card payment service refused the request (HTTP ${res.status}): ${(await res.text()).slice(0, 300)}`);
    }
    const body = (await res.json()) as { status?: boolean; data?: { payment_link?: string; intent_secret?: string; expires_at?: string } };
    const link = body.data?.payment_link;
    if (!link) throw new ServiceUnavailableException('The card payment service didn’t return a checkout link');
    return {
      providerReference: reference,
      redirectUrl: link,
      // intent_secret is a credential for this payment: not kept.
      raw: { payment_link: link, expires_at: body.data?.expires_at ?? null },
    };
  }

  // No refund API is documented, so card refunds are paid back by hand
  // from the Modem Pay dashboard and recorded by an admin
  // (RefundMethod.MANUAL, docs/refunds-transfers.md).

  // HMAC-SHA512 of the exact request body with the webhook secret, hex, in x-modem-signature.
  verifyWebhookSignature(rawBody: Buffer, signatureHeader: string | undefined): boolean {
    const secret = process.env.MODEMPAY_WEBHOOK_SECRET;
    if (!signatureHeader || !secret) return false;
    const expected = createHmac('sha512', secret).update(rawBody).digest();
    const provided = Buffer.from(signatureHeader.trim(), 'hex');
    if (provided.length !== expected.length) return false;
    return timingSafeEqual(expected, provided);
  }

  parseEvent(rawBody: Buffer): ModemPayWebhookEvent {
    const body = JSON.parse(rawBody.toString('utf8')) as { event?: string; payload?: Record<string, unknown> };
    const event = String(body.event ?? '');
    const p = (body.payload ?? {}) as Record<string, any>;
    const meta = (p.metadata ?? p.payment_intent?.metadata ?? {}) as Record<string, unknown>;
    const kind: ModemPayEventKind =
      event === 'charge.succeeded'
        ? 'SUCCEEDED'
        : // A declined card (charge.failed) isn't the end: the customer can try
          // another card on the same page. Only the whole checkout being
          // cancelled or expiring releases the tickets; otherwise the
          // reservation simply times out as usual.
          ['payment_intent.cancelled', 'payment_intent.expired'].includes(event)
          ? 'FAILED'
          : 'IGNORED';
    return {
      kind,
      event,
      reference: typeof meta.reference === 'string' ? meta.reference : null,
      amountMinor: this.fromProviderAmount(p.amount),
      currency: typeof p.currency === 'string' ? p.currency.toUpperCase() : null,
      chargeId: typeof p.id === 'string' ? p.id : null,
      raw: body,
    };
  }
}
