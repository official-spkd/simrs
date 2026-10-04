import { Module } from '@nestjs/common';
import { NotificationsModule } from '../notifications/notifications.module';
import { AuthzController } from './authz.controller';
import { BreakGlassService } from './break-glass.service';
import { PatientAccessService } from './patient-access.service';

/** P03 · Akses darurat + ABAC akses pasien. PatientAccessService dipakai modul yang menampilkan data pasien. */
@Module({
  imports: [NotificationsModule],
  controllers: [AuthzController],
  providers: [BreakGlassService, PatientAccessService],
  exports: [PatientAccessService],
})
export class AuthzModule {}
