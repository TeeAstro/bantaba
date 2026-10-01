import { Module } from '@nestjs/common';
import { EventsModule } from '../events/events.module';
import { OrganizersAdminController } from './organizers-admin.controller';
import { OrganizersAdminService } from './organizers-admin.service';

@Module({
  imports: [EventsModule],
  controllers: [OrganizersAdminController],
  providers: [OrganizersAdminService],
})
export class OrganizersModule {}
