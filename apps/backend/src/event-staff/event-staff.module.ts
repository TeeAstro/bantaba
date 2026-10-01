import { Module } from '@nestjs/common';
import { EventStaffController } from './event-staff.controller';
import { EventStaffService } from './event-staff.service';

@Module({
  controllers: [EventStaffController],
  providers: [EventStaffService],
})
export class EventStaffModule {}
