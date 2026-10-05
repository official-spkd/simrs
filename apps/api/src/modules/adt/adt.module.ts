import { Module } from '@nestjs/common';
import { AuthzModule } from '../authz/authz.module';
import { SepModule } from '../sep/sep.module';
import { AdtController, AdtEncounterController } from './adt.controller';
import { AdtService } from './adt.service';
import { AplicareSyncService } from './aplicare-sync.service';
import { BedBoardService } from './bed-board.service';
import { BedOpsService } from './bed-ops.service';
import { BasicDischargeGate, DISCHARGE_GATE } from './discharge-gate';

/**
 * K04/K05 · ADT, papan bed, gelang, Aplicare (potongan 3.3); gelang di `/api/v1/encounters/:id/wristband`:
 * - `/api/v1/adt/beds` (+ SSE `/beds/events`), status bed manual berversi, permintaan + alokasi bed;
 * - admisi nyata (bed + gelang + DPJP di tim + SEP rawat inap BPJS lewat `SepService.createPending` + outbox), transfer
 *   (akses lingkup unit ikut pindah, ADR-0031), pulang lewat `DISCHARGE_GATE` (aturan lengkap potongan 3.6);
 * - staging SATUSEHAT `held` Encounter + `billable_events` admisi/transfer/pulang (ADR-0032);
 * - Aplicare: revisi ruang + outbox `bpjs.aplicare.update` setiap perubahan bed rawat inap (worker `outbox/aplicare.ts`).
 * `BedOpsService` diekspor untuk penempatan bed IGD (modul triage).
 */
@Module({
  imports: [AuthzModule, SepModule],
  controllers: [AdtController, AdtEncounterController],
  providers: [
    AdtService,
    BedOpsService,
    AplicareSyncService,
    BedBoardService,
    { provide: DISCHARGE_GATE, useClass: BasicDischargeGate },
  ],
  exports: [BedOpsService, AdtService],
})
export class AdtModule {}
