import { Injectable, ForbiddenException } from '@nestjs/common';
import { randomUUID } from 'crypto';
import {
  PaymentProvider,
  InitiatePaymentInput,
  InitiatePaymentResult,
} from './payment-provider.interface';

// Exists purely so the full checkout → paid → tickets-generated flow can
// be tested end to end before a real Wave Business account exists. Hard
// refuses to run when NODE_ENV=production — this must never be a way to
// get free tickets in a real deployment. See docs/payments.md.
@Injectable()
export class MockProvider implements PaymentProvider {
  readonly name = 'MOCK';

  async initiate(_input: InitiatePaymentInput): Promise<InitiatePaymentResult> {
    if (process.env.NODE_ENV === 'production') {
      throw new ForbiddenException('The MOCK payment provider is disabled in production');
    }

    return {
      providerReference: `mock_${randomUUID()}`,
      autoComplete: true,
    };
  }
}
