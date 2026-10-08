import {
  Body,
  Controller,
  Get,
  Header,
  Headers,
  HttpCode,
  Param,
  ParseUUIDPipe,
  Post,
  Query,
} from '@nestjs/common';
import { ApiTags } from '@nestjs/swagger';
import {
  type LabInboundIssue,
  type LabOrderAcceptInput,
  labOrderAcceptInputSchema,
  type LabOrderDetail,
  type LabQcRun,
  type LabQcRunInput,
  labQcRunInputSchema,
  type LabResultCorrectionInput,
  labResultCorrectionInputSchema,
  type LabResultInput,
  labResultInputSchema,
  type LabTestDefinition,
  type LabValidationInput,
  labValidationInputSchema,
  type LabWorklistItem,
  type LabWorklistQuery,
  labWorklistQuerySchema,
  type SpecimenRejectInput,
  specimenCollectInputSchema,
  specimenRejectInputSchema,
} from '@simrs/shared';
import { z } from 'zod';
import { RequireModule } from '../../common/require-module.decorator';
import { RequirePermission } from '../../common/require-permission.decorator';
import { TenantScoped } from '../../common/tenant-scoped.decorator';
import { ZodValidationPipe } from '../../common/zod-validation.pipe';
import { LabService } from './lab.service';

const uuid = new ParseUUIDPipe();
const qcQuerySchema = z.object({ testDefinitionId: z.uuid().optional() });

/**
 * S01 · Laboratorium (`/api/v1/lab`, rencana fase 4 §4.2). Izin `lab.*`; lingkup `unit` = order ke unit lab penugasan.
 * Audit: worklist = `search` per pasien saat dimuat, detail = `read`, input/validasi/koreksi = `create`/`verify`/
 * `sign`/`correct`, cetak = `print` (ditulis service, tanpa PHI di `details`).
 */
@ApiTags('penunjang · laboratorium (S01)')
@TenantScoped()
@RequireModule('S01')
@Controller('lab')
export class LabController {
  constructor(private readonly lab: LabService) {}

  @RequirePermission('lab.worklist', 'read')
  @Get('worklist')
  worklist(
    @Query(new ZodValidationPipe(labWorklistQuerySchema)) q: LabWorklistQuery,
  ): Promise<LabWorklistItem[]> {
    return this.lab.worklist(q);
  }

  @RequirePermission('lab.worklist', 'read')
  @Get('tests')
  tests(): Promise<LabTestDefinition[]> {
    return this.lab.tests();
  }

  @RequirePermission('lab.worklist', 'read')
  @Get('inbound-issues')
  inboundIssues(): Promise<LabInboundIssue[]> {
    return this.lab.inboundIssues();
  }

  /** Unit lab menerima order CPOE → nomor lab + spesimen berbarcode. Header `Idempotency-Key` (UUID) wajib. */
  @RequirePermission('lab.specimen', 'receive')
  @Post('orders')
  accept(
    @Body(new ZodValidationPipe(labOrderAcceptInputSchema)) body: LabOrderAcceptInput,
    @Headers('idempotency-key') key: string | undefined,
  ): Promise<LabOrderDetail> {
    return this.lab.accept(body, key);
  }

  @RequirePermission('lab.worklist', 'read')
  @Get('orders/:id')
  detail(@Param('id', uuid) id: string): Promise<LabOrderDetail> {
    return this.lab.detail(id);
  }

  @RequirePermission('lab.worklist', 'read')
  @Get('orders/:id/print')
  @Header('Content-Type', 'text/html; charset=utf-8')
  @Header('Cache-Control', 'no-store')
  print(@Param('id', uuid) id: string): Promise<string> {
    return this.lab.print(id);
  }

  @RequirePermission('lab.specimen', 'collect')
  @Post('specimens/:id/collect')
  @HttpCode(200)
  collect(
    @Param('id', uuid) id: string,
    @Body(new ZodValidationPipe(specimenCollectInputSchema)) body: { occurredAt: string },
  ): Promise<LabOrderDetail> {
    return this.lab.specimen(id, 'collect', { occurredAt: body.occurredAt });
  }

  @RequirePermission('lab.specimen', 'receive')
  @Post('specimens/:id/receive')
  @HttpCode(200)
  receive(@Param('id', uuid) id: string): Promise<LabOrderDetail> {
    return this.lab.specimen(id, 'receive', {});
  }

  @RequirePermission('lab.specimen', 'reject')
  @Post('specimens/:id/reject')
  @HttpCode(200)
  reject(
    @Param('id', uuid) id: string,
    @Body(new ZodValidationPipe(specimenRejectInputSchema)) body: SpecimenRejectInput,
  ): Promise<LabOrderDetail> {
    return this.lab.specimen(id, 'reject', { reject: body });
  }

  /** Input hasil manual; flag, rentang, delta, dan nilai kritis dihitung server. */
  @RequirePermission('lab.result', 'write')
  @Post('orders/:id/results')
  @HttpCode(200)
  results(
    @Param('id', uuid) id: string,
    @Body(new ZodValidationPipe(labResultInputSchema)) body: LabResultInput,
  ): Promise<LabOrderDetail> {
    return this.lab.enterResults(id, body);
  }

  /** Validasi teknis (`lab.result:verify`) — klinis/rilis berizin `lab.result:release` di endpoint terpisah. */
  @RequirePermission('lab.result', 'verify')
  @Post('orders/:id/validations/technical')
  @HttpCode(200)
  technical(
    @Param('id', uuid) id: string,
    @Body(new ZodValidationPipe(labValidationInputSchema.omit({ level: true })))
    body: Omit<LabValidationInput, 'level'>,
  ): Promise<LabOrderDetail> {
    return this.lab.validate(id, { ...body, level: 'teknis' });
  }

  /** Validasi klinis = rilis + TTE (dokter berpenugasan di unit lab, keputusan fase 4 no. 6). */
  @RequirePermission('lab.result', 'release')
  @Post('orders/:id/validations/clinical')
  @HttpCode(200)
  clinical(@Param('id', uuid) id: string): Promise<LabOrderDetail> {
    return this.lab.validate(id, { level: 'klinis', qcOverrideReason: null });
  }

  @RequirePermission('lab.result', 'correct')
  @Post('results/:id/corrections')
  @HttpCode(200)
  correct(
    @Param('id', uuid) id: string,
    @Body(new ZodValidationPipe(labResultCorrectionInputSchema)) body: LabResultCorrectionInput,
  ): Promise<LabOrderDetail> {
    return this.lab.correct(id, body);
  }

  @RequirePermission('lab.qc', 'read')
  @Get('qc')
  qc(@Query(new ZodValidationPipe(qcQuerySchema)) q: { testDefinitionId?: string }): Promise<LabQcRun[]> {
    return this.lab.qcList(q.testDefinitionId);
  }

  @RequirePermission('lab.qc', 'write')
  @Post('qc')
  qcRun(@Body(new ZodValidationPipe(labQcRunInputSchema)) body: LabQcRunInput): Promise<LabQcRun> {
    return this.lab.qcRun(body);
  }
}
