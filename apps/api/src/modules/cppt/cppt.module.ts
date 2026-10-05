import { Module } from '@nestjs/common';
import { AuthzModule } from '../authz/authz.module';
import { NotificationsModule } from '../notifications/notifications.module';
import { CpptController, EncounterCpptController } from './cppt.controller';
import { CpptService } from './cppt.service';

/**
 * K07 · CPPT multi-PPA, co-sign residen, verifikasi DPJP, serah terima SBAR (potongan 3.2b). Didaftarkan sekali di
 * `AppModule` (potongan 3.1). Pola entri berversi, staging, dan ABAC dari `infra/clinical` (global).
 */
@Module({
  imports: [AuthzModule, NotificationsModule],
  controllers: [CpptController, EncounterCpptController],
  providers: [CpptService],
  exports: [CpptService],
})
export class CpptModule {}
