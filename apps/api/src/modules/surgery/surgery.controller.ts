import { Body, Controller, Get, HttpCode, Param, ParseUUIDPipe, Post, Query } from '@nestjs/common';
import { ApiTags } from '@nestjs/swagger';
import {
  checklistConfirmInputSchema,
  checklistItemInputSchema,
  countDiscrepancyInputSchema,
  isoDateJakarta,
  operativeReportCreateSchema,
  type OperativeReportCreateInput,
  surgeryCancelInputSchema,
  type SurgeryCaseInput,
  surgeryCaseInputSchema,
  type SurgeryEventInput,
  surgeryEventInputSchema,
  surgerySupplyInputSchema,
  type SurgicalCountInput,
  surgicalCountInputSchema,
} from '@simrs/shared';
import { z } from 'zod';
import { RequireModule } from '../../common/require-module.decorator';
import { RequirePermission } from '../../common/require-permission.decorator';
import { TenantScoped } from '../../common/tenant-scoped.decorator';
import { ZodValidationPipe } from '../../common/zod-validation.pipe';
import { SurgeryBoardService } from './surgery-board.service';
import { SurgeryService } from './surgery.service';

const uuid = new ParseUUIDPipe();
const boardQuery = z.strictObject({ date: z.iso.date().optional() });

/**
 * S06 · Kamar operasi (`/api/v1/surgery`, rencana fase 4 §4.7). Izin `surgery.*`: perawat unit OK (lingkup unit:
 * baca, jadwal, daftar tilik, hitung), dokter (lingkup relasi: baca, daftar tilik, laporan, override insisi).
 * Kasir/apoteker tanpa izin → 403. Papan dan setiap aksi diaudit per pasien oleh service.
 */
@ApiTags('penunjang · kamar operasi (S06)')
@TenantScoped()
@RequireModule('S06')
@Controller('surgery')
export class SurgeryController {
  constructor(
    private readonly surgery: SurgeryService,
    private readonly board: SurgeryBoardService,
  ) {}

  @RequirePermission('surgery', 'read')
  @Get('board')
  getBoard(@Query(new ZodValidationPipe(boardQuery)) q: z.infer<typeof boardQuery>) {
    return this.board.board(q.date ?? isoDateJakarta());
  }

  @RequirePermission('surgery', 'read')
  @Get('cases/:id')
  async getCase(@Param('id', uuid) id: string) {
    await this.surgeryAccessCheck(id);
    return this.board.one(id);
  }

  @RequirePermission('surgery', 'schedule')
  @Get('staff')
  staff() {
    return this.surgery.staff();
  }

  @RequirePermission('surgery', 'read')
  @Get('supplies/options')
  supplyOptions() {
    return this.surgery.supplyOptions();
  }

  @RequirePermission('surgery', 'schedule')
  @Post('cases')
  schedule(@Body(new ZodValidationPipe(surgeryCaseInputSchema)) body: SurgeryCaseInput) {
    return this.surgery.schedule(body);
  }

  @RequirePermission('surgery', 'schedule')
  @Post('cases/:id/cancel')
  @HttpCode(200)
  cancel(
    @Param('id', uuid) id: string,
    @Body(new ZodValidationPipe(surgeryCancelInputSchema)) body: { reason: string },
  ) {
    return this.surgery.cancel(id, body.reason);
  }

  @RequirePermission('surgery', 'checklist')
  @Post('cases/:id/checklist/items')
  @HttpCode(200)
  check(
    @Param('id', uuid) id: string,
    @Body(new ZodValidationPipe(checklistItemInputSchema)) body: z.infer<typeof checklistItemInputSchema>,
  ) {
    return this.surgery.checkItem(id, body.phase, body.itemCode);
  }

  @RequirePermission('surgery', 'checklist')
  @Post('cases/:id/checklist/confirm')
  @HttpCode(200)
  confirm(
    @Param('id', uuid) id: string,
    @Body(new ZodValidationPipe(checklistConfirmInputSchema))
    body: z.infer<typeof checklistConfirmInputSchema>,
  ) {
    return this.surgery.confirm(id, body.phase);
  }

  @RequirePermission('surgery', 'checklist')
  @Post('cases/:id/events')
  event(
    @Param('id', uuid) id: string,
    @Body(new ZodValidationPipe(surgeryEventInputSchema)) body: SurgeryEventInput,
  ) {
    return this.surgery.recordEvent(id, body);
  }

  @RequirePermission('surgery', 'count')
  @Post('cases/:id/counts')
  count(
    @Param('id', uuid) id: string,
    @Body(new ZodValidationPipe(surgicalCountInputSchema)) body: SurgicalCountInput,
  ) {
    return this.surgery.count(id, body);
  }

  @RequirePermission('surgery', 'count')
  @Post('cases/:id/count-discrepancies')
  discrepancy(
    @Param('id', uuid) id: string,
    @Body(new ZodValidationPipe(countDiscrepancyInputSchema))
    body: z.infer<typeof countDiscrepancyInputSchema>,
  ) {
    return this.surgery.discrepancy(id, body.itemCode, body.action);
  }

  @RequirePermission('surgery', 'checklist')
  @Post('cases/:id/supplies')
  supplies(
    @Param('id', uuid) id: string,
    @Body(new ZodValidationPipe(surgerySupplyInputSchema)) body: z.infer<typeof surgerySupplyInputSchema>,
  ) {
    return this.surgery.supplies(id, body.items);
  }

  @RequirePermission('surgery', 'report')
  @Post('cases/:id/reports')
  report(
    @Param('id', uuid) id: string,
    @Body(new ZodValidationPipe(operativeReportCreateSchema)) body: OperativeReportCreateInput,
  ) {
    return this.surgery.report(id, body);
  }

  private async surgeryAccessCheck(id: string): Promise<void> {
    await this.surgery.assertReadable(id);
  }
}
