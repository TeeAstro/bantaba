import { Module } from '@nestjs/common';
import { RefundsModule } from '../refunds/refunds.module';
import { EventsController } from './events.controller';
import { EventsService } from './events.service';
import { CategoriesController } from './categories.controller';
import { EventImagesController } from './event-images.controller';
import { EventImagesService } from './event-images.service';
import { EventChangesService } from './event-changes.service';
import { EventChangesController } from './event-changes.controller';

@Module({
  imports: [RefundsModule],
  controllers: [EventsController, EventImagesController, CategoriesController, EventChangesController],
  providers: [EventsService, EventImagesService, EventChangesService],
  exports: [EventsService, EventImagesService, EventChangesService],
})
export class EventsModule {}
