import { Module } from '@nestjs/common';
import { AdminController } from './admin.controller';
import { AdminDashboardController } from './admin-dashboard.controller';
import { AdminDashboardService } from './admin-dashboard.service';

@Module({
  controllers: [AdminController, AdminDashboardController],
  providers: [AdminDashboardService],
  exports: [AdminDashboardService],
})
export class AdminModule {}
