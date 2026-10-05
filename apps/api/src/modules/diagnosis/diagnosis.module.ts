import { Module } from '@nestjs/common';
import { AuthzModule } from '../authz/authz.module';
import { DiagnosisController, EncounterDiagnosisController } from './diagnosis.controller';
import { DiagnosisService } from './diagnosis.service';

/**
 * K08 · Diagnosis ICD-10, prosedur ICD-9-CM, problem list, alergi + NKDA (potongan 3.2a). Didaftarkan sekali di
 * `AppModule` (potongan 3.1). Pola entri berversi, staging, dan ABAC dari `infra/clinical` (global).
 * `DiagnosisService` diekspor untuk banner kunjungan dan ringkasan pasien (`summary`).
 */
@Module({
  imports: [AuthzModule],
  controllers: [DiagnosisController, EncounterDiagnosisController],
  providers: [DiagnosisService],
  exports: [DiagnosisService],
})
export class DiagnosisModule {}
