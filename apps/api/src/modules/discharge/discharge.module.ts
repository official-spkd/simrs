import { Module } from '@nestjs/common';
import { AdtModule } from '../adt/adt.module';
import { AuthzModule } from '../authz/authz.module';
import { QueueModule } from '../queue/queue.module';
import { DeathCertificateService } from './death-certificate.service';
import { DischargeController, DischargeEncounterController } from './discharge.controller';
import { DischargeService } from './discharge.service';
import { DischargeSourcesService } from './discharge-sources';
import { EncounterCloseService } from './encounter-close.service';

/**
 * K13 · Resume medis + rekonsiliasi obat + TTE, surat keterangan kematian (K-1), gerbang tutup kunjungan (potongan
 * 3.6, EP 5c). Kerangka didaftarkan sekali di `AppModule` (potongan 3.1). `FullDischargeGate` + `DischargeAuthority`
 * disediakan `AdtModule` (provider `DISCHARGE_GATE`) dan dipakai ulang di sini untuk tutup kunjungan rawat jalan. Pola
 * entri berversi, TTE, staging, dan ABAC dari `infra/clinical` (global).
 */
@Module({
  imports: [AuthzModule, AdtModule, QueueModule],
  controllers: [DischargeController, DischargeEncounterController],
  providers: [DischargeService, DischargeSourcesService, DeathCertificateService, EncounterCloseService],
})
export class DischargeModule {}
