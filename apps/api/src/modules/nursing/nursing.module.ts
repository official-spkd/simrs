import { Module } from '@nestjs/common';
import { AuthzModule } from '../authz/authz.module';
import { NotificationsModule } from '../notifications/notifications.module';
import { VitalsController } from './vitals.controller';
import { VitalsService } from './vitals.service';

/**
 * K12 · eMAR (pindai gelang, pemberian, cek ganda high-alert), asuhan keperawatan, balans cairan.
 * Kerangka didaftarkan sekali di `AppModule` (potongan 3.1). Potongan 3.2a mengisi observasi tanda vital + NEWS2 +
 * eskalasi (`VitalsService`, diekspor untuk banner/ringkasan); eMAR dan askep menyusul potongan 3.5. Pola entri
 * berversi, staging, dan ABAC dari `infra/clinical` (global).
 */
@Module({
  imports: [AuthzModule, NotificationsModule],
  controllers: [VitalsController],
  providers: [VitalsService],
  exports: [VitalsService],
})
export class NursingModule {}
