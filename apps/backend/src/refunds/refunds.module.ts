import { Module } from '@nestjs/common';
import { PaymentsModule } from '../payments/payments.module';
import { RefundsController } from './refunds.controller';
import { RefundsService } from './refunds.service';

@Module({
  imports: [PaymentsModule],
  controllers: [RefundsController],
  providers: [RefundsService],
  exports: [RefundsService],
})
export class RefundsModule {}
