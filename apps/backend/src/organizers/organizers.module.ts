import { Module } from '@nestjs/common';
import { EventsModule } from '../events/events.module';
import { OrganizersAdminController } from './organizers-admin.controller';
import { OrganizersAdminService } from './organizers-admin.service';
import { OrganizerProfileController } from './organizer-profile.controller';
import { OrganizerProfileService } from './organizer-profile.service';

@Module({
  imports: [EventsModule],
  controllers: [OrganizersAdminController, OrganizerProfileController],
  providers: [OrganizersAdminService, OrganizerProfileService],
})
export class OrganizersModule {}
