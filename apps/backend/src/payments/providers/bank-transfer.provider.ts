import { Injectable } from '@nestjs/common';
import { randomUUID } from 'crypto';
import {
  PaymentProvider,
  InitiatePaymentInput,
  InitiatePaymentResult,
} from './payment-provider.interface';

// No external API call, and deliberately no `verifyWebhookSignature` /
// `parseWebhookEvent` — there is no bank webhook in this MVP. Per Phase 0
// Section 9, confirmation is instead a manual action: the customer
// transfers money using the reference below, and an organizer/admin
// confirms receipt via POST /payments/:id/confirm-bank-transfer, which
// PaymentsService treats as this provider's equivalent of a webhook.
@Injectable()
export class BankTransferProvider implements PaymentProvider {
  readonly name = 'BANK_TRANSFER';

  async initiate(input: InitiatePaymentInput): Promise<InitiatePaymentResult> {
    const bankName = process.env.BANK_NAME ?? '[BANK_NAME not configured]';
    const accountName = process.env.BANK_ACCOUNT_NAME ?? '[BANK_ACCOUNT_NAME not configured]';
    const accountNumber = process.env.BANK_ACCOUNT_NUMBER ?? '[BANK_ACCOUNT_NUMBER not configured]';

    // Generated independently rather than reusing the Payment row's own
    // ID — at the point PaymentsService calls this, that row doesn't
    // exist yet (it's created immediately after, using whatever
    // `providerReference` this method returns).
    const reference = `bank_${randomUUID()}`;

    return {
      providerReference: reference,
      instructions:
        `Transfer ${(input.amount / 100).toFixed(2)} ${input.currency} to ${bankName}, ` +
        `account name "${accountName}", account number ${accountNumber}. ` +
        `Include reference "${reference}" so it can be matched to your order.`,
    };
  }
}
