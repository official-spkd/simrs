import { Module } from '@nestjs/common';
import { IdempotencyService } from '../../common/idempotency';
import { CriticalResultsModule } from '../critical-results/critical-results.module';
import { DiagnosisModule } from '../diagnosis/diagnosis.module';
import { DocumentsModule } from '../documents/documents.module';
import { NotificationsModule } from '../notifications/notifications.module';
import { LabController } from './lab.controller';
import { LabService } from './lab.service';
import { LisIngestController } from './lis-ingest.controller';
import { LisIngestService } from './lis-ingest.service';
import { ResultsQueryService } from './results-query.service';

/**
 * S01 · Laboratorium (rencana fase 4): ingest analyzer HL7 (`POST /devices/lis/hl7`, 4.1a), `ResultsQueryService`
 * (F3-9, diekspor), dan laboratorium inti `/lab` (4.2: worklist, terima order, spesimen, hasil, validasi teknis/klinis,
 * koreksi, QC, cetak). Hasil analyzer diproses worker (penangan `lis-hl7`) dengan inti `@simrs/db` yang sama.
 */
@Module({
  imports: [CriticalResultsModule, DiagnosisModule, DocumentsModule, NotificationsModule],
  controllers: [LisIngestController, LabController],
  providers: [LisIngestService, ResultsQueryService, LabService, IdempotencyService],
  exports: [ResultsQueryService],
})
export class LabModule {}
