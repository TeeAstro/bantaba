import { OrganizerVenuesController } from './organizer-venues.controller';
import { Module } from '@nestjs/common';
import { VenuesController } from './venues.controller';
import { VenuesService } from './venues.service';
import { AdminVenuesController } from './admin-venues.controller';
import { AdminVenuesService } from './admin-venues.service';
import { SeatingController } from './seating.controller';
import { SeatingService } from './seating.service';

@Module({
  controllers: [VenuesController, AdminVenuesController, OrganizerVenuesController, SeatingController],
  providers: [VenuesService, AdminVenuesService, SeatingService],
  exports: [VenuesService, SeatingService],
})
export class VenuesModule {}
