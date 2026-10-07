import { Body, Controller, Get, HttpCode, Param, ParseUUIDPipe, Post, Put } from '@nestjs/common';
import { ApiTags } from '@nestjs/swagger';
import {
  type DeathCertificateInput,
  deathCertificateInputSchema,
  type DischargeAddendumInput,
  dischargeAddendumInputSchema,
  dischargeDraftCreateInputSchema,
  type DischargeDraftInput,
  dischargeDraftInputSchema,
  type DischargeFinalizeInput,
  dischargeFinalizeInputSchema,
  dischargeReconciliationInputSchema,
  type EncounterCloseInput,
  encounterCloseInputSchema,
} from '@simrs/shared';
import { RequireModule } from '../../common/require-module.decorator';
import { RequirePermission } from '../../common/require-permission.decorator';
import { TenantScoped } from '../../common/tenant-scoped.decorator';
import { ZodValidationPipe } from '../../common/zod-validation.pipe';
import { DeathCertificateService } from './death-certificate.service';
import { DischargeService } from './discharge.service';
import { EncounterCloseService } from './encounter-close.service';

const uuid = new ParseUUIDPipe();

/**
 * K13 · Resume medis + rekonsiliasi obat (`/api/v1/discharge`, rencana fase 3 §3.6). Draf `clinical.write`;
 * konfirmasi rekonsiliasi, finalisasi TTE, dan addendum `clinical.sign` (DPJP, lingkup relasi).
 */
@ApiTags('klinis · resume dan pulang (K13)')
@TenantScoped()
@RequireModule('K13')
@Controller('discharge')
export class DischargeController {
  constructor(private readonly discharge: DischargeService) {}

  @RequirePermission('clinical', 'write')
  @Post('summaries')
  create(@Body(new ZodValidationPipe(dischargeDraftCreateInputSchema)) body: { encounterId: string }) {
    return this.discharge.createDraft(body.encounterId);
  }

  @RequirePermission('clinical', 'write')
  @Put('summaries/:encounterId/draft')
  save(
    @Param('encounterId', uuid) encounterId: string,
    @Body(new ZodValidationPipe(dischargeDraftInputSchema)) body: DischargeDraftInput,
  ) {
    return this.discharge.saveDraft(encounterId, body);
  }

  @RequirePermission('clinical', 'sign')
  @Post('summaries/:encounterId/reconciliation')
  @HttpCode(200)
  reconcile(
    @Param('encounterId', uuid) encounterId: string,
    @Body(new ZodValidationPipe(dischargeReconciliationInputSchema)) body: { confirmed: boolean },
  ) {
    return this.discharge.reconcile(encounterId, body.confirmed);
  }

  @RequirePermission('clinical', 'sign')
  @Post('summaries/:encounterId/finalize')
  finalize(
    @Param('encounterId', uuid) encounterId: string,
    @Body(new ZodValidationPipe(dischargeFinalizeInputSchema)) body: DischargeFinalizeInput,
  ) {
    return this.discharge.finalize(encounterId, body);
  }

  @RequirePermission('clinical', 'sign')
  @Post('summaries/:id/addenda')
  addendum(
    @Param('id', uuid) id: string,
    @Body(new ZodValidationPipe(dischargeAddendumInputSchema)) body: DischargeAddendumInput,
  ) {
    return this.discharge.addendum(id, body);
  }
}

/**
 * K13 · Rute per kunjungan kanonik: resume (`GET /encounters/:id/discharge-summary`), surat keterangan kematian
 * (keputusan K-1), dan tutup kunjungan lewat `DischargeGate` (`POST /encounters/:id/close`).
 */
@ApiTags('klinis · resume dan pulang (K13)')
@TenantScoped()
@RequireModule('K13')
@Controller('encounters')
export class DischargeEncounterController {
  constructor(
    private readonly discharge: DischargeService,
    private readonly death: DeathCertificateService,
    private readonly closer: EncounterCloseService,
  ) {}

  @RequirePermission('clinical', 'read')
  @Get(':id/discharge-summary')
  summary(@Param('id', uuid) id: string) {
    return this.discharge.view(id);
  }

  @RequirePermission('clinical', 'read')
  @Get(':id/death-certificate')
  deathCertificate(@Param('id', uuid) id: string) {
    return this.death.get(id);
  }

  @RequirePermission('clinical', 'sign')
  @Post(':id/death-certificate')
  certifyDeath(
    @Param('id', uuid) id: string,
    @Body(new ZodValidationPipe(deathCertificateInputSchema)) body: DeathCertificateInput,
  ) {
    return this.death.create(id, body);
  }

  @RequirePermission('clinical', 'write')
  @Post(':id/close')
  @HttpCode(200)
  close(
    @Param('id', uuid) id: string,
    @Body(new ZodValidationPipe(encounterCloseInputSchema)) body: EncounterCloseInput,
  ) {
    return this.closer.close(id, body);
  }
}
