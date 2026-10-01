import { Global, Module } from '@nestjs/common';
import { MailTransport } from './mail.transport';
import { NotificationsService } from './notifications.service';
import { NotificationsWorker } from './notifications.worker';
import { NotificationsController } from './notifications.controller';

// Global so payments, events, staff and auth can queue messages without
// each importing this module.
@Global()
@Module({
  providers: [MailTransport, NotificationsService, NotificationsWorker],
  controllers: [NotificationsController],
  exports: [NotificationsService],
})
export class NotificationsModule {}
