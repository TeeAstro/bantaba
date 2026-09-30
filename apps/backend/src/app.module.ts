import { Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { HealthModule } from './health/health.module';
import { PrismaModule } from './prisma/prisma.module';
import { AuthModule } from './auth/auth.module';
import { AdminModule } from './admin/admin.module';
import { EventsModule } from './events/events.module';
import { TicketTypesModule } from './ticket-types/ticket-types.module';
import { PaymentsModule } from './payments/payments.module';
import { OrdersModule } from './orders/orders.module';
import { TicketsModule } from './tickets/tickets.module';

@Module({
  imports: [
    ConfigModule.forRoot({ isGlobal: true }),
    PrismaModule,
    HealthModule,
    AuthModule,
    AdminModule,
    EventsModule,
    TicketTypesModule,
    PaymentsModule,
    OrdersModule,
    TicketsModule,
  ],
})
export class AppModule {}
