import { Global, Module } from '@nestjs/common';
import { CareTeamService } from './care-team.service';
import { ClinicalRecordService } from './clinical-record.service';
import { DocumentsModule } from '../../modules/documents/documents.module';
import { ClinicalSigningService } from './clinical-signing.service';
import { ClinicalStreamsController } from './clinical-streams.controller';
import { BillableRecorder, SatusehatRecorder } from './staging';

/**
 * Fase 3 · infrastruktur API klinis (potongan 3.1), global agar setiap modul klinis memakai satu implementasi:
 * - `ClinicalRecordService`: pola entri berversi (ADR-0028), pemetaan galat trigger, kunci advisory jalur TTE;
 * - `ClinicalSigningService`: TTE dokumen klinis lewat `ClinicalPdfService` (ADR-0029) di bawah kunci versi;
 * - `SatusehatRecorder` + `BillableRecorder`: staging lintas fase di transaksi yang sama (ADR-0032);
 * - `CareTeamService`: tim perawatan → relasi akses ABAC (ADR-0031);
 * - aliran SSE papan IGD, papan bed, eskalasi EWS (ADR-0026).
 */
@Global()
@Module({
  imports: [DocumentsModule],
  controllers: [ClinicalStreamsController],
  providers: [
    ClinicalRecordService,
    SatusehatRecorder,
    BillableRecorder,
    CareTeamService,
    ClinicalSigningService,
  ],
  exports: [
    ClinicalRecordService,
    SatusehatRecorder,
    BillableRecorder,
    CareTeamService,
    ClinicalSigningService,
  ],
})
export class ClinicalInfraModule {}
