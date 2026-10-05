import { Controller, Get, Param, ParseUUIDPipe } from '@nestjs/common';
import { ApiTags } from '@nestjs/swagger';
import type { EncounterContext, PatientSummary } from '@simrs/shared';
import { RequireModule } from '../../common/require-module.decorator';
import { RequirePermission } from '../../common/require-permission.decorator';
import { TenantScoped } from '../../common/tenant-scoped.decorator';
import { SummaryService } from './summary.service';

const uuid = new ParseUUIDPipe();

/** K14 · `GET /api/v1/summary/patients/:id`: ringkasan pasien lintas kunjungan (kelompok rekam medis). */
@ApiTags('klinis · ringkasan pasien (K14)')
@TenantScoped()
@RequireModule('K14')
@Controller('summary')
export class SummaryController {
  constructor(private readonly summary: SummaryService) {}

  @RequirePermission('clinical', 'read')
  @Get('patients/:id')
  patient(@Param('id', uuid) id: string): Promise<PatientSummary> {
    return this.summary.patientSummary(id);
  }
}

/**
 * Banner pasien `GET /api/v1/encounters/:id/context` (rencana §3.2a; bentuk rute kanonik `/encounters/:id/<sumber>`).
 * Isinya milik modul ringkasan. Modul K01 (worklist klinis), karena banner dipakai semua layar klinis.
 */
@ApiTags('klinis · konteks kunjungan')
@TenantScoped()
@RequireModule('K01')
@Controller('encounters')
export class EncounterContextController {
  constructor(private readonly summary: SummaryService) {}

  @RequirePermission('clinical', 'read')
  @Get(':id/context')
  context(@Param('id', uuid) id: string): Promise<EncounterContext> {
    return this.summary.context(id);
  }
}
