import { Module } from '@nestjs/common';
import { PaymentsController } from './payments.controller';
import { PaymentsService } from './payments.service';
import { WaveProvider } from './providers/wave.provider';
import { BankTransferProvider } from './providers/bank-transfer.provider';
import { MockProvider } from './providers/mock.provider';
import { ModemPayProvider } from './providers/modempay.provider';
import { PaymentSettingsService } from './payment-settings.service';

@Module({
  controllers: [PaymentsController],
  providers: [PaymentsService, PaymentSettingsService, WaveProvider, BankTransferProvider, MockProvider, ModemPayProvider],
  exports: [PaymentsService, PaymentSettingsService],
})
export class PaymentsModule {}
