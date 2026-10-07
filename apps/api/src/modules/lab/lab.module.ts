import { Module } from '@nestjs/common';
import { LisIngestController } from './lis-ingest.controller';
import { LisIngestService } from './lis-ingest.service';
import { ResultsQueryService } from './results-query.service';

/**
 * S01 · Laboratorium (rencana fase 4). Kerangka 4.1a: ingest analyzer HL7 (`POST /devices/lis/hl7`) dan
 * `ResultsQueryService` (F3-9, diekspor untuk modul lain). Worklist, order, spesimen, hasil, validasi, QC: potongan
 * 4.2 (menambah controller/service di modul ini).
 */
@Module({
  controllers: [LisIngestController],
  providers: [LisIngestService, ResultsQueryService],
  exports: [ResultsQueryService],
})
export class LabModule {}
