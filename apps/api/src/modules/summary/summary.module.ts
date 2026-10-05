import { Module } from '@nestjs/common';
import { AuthzModule } from '../authz/authz.module';
import { DiagnosisModule } from '../diagnosis/diagnosis.module';
import { NursingModule } from '../nursing/nursing.module';
import { ResultsModule } from '../results/results.module';
import { EncounterContextController, SummaryController } from './summary.controller';
import { SummaryService } from './summary.service';

/**
 * K14 · Ringkasan pasien + banner kunjungan (potongan 3.2a). Hanya membaca dari modul diagnosis, hasil, dan observasi
 * (service yang mereka ekspor). Didaftarkan sekali di `AppModule` (potongan 3.1).
 */
@Module({
  imports: [AuthzModule, DiagnosisModule, ResultsModule, NursingModule],
  controllers: [SummaryController, EncounterContextController],
  providers: [SummaryService],
  exports: [SummaryService],
})
export class SummaryModule {}
