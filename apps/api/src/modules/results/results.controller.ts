import { Body, Controller, Get, Param, ParseUUIDPipe, Post, Query } from '@nestjs/common';
import { ApiTags } from '@nestjs/swagger';
import {
  type ClinicalEnteredInErrorInput,
  clinicalEnteredInErrorInputSchema,
  patientResultsQuerySchema,
  type ResultObservationInput,
  resultObservationInputSchema,
  type ResultReportInput,
  resultReportInputSchema,
} from '@simrs/shared';
import type { z } from 'zod';
import { RequireModule } from '../../common/require-module.decorator';
import { RequirePermission } from '../../common/require-permission.decorator';
import { TenantScoped } from '../../common/tenant-scoped.decorator';
import { ZodValidationPipe } from '../../common/zod-validation.pipe';
import { ResultsService } from './results.service';

const uuid = new ParseUUIDPipe();
const reason = new ZodValidationPipe(clinicalEnteredInErrorInputSchema);

/**
 * K08 · `/api/v1/results/*`: hasil penunjang (observasi + laporan diagnostik). Tulis = `result.write` (koreksi oleh
 * penulis asli, izin yang sama), baca = `result.read`; ABAC per pasien, audit per pasien di service.
 */
@ApiTags('klinis · hasil penunjang (K08)')
@TenantScoped()
@RequireModule('K08')
@Controller('results')
export class ResultsController {
  constructor(private readonly results: ResultsService) {}

  @RequirePermission('result', 'write')
  @Post('observations')
  createObservation(@Body(new ZodValidationPipe(resultObservationInputSchema)) body: ResultObservationInput) {
    return this.results.createObservation(body);
  }

  @RequirePermission('result', 'write')
  @Post('observations/:id/entered-in-error')
  observationError(@Param('id', uuid) id: string, @Body(reason) body: ClinicalEnteredInErrorInput) {
    return this.results.enteredInError('observations', id, body.reason);
  }

  @RequirePermission('result', 'write')
  @Post('reports')
  createReport(@Body(new ZodValidationPipe(resultReportInputSchema)) body: ResultReportInput) {
    return this.results.createReport(body);
  }

  @RequirePermission('result', 'write')
  @Post('reports/:id/entered-in-error')
  reportError(@Param('id', uuid) id: string, @Body(reason) body: ClinicalEnteredInErrorInput) {
    return this.results.enteredInError('diagnostic_reports', id, body.reason);
  }

  @RequirePermission('result', 'read')
  @Get()
  list(
    @Query(new ZodValidationPipe(patientResultsQuerySchema)) q: z.infer<typeof patientResultsQuerySchema>,
  ) {
    return this.results.list(q);
  }
}
