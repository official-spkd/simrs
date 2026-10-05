import { Body, Controller, Get, Param, ParseUUIDPipe, Post, Query } from '@nestjs/common';
import { ApiTags } from '@nestjs/swagger';
import {
  type AllergyInput,
  allergyInputSchema,
  type ClinicalEnteredInErrorInput,
  clinicalEnteredInErrorInputSchema,
  type ConditionInput,
  conditionInputSchema,
  patientQuerySchema,
  type ProcedureInput,
  procedureInputSchema,
} from '@simrs/shared';
import { RequireModule } from '../../common/require-module.decorator';
import { RequirePermission } from '../../common/require-permission.decorator';
import { TenantScoped } from '../../common/tenant-scoped.decorator';
import { ZodValidationPipe } from '../../common/zod-validation.pipe';
import { DiagnosisService } from './diagnosis.service';

const uuid = new ParseUUIDPipe();
const reason = new ZodValidationPipe(clinicalEnteredInErrorInputSchema);

/**
 * K08 · Daftar per kunjungan dalam bentuk rute kanonik `/api/v1/encounters/:id/<sumber>`: diagnosis + problem list yang
 * dicatat di kunjungan itu, dan prosedurnya. Versi final terkini saja.
 */
@ApiTags('klinis · diagnosis (K08)')
@TenantScoped()
@RequireModule('K08')
@Controller('encounters')
export class EncounterDiagnosisController {
  constructor(private readonly diagnosis: DiagnosisService) {}

  @RequirePermission('clinical', 'read')
  @Get(':id/conditions')
  conditions(@Param('id', new ParseUUIDPipe()) id: string) {
    return this.diagnosis.listConditions(id);
  }

  @RequirePermission('clinical', 'read')
  @Get(':id/procedures')
  procedures(@Param('id', new ParseUUIDPipe()) id: string) {
    return this.diagnosis.listProcedures(id);
  }
}

/**
 * K08 · `/api/v1/diagnosis/*`: diagnosis ICD-10 (kunjungan + problem list), prosedur ICD-9-CM, alergi + NKDA. Satu
 * POST per jenis menerima entri baru, koreksi (izin tambahan `clinical.correct`), dan addendum (`revision`). Salah
 * entri lewat `POST …/:id/entered-in-error` (`clinical.correct`). Penulis selalu dari sesi; ABAC per pasien; audit
 * per pasien di service.
 */
@ApiTags('klinis · diagnosis (K08)')
@TenantScoped()
@RequireModule('K08')
@Controller('diagnosis')
export class DiagnosisController {
  constructor(private readonly diagnosis: DiagnosisService) {}

  @RequirePermission('clinical', 'write')
  @Post('conditions')
  createCondition(@Body(new ZodValidationPipe(conditionInputSchema)) body: ConditionInput) {
    return this.diagnosis.createCondition(body);
  }

  @RequirePermission('clinical', 'correct')
  @Post('conditions/:id/entered-in-error')
  conditionError(@Param('id', uuid) id: string, @Body(reason) body: ClinicalEnteredInErrorInput) {
    return this.diagnosis.enteredInError('conditions', id, body.reason);
  }

  @RequirePermission('clinical', 'read')
  @Get('problem-list')
  problemList(@Query(new ZodValidationPipe(patientQuerySchema)) q: { patientId: string }) {
    return this.diagnosis.problemList(q.patientId);
  }

  @RequirePermission('clinical', 'write')
  @Post('procedures')
  createProcedure(@Body(new ZodValidationPipe(procedureInputSchema)) body: ProcedureInput) {
    return this.diagnosis.createProcedure(body);
  }

  @RequirePermission('clinical', 'correct')
  @Post('procedures/:id/entered-in-error')
  procedureError(@Param('id', uuid) id: string, @Body(reason) body: ClinicalEnteredInErrorInput) {
    return this.diagnosis.enteredInError('procedures', id, body.reason);
  }

  @RequirePermission('clinical', 'write')
  @Post('allergies')
  createAllergy(@Body(new ZodValidationPipe(allergyInputSchema)) body: AllergyInput) {
    return this.diagnosis.createAllergy(body);
  }

  @RequirePermission('clinical', 'read')
  @Get('allergies')
  allergies(@Query(new ZodValidationPipe(patientQuerySchema)) q: { patientId: string }) {
    return this.diagnosis.patientAllergies(q.patientId);
  }

  @RequirePermission('clinical', 'correct')
  @Post('allergies/:id/entered-in-error')
  allergyError(@Param('id', uuid) id: string, @Body(reason) body: ClinicalEnteredInErrorInput) {
    return this.diagnosis.enteredInError('allergies', id, body.reason);
  }
}
