import { Module } from '@nestjs/common';
import { PaymentsController } from './payments.controller';
import { PaymentsService } from './payments.service';
import { WaveProvider } from './providers/wave.provider';
import { BankTransferProvider } from './providers/bank-transfer.provider';
import { MockProvider } from './providers/mock.provider';

@Module({
  controllers: [PaymentsController],
  providers: [PaymentsService, WaveProvider, BankTransferProvider, MockProvider],
  exports: [PaymentsService],
})
export class PaymentsModule {}
