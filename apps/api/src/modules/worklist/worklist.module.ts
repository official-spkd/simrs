import { Module } from '@nestjs/common';
import { AuthzModule } from '../authz/authz.module';
import { DiagnosisModule } from '../diagnosis/diagnosis.module';
import { InpatientCensusController } from './inpatient-census.controller';
import { InpatientCensusService } from './inpatient-census.service';
import { WorklistController } from './worklist.controller';
import { WorklistService } from './worklist.service';

/**
 * K01 · Worklist klinis (potongan 3.2b): pasien per tampilan (DPJP, unit, shift) dan tugas pribadi (co-sign, verifikasi,
 * tinjau order residen, TTE gagal, EWS tinggi, resume lewat batas, serah terima). Didaftarkan sekali di `AppModule`.
 * K04 · Daftar pasien rawat inap per unit/bed (layar W4) ikut di sini: daftar pasien klinis berbasis ABAC yang sama.
 */
@Module({
  imports: [AuthzModule, DiagnosisModule],
  controllers: [WorklistController, InpatientCensusController],
  providers: [WorklistService, InpatientCensusService],
})
export class WorklistModule {}
