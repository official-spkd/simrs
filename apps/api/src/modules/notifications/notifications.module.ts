import { Module } from '@nestjs/common';
import { NotificationsController } from './notifications.controller';
import { NotificationsService } from './notifications.service';

/** P09 · Notifikasi staf: in-app + salinan email/WhatsApp lewat outbox. Dipakai modul lain lewat `notify`. */
@Module({
  controllers: [NotificationsController],
  providers: [NotificationsService],
  exports: [NotificationsService],
})
export class NotificationsModule {}
