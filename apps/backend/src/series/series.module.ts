import { Module } from '@nestjs/common';
import { EventsModule } from '../events/events.module';
import { TemplatesModule } from '../templates/templates.module';
import { SeriesController } from './series.controller';
import { SeriesService } from './series.service';

@Module({
  imports: [EventsModule, TemplatesModule],
  controllers: [SeriesController],
  providers: [SeriesService],
  exports: [SeriesService],
})
export class SeriesModule {}
