import { Body, Controller, Get, Param, ParseUUIDPipe, Post, Query } from '@nestjs/common';
import { ApiTags } from '@nestjs/swagger';
import {
  clinicalError,
  emarQuerySchema,
  fluidBalanceInputSchema,
  medicationAdministrationInputSchema,
  medicationDoubleCheckInputSchema,
  nursingCarePlanInputSchema,
  nursingEncounterQuerySchema,
  wristbandScanInputSchema,
  type FluidBalanceInput,
  type MedicationAdministrationInput,
  type MedicationDoubleCheckInput,
  type NursingCarePlanInput,
  type WristbandScanInput,
} from '@simrs/shared';
import { NoRequestTransaction } from '../../common/no-request-transaction.decorator';
import { RequireModule } from '../../common/require-module.decorator';
import { RequirePermission } from '../../common/require-permission.decorator';
import { TenantScoped } from '../../common/tenant-scoped.decorator';
import { ZodValidationPipe } from '../../common/zod-validation.pipe';
import { TenantDb } from '../../infra/tenant-db';
import { EmarService } from './emar.service';
import { NursingCareService } from './nursing-care.service';

const uuid = new ParseUUIDPipe();

@ApiTags('klinis · keperawatan')
@TenantScoped()
@RequireModule('K12')
@Controller('nursing')
export class NursingController {
  constructor(
    private readonly emar: EmarService,
    private readonly care: NursingCareService,
    private readonly db: TenantDb,
  ) {}

  // Pindaian tidak cocok tetap disimpan dan diaudit sebelum menjawab 422.
  @RequirePermission('medication', 'administer')
  @NoRequestTransaction()
  @Post('wristband-scans')
  async scan(@Body(new ZodValidationPipe(wristbandScanInputSchema)) body: WristbandScanInput) {
    const scan = await this.db.transaction(() => this.emar.scan(body));
    if (!scan.matched) throw clinicalError('WRISTBAND_MISMATCH');
    return scan;
  }

  /** Pindaian cocok yang masih berlaku (cek ganda dua sesi: perawat kedua memilih pindaian rekan). */
  @RequirePermission('medication', 'administer')
  @Get('wristband-scans')
  activeScans(@Query(new ZodValidationPipe(nursingEncounterQuerySchema)) q: { encounterId: string }) {
    return this.emar.activeScans(q.encounterId);
  }

  /** Atestasi cek ganda atas pindaian yang masih berlaku (isi dosis beku untuk pemberian). */
  @RequirePermission('medication', 'administer')
  @Get('double-checks')
  doubleChecks(@Query(new ZodValidationPipe(nursingEncounterQuerySchema)) q: { encounterId: string }) {
    return this.emar.doubleChecks(q.encounterId);
  }

  @RequirePermission('clinical', 'read')
  @Get('emar/:encounterId')
  board(
    @Param('encounterId', uuid) id: string,
    @Query(new ZodValidationPipe(emarQuerySchema)) query: { date?: string },
  ) {
    return this.emar.board(id, query.date);
  }

  @RequirePermission('medication', 'administer')
  @Post('double-checks')
  doubleCheck(
    @Body(new ZodValidationPipe(medicationDoubleCheckInputSchema)) body: MedicationDoubleCheckInput,
  ) {
    return this.emar.doubleCheck(body);
  }

  @RequirePermission('medication', 'administer')
  @Post('administrations')
  administer(
    @Body(new ZodValidationPipe(medicationAdministrationInputSchema)) body: MedicationAdministrationInput,
  ) {
    return this.emar.administer(body);
  }

  @RequirePermission('clinical', 'read')
  @Get('diagnoses')
  diagnoses() {
    return this.care.diagnoses();
  }

  @RequirePermission('clinical', 'write')
  @Post('care-plans')
  createPlan(@Body(new ZodValidationPipe(nursingCarePlanInputSchema)) body: NursingCarePlanInput) {
    return this.care.recordPlan(body);
  }

  @RequirePermission('clinical', 'read')
  @Get('care-plans/:encounterId')
  plans(@Param('encounterId', uuid) id: string) {
    return this.care.plans(id);
  }

  @RequirePermission('clinical', 'write')
  @Post('fluid-balances')
  recordFluid(@Body(new ZodValidationPipe(fluidBalanceInputSchema)) body: FluidBalanceInput) {
    return this.care.recordFluid(body);
  }

  @RequirePermission('clinical', 'read')
  @Get('fluid-balances/:encounterId')
  fluids(
    @Param('encounterId', uuid) id: string,
    @Query(new ZodValidationPipe(emarQuerySchema)) query: { date?: string },
  ) {
    return this.care.fluids(id, query.date);
  }
}

/**
 * K12 · Alias rute per kunjungan kanonik (`/api/v1/encounters/:id/<sumber>`, keputusan orkestrator W4): papan eMAR,
 * rencana asuhan, dan balans cairan. Izin, ABAC, dan audit sama persis dengan rute `/nursing/...` (layanan yang sama);
 * rute lama tetap berlaku.
 */
@ApiTags('klinis · keperawatan')
@TenantScoped()
@RequireModule('K12')
@Controller('encounters')
export class EncounterNursingController {
  constructor(
    private readonly emar: EmarService,
    private readonly care: NursingCareService,
  ) {}

  @RequirePermission('clinical', 'read')
  @Get(':id/emar')
  board(
    @Param('id', uuid) id: string,
    @Query(new ZodValidationPipe(emarQuerySchema)) query: { date?: string },
  ) {
    return this.emar.board(id, query.date);
  }

  @RequirePermission('clinical', 'read')
  @Get(':id/care-plans')
  plans(@Param('id', uuid) id: string) {
    return this.care.plans(id);
  }

  @RequirePermission('clinical', 'read')
  @Get(':id/fluid-balances')
  fluids(
    @Param('id', uuid) id: string,
    @Query(new ZodValidationPipe(emarQuerySchema)) query: { date?: string },
  ) {
    return this.care.fluids(id, query.date);
  }
}
