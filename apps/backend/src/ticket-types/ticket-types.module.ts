import { Module } from '@nestjs/common';
import { TicketTypesController } from './ticket-types.controller';
import { TicketTypesService } from './ticket-types.service';
import { VenuesModule } from '../venues/venues.module';

@Module({
  imports: [VenuesModule],
  controllers: [TicketTypesController],
  providers: [TicketTypesService],
})
export class TicketTypesModule {}
