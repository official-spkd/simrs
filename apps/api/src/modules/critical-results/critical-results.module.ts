import { Module } from '@nestjs/common';
import { CriticalResultsService } from './critical-results.service';

/**
 * S09 · Nilai kritis. Kerangka 4.1a: `CriticalResultsService.raise()` + gerbang `hasOpenCritical*` (diekspor untuk lab
 * dan radiologi). Endpoint daftar/lapor/metrik: potongan 4.3. Eskalasi = job worker `critical.escalation`.
 */
@Module({
  providers: [CriticalResultsService],
  exports: [CriticalResultsService],
})
export class CriticalResultsModule {}
