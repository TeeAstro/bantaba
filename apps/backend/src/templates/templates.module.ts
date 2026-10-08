import { Module } from '@nestjs/common';
import { EventsModule } from '../events/events.module';
import { TicketTypesModule } from '../ticket-types/ticket-types.module';
import { VenuesModule } from '../venues/venues.module';
import { TemplatesController } from './templates.controller';
import { TemplatesService } from './templates.service';
import { EventCopier } from './event-copy';

@Module({
  imports: [EventsModule, TicketTypesModule, VenuesModule],
  controllers: [TemplatesController],
  providers: [TemplatesService, EventCopier],
  exports: [EventCopier],
})
export class TemplatesModule {}
