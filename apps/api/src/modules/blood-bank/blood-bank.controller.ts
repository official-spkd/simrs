import { Body, Controller, Get, Param, ParseUUIDPipe, Post, Put, Query } from '@nestjs/common';
import { ApiTags } from '@nestjs/swagger';
import {
  type BloodBoardQuery,
  type BloodDisposalInput,
  bloodDisposalInputSchema,
  type BloodRequestCancelInput,
  bloodRequestCancelInputSchema,
  bloodBoardQuerySchema,
  type BloodGroupInput,
  bloodGroupInputSchema,
  type BloodIssueCheckInput,
  bloodIssueCheckInputSchema,
  type BloodIssueConfirmInput,
  bloodIssueConfirmInputSchema,
  type BloodRequestInput,
  bloodRequestInputSchema,
  type BloodUnitInput,
  bloodUnitInputSchema,
  crossmatchInputSchema,
  transfusionReactionInputSchema,
  type TransfusionStartInput,
  transfusionStartInputSchema,
  type TransfusionStopInput,
  transfusionStopInputSchema,
  type TransfusionVerifyInput,
  transfusionVerifyInputSchema,
  type TransfusionVitalsInput,
  transfusionVitalsInputSchema,
} from '@simrs/shared';
import type { z } from 'zod';
import { RequireModule } from '../../common/require-module.decorator';
import { RequirePermission } from '../../common/require-permission.decorator';
import { TenantScoped } from '../../common/tenant-scoped.decorator';
import { ZodValidationPipe } from '../../common/zod-validation.pipe';
import { BloodBankService } from './blood-bank.service';
import { TransfusionService } from './transfusion.service';

const uuid = new ParseUUIDPipe();

/**
 * S08 · `/api/v1/blood/*`: papan permintaan + stok, permintaan DPJP, terima + golongan + crossmatch (bank darah),
 * cek ganda dua petugas + pengeluaran, kantong masuk, dan transfusi di samping pasien (gelang ↔ kantong + petugas
 * kedua, TTV, reaksi). Audit di service.
 */
@ApiTags('penunjang · bank darah (S08)')
@TenantScoped()
@RequireModule('S08')
@Controller('blood')
export class BloodBankController {
  constructor(
    private readonly bank: BloodBankService,
    private readonly transfusions: TransfusionService,
  ) {}

  @RequirePermission('blood_bank', 'read')
  @Get('board')
  board(@Query(new ZodValidationPipe(bloodBoardQuerySchema)) q: BloodBoardQuery) {
    return this.bank.board(q);
  }

  @RequirePermission('blood_bank', 'read')
  @Get('requests/:id')
  get(@Param('id', uuid) id: string) {
    return this.bank.get(id);
  }

  @RequirePermission('blood_bank', 'request')
  @Post('requests')
  create(@Body(new ZodValidationPipe(bloodRequestInputSchema)) body: BloodRequestInput) {
    return this.bank.createRequest(body);
  }

  /** Pembatalan beralasan oleh DPJP peminta (`blood_bank.request`). */
  @RequirePermission('blood_bank', 'request')
  @Post('requests/:id/cancel')
  cancel(
    @Param('id', uuid) id: string,
    @Body(new ZodValidationPipe(bloodRequestCancelInputSchema)) body: BloodRequestCancelInput,
  ) {
    return this.bank.cancel(id, body);
  }

  /** Pembatalan beralasan oleh bank darah (`blood_bank.crossmatch`), mis. sampel tidak layak. */
  @RequirePermission('blood_bank', 'crossmatch')
  @Post('requests/:id/reject')
  reject(
    @Param('id', uuid) id: string,
    @Body(new ZodValidationPipe(bloodRequestCancelInputSchema)) body: BloodRequestCancelInput,
  ) {
    return this.bank.cancel(id, body);
  }

  @RequirePermission('blood_bank', 'issue')
  @Post('disposals')
  requestDisposal(@Body(new ZodValidationPipe(bloodDisposalInputSchema)) body: BloodDisposalInput) {
    return this.bank.requestDisposal(body);
  }

  @RequirePermission('blood_bank', 'issue')
  @Post('disposals/:id/confirm')
  confirmDisposal(@Param('id', uuid) id: string) {
    return this.bank.confirmDisposal(id);
  }

  @RequirePermission('blood_bank', 'crossmatch')
  @Post('requests/:id/receive')
  receive(@Param('id', uuid) id: string) {
    return this.bank.receive(id);
  }

  @RequirePermission('blood_bank', 'crossmatch')
  @Put('requests/:id/group')
  group(
    @Param('id', uuid) id: string,
    @Body(new ZodValidationPipe(bloodGroupInputSchema)) body: BloodGroupInput,
  ) {
    return this.bank.setGroup(id, body);
  }

  @RequirePermission('blood_bank', 'crossmatch')
  @Post('crossmatches')
  crossmatch(
    @Body(new ZodValidationPipe(crossmatchInputSchema)) body: z.infer<typeof crossmatchInputSchema>,
  ) {
    return this.bank.crossmatch(body);
  }

  @RequirePermission('blood_bank', 'crossmatch')
  @Post('units')
  registerUnit(@Body(new ZodValidationPipe(bloodUnitInputSchema)) body: BloodUnitInput) {
    return this.bank.registerUnit(body);
  }

  @RequirePermission('blood_bank', 'issue')
  @Post('issue-checks')
  issueCheck(@Body(new ZodValidationPipe(bloodIssueCheckInputSchema)) body: BloodIssueCheckInput) {
    return this.bank.issueCheck(body);
  }

  @RequirePermission('blood_bank', 'issue')
  @Post('issues')
  issue(@Body(new ZodValidationPipe(bloodIssueConfirmInputSchema)) body: BloodIssueConfirmInput) {
    return this.bank.confirmIssue(body);
  }

  @RequirePermission('blood_bank', 'transfuse')
  @Post('transfusions')
  start(@Body(new ZodValidationPipe(transfusionStartInputSchema)) body: TransfusionStartInput) {
    return this.transfusions.start(body);
  }

  @RequirePermission('blood_bank', 'transfuse')
  @Post('transfusions/:id/verify')
  verify(
    @Param('id', uuid) id: string,
    @Body(new ZodValidationPipe(transfusionVerifyInputSchema)) body: TransfusionVerifyInput,
  ) {
    return this.transfusions.verify(id, body);
  }

  @RequirePermission('blood_bank', 'transfuse')
  @Post('transfusions/:id/vitals')
  vitals(
    @Param('id', uuid) id: string,
    @Body(new ZodValidationPipe(transfusionVitalsInputSchema)) body: TransfusionVitalsInput,
  ) {
    return this.transfusions.vitals(id, body);
  }

  @RequirePermission('blood_bank', 'transfuse')
  @Post('transfusions/:id/finish')
  finish(@Param('id', uuid) id: string) {
    return this.transfusions.finish(id);
  }

  @RequirePermission('blood_bank', 'transfuse')
  @Post('transfusions/:id/stop')
  stop(
    @Param('id', uuid) id: string,
    @Body(new ZodValidationPipe(transfusionStopInputSchema)) body: TransfusionStopInput,
  ) {
    return this.transfusions.stop(id, body);
  }

  @RequirePermission('blood_bank', 'transfuse')
  @Post('reactions')
  reaction(
    @Body(new ZodValidationPipe(transfusionReactionInputSchema))
    body: z.infer<typeof transfusionReactionInputSchema>,
  ) {
    return this.transfusions.reaction(body);
  }
}
