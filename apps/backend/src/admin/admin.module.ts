import { Module } from '@nestjs/common';
import { AdminController } from './admin.controller';
import { AdminDashboardController } from './admin-dashboard.controller';
import { AdminDashboardService } from './admin-dashboard.service';
import { AdminStatsService } from './admin-stats.service';
import { PayoutsModule } from '../payouts/payouts.module';

@Module({
  imports: [PayoutsModule],
  controllers: [AdminController, AdminDashboardController],
  providers: [AdminDashboardService, AdminStatsService],
  exports: [AdminDashboardService],
})
export class AdminModule {}
