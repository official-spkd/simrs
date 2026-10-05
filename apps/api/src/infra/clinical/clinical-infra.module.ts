import { Global, Module } from '@nestjs/common';
import { CareTeamService } from './care-team.service';
import { ClinicalRecordService } from './clinical-record.service';
import { CLINICAL_SIGNING_PORT, UnavailableClinicalSigning } from './clinical-signing.port';
import { ClinicalStreamsController } from './clinical-streams.controller';
import { BillableRecorder, SatusehatRecorder } from './staging';

/**
 * Fase 3 · infrastruktur API klinis (potongan 3.1), global agar setiap modul klinis memakai satu implementasi:
 * - `ClinicalRecordService`: pola entri berversi (ADR-0028), pemetaan galat trigger, kunci advisory jalur TTE;
 * - `CLINICAL_SIGNING_PORT`: titik sambung TTE dokumen klinis (diisi implementasi ADR-0029);
 * - `SatusehatRecorder` + `BillableRecorder`: staging lintas fase di transaksi yang sama (ADR-0032);
 * - `CareTeamService`: tim perawatan → relasi akses ABAC (ADR-0031);
 * - aliran SSE papan IGD, papan bed, eskalasi EWS (ADR-0026).
 */
@Global()
@Module({
  controllers: [ClinicalStreamsController],
  providers: [
    ClinicalRecordService,
    SatusehatRecorder,
    BillableRecorder,
    CareTeamService,
    { provide: CLINICAL_SIGNING_PORT, useClass: UnavailableClinicalSigning },
  ],
  exports: [
    ClinicalRecordService,
    SatusehatRecorder,
    BillableRecorder,
    CareTeamService,
    CLINICAL_SIGNING_PORT,
  ],
})
export class ClinicalInfraModule {}
