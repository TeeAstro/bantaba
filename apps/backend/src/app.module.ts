import { TemplatesModule } from './templates/templates.module';
import { MeModule } from './me/me.module';
import { Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { HealthModule } from './health/health.module';
import { PrismaModule } from './prisma/prisma.module';
import { StorageModule } from './storage/storage.module';
import { NotificationsModule } from './notifications/notifications.module';
import { RefundsModule } from './refunds/refunds.module';
import { TransfersModule } from './transfers/transfers.module';
import { OrganizersModule } from './organizers/organizers.module';
import { PayoutsModule } from './payouts/payouts.module';
import { AuthModule } from './auth/auth.module';
import { AdminModule } from './admin/admin.module';
import { EventsModule } from './events/events.module';
import { TicketTypesModule } from './ticket-types/ticket-types.module';
import { PaymentsModule } from './payments/payments.module';
import { OrdersModule } from './orders/orders.module';
import { TicketsModule } from './tickets/tickets.module';
import { CheckInsModule } from './check-ins/check-ins.module';
import { VenuesModule } from './venues/venues.module';
import { DashboardModule } from './dashboard/dashboard.module';
import { EventStaffModule } from './event-staff/event-staff.module';
import { ScannerModule } from './scanner/scanner.module';
import { AppConfigModule } from './app-config/app-config.module';
import { StorefrontModule } from './storefront/storefront.module';

@Module({
  imports: [
    ConfigModule.forRoot({ isGlobal: true }),
    PrismaModule,
    StorageModule,
    NotificationsModule,
    RefundsModule,
    TransfersModule,
    OrganizersModule,
    PayoutsModule,
    HealthModule,
    AuthModule,
    AdminModule,
    EventsModule,
    TicketTypesModule,
    PaymentsModule,
    OrdersModule,
    TicketsModule,
    CheckInsModule,
    VenuesModule,
    TemplatesModule,
    MeModule,
    DashboardModule,
    EventStaffModule,
    ScannerModule,
    AppConfigModule,
    StorefrontModule,
  ],
})
export class AppModule {}
