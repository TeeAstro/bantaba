import { Module } from '@nestjs/common';
import { PaymentsController } from './payments.controller';
import { PaymentsService } from './payments.service';
import { WaveProvider } from './providers/wave.provider';
import { BankTransferProvider } from './providers/bank-transfer.provider';
import { MockProvider } from './providers/mock.provider';
import { CardProvider } from './providers/card.provider';

@Module({
  controllers: [PaymentsController],
  providers: [PaymentsService, WaveProvider, BankTransferProvider, MockProvider, CardProvider],
  exports: [PaymentsService],
})
export class PaymentsModule {}
