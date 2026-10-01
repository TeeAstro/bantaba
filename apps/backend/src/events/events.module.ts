import { Module } from '@nestjs/common';
import { RefundsModule } from '../refunds/refunds.module';
import { EventsController } from './events.controller';
import { EventsService } from './events.service';
import { CategoriesController } from './categories.controller';
import { EventImagesController } from './event-images.controller';
import { EventImagesService } from './event-images.service';

@Module({
  imports: [RefundsModule],
  controllers: [EventsController, EventImagesController, CategoriesController],
  providers: [EventsService, EventImagesService],
  exports: [EventsService, EventImagesService],
})
export class EventsModule {}
