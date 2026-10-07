import { Module } from '@nestjs/common';
import { AuthzModule } from '../authz/authz.module';
import { NotificationsModule } from '../notifications/notifications.module';
import { ConsultController, EncounterConsultController } from './consult.controller';
import { ConsultService } from './consult.service';

/**
 * K10 · Konsultasi/rawat bersama/alih rawat dan serah DPJP utama (potongan 3.8, ADR-0059). Didaftarkan sekali di
 * `AppModule` (potongan 3.1). Pola entri berversi, staging, tim perawatan, dan ABAC dari `infra/clinical` (global).
 */
@Module({
  imports: [AuthzModule, NotificationsModule],
  controllers: [ConsultController, EncounterConsultController],
  providers: [ConsultService],
})
export class ConsultModule {}
