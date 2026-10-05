import { Module } from '@nestjs/common';
import { OrdersController } from './orders.controller';
import { OrdersService } from './orders.service';
import { PaymentsModule } from '../payments/payments.module';
import { FeesModule } from '../fees/fees.module';

@Module({
  imports: [PaymentsModule, FeesModule],
  controllers: [OrdersController],
  providers: [OrdersService],
})
export class OrdersModule {}
