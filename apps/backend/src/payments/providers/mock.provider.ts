import { Injectable, ForbiddenException } from '@nestjs/common';
import { randomUUID } from 'crypto';
import {
  PaymentProvider,
  InitiatePaymentInput,
  InitiatePaymentResult,
} from './payment-provider.interface';

// Exists purely so the full checkout → paid → tickets-generated flow can
// be tested end to end before a real Wave Business account exists. This
// must never be a way to get free tickets in a real deployment: it only
// works when ALLOW_MOCK_PAYMENTS=true is set and NODE_ENV isn't production
// (security review, Phase 21b; before, a server started without
// NODE_ENV=production would have accepted it). See docs/payments.md.
export const mockPaymentsAllowed = () => process.env.ALLOW_MOCK_PAYMENTS === 'true' && process.env.NODE_ENV !== 'production';
@Injectable()
export class MockProvider implements PaymentProvider {
  readonly name = 'MOCK';

  async initiate(_input: InitiatePaymentInput): Promise<InitiatePaymentResult> {
    if (!mockPaymentsAllowed()) {
      throw new ForbiddenException('Test payments are switched off on this server');
    }

    return {
      providerReference: `mock_${randomUUID()}`,
      autoComplete: true,
    };
  }

  canRefund() {
    return true;
  }

  async refund(input: { providerReference: string }) {
    if (!mockPaymentsAllowed()) {
      throw new ForbiddenException('Test payments are switched off on this server');
    }
    return { reference: `mock_refund_${randomUUID()}` };
  }
}
