import { Injectable, ServiceUnavailableException } from '@nestjs/common';
import { createHmac, timingSafeEqual } from 'crypto';
import {
  PaymentProvider,
  InitiatePaymentInput,
  InitiatePaymentResult,
  WebhookEvent,
  returnUrl,
} from './payment-provider.interface';

const WAVE_API_BASE_URL = process.env.WAVE_API_BASE_URL ?? 'https://api.wave.com/v1';

// Phase 23: brought in line with Wave's current docs (docs.wave.com):
// amounts in whole units, the Wave-Signature header (t=…,v1=…) and the
// { type, data } event shape. Still unrun against a live account.
export const toWaveAmount = (minor: number) => (minor % 100 === 0 ? String(minor / 100) : (minor / 100).toFixed(2));
const fromWaveAmount = (v: unknown): number | null => {
  const n = typeof v === 'string' ? Number(v) : typeof v === 'number' ? v : NaN;
  return Number.isFinite(n) ? Math.round(n * 100) : null;
};
const SIGNATURE_TOLERANCE_S = 5 * 60;

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
      signal: AbortSignal.timeout(20_000),
      method: 'POST',
      headers: {
        Authorization: `Bearer ${process.env.WAVE_API_KEY}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        // Wave takes whole units as a string ("650" or "650.50"); ours are butut.
        amount: toWaveAmount(input.amount),
        currency: input.currency,
        client_reference: input.orderId,
        success_url: returnUrl(process.env.WAVE_SUCCESS_URL, '/checkout/success', input.orderId),
        error_url: returnUrl(process.env.WAVE_ERROR_URL, '/checkout/error', input.orderId),
      }),
    }).catch(() => {
      throw new ServiceUnavailableException('Wave can’t be reached right now. Try again in a moment, or choose another way to pay.');
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

  // Wave-Signature: t=<unix seconds>,v1=<hex HMAC-SHA256 of t + raw body>.
  // More than one v1 can be sent while Wave rolls a secret over. Old
  // timestamps are refused so a captured request can't be replayed.
  verifyWebhookSignature(rawBody: Buffer, signatureHeader: string | undefined): boolean {
    const secret = process.env.WAVE_WEBHOOK_SECRET;
    if (!signatureHeader || !secret) return false;
    const parts = signatureHeader.split(',').map((p) => p.trim().split('='));
    const t = parts.find(([k]) => k === 't')?.[1];
    const sigs = parts.filter(([k]) => k === 'v1').map(([, v]) => v);
    if (!t || !/^\d+$/.test(t) || sigs.length === 0) return false;
    if (Math.abs(Date.now() / 1000 - Number(t)) > SIGNATURE_TOLERANCE_S) return false;
    const expected = createHmac('sha256', secret).update(t).update(rawBody).digest();
    return sigs.some((v) => {
      const provided = Buffer.from(v ?? '', 'hex');
      return provided.length === expected.length && timingSafeEqual(expected, provided);
    });
  }

  parseWebhookEvent(rawBody: Buffer): WebhookEvent {
    const body = JSON.parse(rawBody.toString('utf8')) as {
      type?: string;
      data?: { id?: string; checkout_status?: string; payment_status?: string; amount?: string; currency?: string };
    };
    const d = body.data ?? {};
    const done = body.type === 'checkout.session.completed' && (d.payment_status ?? 'succeeded') === 'succeeded';
    const failed = body.type === 'checkout.session.payment_failed';
    return {
      providerReference: String(d.id ?? ''),
      status: done ? 'SUCCESSFUL' : failed ? 'FAILED' : 'IGNORED',
      amountMinor: fromWaveAmount(d.amount),
      currency: typeof d.currency === 'string' ? d.currency.toUpperCase() : null,
      raw: body,
    };
  }
}
