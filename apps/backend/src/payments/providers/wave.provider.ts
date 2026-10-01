import { Injectable, ServiceUnavailableException } from '@nestjs/common';
import { createHmac, timingSafeEqual } from 'crypto';
import {
  PaymentProvider,
  InitiatePaymentInput,
  InitiatePaymentResult,
  WebhookEvent,
} from './payment-provider.interface';

const WAVE_API_BASE_URL = process.env.WAVE_API_BASE_URL ?? 'https://api.wave.com/v1';

// Wave's published examples quote checkout sessions in XOF (their larger
// markets are francophone West Africa). Whether a Gambian Wave Business
// account can create a session directly in GMD is flagged as unconfirmed
// in docs/architecture.md and docs/payments.md — never verified against a
// live account, since none exists yet. If Wave rejects "GMD" as a currency
// code, that confirmation happens here, in this error path, rather than
// being silently wrong.
@Injectable()
export class WaveProvider implements PaymentProvider {
  readonly name = 'WAVE';

  private isConfigured(): boolean {
    return Boolean(process.env.WAVE_API_KEY && process.env.WAVE_WEBHOOK_SECRET);
  }

  async initiate(input: InitiatePaymentInput): Promise<InitiatePaymentResult> {
    if (!this.isConfigured()) {
      // Fails loudly and clearly rather than pretending to work — there is
      // no Wave Business account yet as of Phase 6, so this path is
      // written against Wave's public API docs but has never been
      // exercised against a real account. See docs/payments.md.
      throw new ServiceUnavailableException(
        'Wave payments are not configured yet (WAVE_API_KEY / WAVE_WEBHOOK_SECRET missing). ' +
          'Use provider "BANK_TRANSFER", or "MOCK" outside production, until a Wave Business account is set up.',
      );
    }

    const response = await fetch(`${WAVE_API_BASE_URL}/checkout/sessions`, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${process.env.WAVE_API_KEY}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        amount: String(input.amount),
        currency: input.currency,
        client_reference: input.orderId,
        success_url: process.env.WAVE_SUCCESS_URL ?? 'http://localhost:3000/checkout/success',
        error_url: process.env.WAVE_ERROR_URL ?? 'http://localhost:3000/checkout/error',
      }),
    });

    if (!response.ok) {
      const body = await response.text();
      throw new ServiceUnavailableException(
        `Wave rejected the checkout session request (HTTP ${response.status}): ${body}`,
      );
    }

    const session = (await response.json()) as {
      id: string;
      wave_launch_url: string;
    };

    return {
      providerReference: session.id,
      redirectUrl: session.wave_launch_url,
      raw: session,
    };
  }

  // Wave's Checkout API refunds a whole checkout session only
  // (POST /v1/checkout/sessions/:id/refund, no amount), and repeating the
  // call doesn't refund twice. Partial refunds are therefore paid back by
  // hand (docs/refunds-transfers.md). Like initiate(), written against
  // Wave's public docs and not yet exercised against a live account.
  canRefund(input: { fullRefund: boolean }) {
    return input.fullRefund;
  }

  async refund(input: { providerReference: string; fullRefund: boolean }) {
    if (!this.isConfigured()) {
      throw new ServiceUnavailableException('Wave is not configured (WAVE_API_KEY missing)');
    }
    if (!input.fullRefund) throw new Error('Wave can only refund a payment in full');
    const response = await fetch(`${WAVE_API_BASE_URL}/checkout/sessions/${encodeURIComponent(input.providerReference)}/refund`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${process.env.WAVE_API_KEY}` },
    });
    if (!response.ok) {
      throw new Error(`Wave refused the refund (HTTP ${response.status}): ${(await response.text()).slice(0, 300)}`);
    }
    return { reference: `wave_refund_${input.providerReference}` };
  }

  verifyWebhookSignature(rawBody: Buffer, signatureHeader: string | undefined): boolean {
    if (!signatureHeader || !process.env.WAVE_WEBHOOK_SECRET) return false;

    const expected = createHmac('sha256', process.env.WAVE_WEBHOOK_SECRET)
      .update(rawBody)
      .digest('hex');

    // Constant-time comparison — a plain `===` here would leak timing
    // information an attacker could use to guess the correct signature
    // byte by byte. Buffer.from(..., 'hex') on a malformed header can
    // produce a shorter buffer than expected, so the length check must
    // come before timingSafeEqual (it throws on mismatched lengths).
    const expectedBuf = Buffer.from(expected, 'hex');
    const providedBuf = Buffer.from(signatureHeader, 'hex');
    if (expectedBuf.length !== providedBuf.length) return false;
    return timingSafeEqual(expectedBuf, providedBuf);
  }

  parseWebhookEvent(rawBody: Buffer): WebhookEvent {
    const payload = JSON.parse(rawBody.toString('utf8')) as {
      id: string;
      checkout_status: string;
      client_reference: string;
    };

    return {
      providerReference: payload.id,
      status: payload.checkout_status === 'complete' ? 'SUCCESSFUL' : 'FAILED',
      raw: payload,
    };
  }
}
