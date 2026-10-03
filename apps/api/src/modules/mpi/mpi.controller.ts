import { Body, Controller, Get, Param, ParseUUIDPipe, Patch, Post, Put, Query } from '@nestjs/common';
import { ApiTags } from '@nestjs/swagger';
import {
  createPatientSchema,
  type CreatePatientInput,
  identifierSystemParam,
  type IdentifierSystem,
  patientSearchSchema,
  type PatientSearchQuery,
  revealQuerySchema,
  setIdentifierSchema,
  type SetIdentifierInput,
  updatePatientSchema,
  type UpdatePatientInput,
} from '@simrs/shared';
import type { z } from 'zod';
import { Audited, type AuditSource, changedFields, paramId, resultId } from '../../common/audited.decorator';
import { RequireModule } from '../../common/require-module.decorator';
import { RequirePermission } from '../../common/require-permission.decorator';
import { TenantScoped } from '../../common/tenant-scoped.decorator';
import { ZodValidationPipe } from '../../common/zod-validation.pipe';
import { MpiService } from './mpi.service';

const uuid = new ParseUUIDPipe();

/** Nama field + sistem identifier yang diisi saat daftar (tanpa nilainya). */
const createdFields = ({ body }: AuditSource) => {
  const b = (body ?? {}) as { identifiers?: Record<string, unknown> };
  return {
    fields: Object.keys(b).sort(),
    identifiers: Object.keys(b.identifiers ?? {}).sort(),
  };
};

/**
 * P05 · Master Patient Index. Pencarian, detail, pendaftaran, dan perubahan identitas pasien.
 * Hasil pencarian dan setiap pembukaan identitas utuh diaudit per pasien di service.
 */
@ApiTags('mpi (P05)')
@TenantScoped()
@RequireModule('P05')
@Controller('patients')
export class MpiController {
  constructor(private readonly mpi: MpiService) {}

  @RequirePermission('patient', 'read')
  @Get()
  search(@Query(new ZodValidationPipe(patientSearchSchema)) q: PatientSearchQuery) {
    return this.mpi.search(q);
  }

  @RequirePermission('patient', 'write')
  @Post()
  @Audited({
    action: 'create',
    resource: 'patient',
    resourceId: resultId,
    patientId: resultId,
    details: createdFields,
  })
  create(@Body(new ZodValidationPipe(createPatientSchema)) body: CreatePatientInput) {
    return this.mpi.create(body);
  }

  @RequirePermission('patient', 'read')
  @Get(':id')
  @Audited({ action: 'read', resource: 'patient', resourceId: paramId, patientId: paramId })
  get(@Param('id', uuid) id: string) {
    return this.mpi.get(id);
  }

  @RequirePermission('patient', 'write')
  @Patch(':id')
  @Audited({
    action: 'update',
    resource: 'patient',
    resourceId: paramId,
    patientId: paramId,
    details: changedFields,
  })
  update(
    @Param('id', uuid) id: string,
    @Body(new ZodValidationPipe(updatePatientSchema)) body: UpdatePatientInput,
  ) {
    return this.mpi.update(id, body);
  }

  @RequirePermission('patient', 'write')
  @Put(':id/identifiers/:system')
  setIdentifier(
    @Param('id', uuid) id: string,
    @Param('system', new ZodValidationPipe(identifierSystemParam)) system: IdentifierSystem,
    @Body(new ZodValidationPipe(setIdentifierSchema)) body: SetIdentifierInput,
  ) {
    return this.mpi.setIdentifier(id, system, body);
  }

  @RequirePermission('patient.identity', 'read')
  @Get(':id/reveal')
  reveal(
    @Param('id', uuid) id: string,
    @Query(new ZodValidationPipe(revealQuerySchema)) q: z.infer<typeof revealQuerySchema>,
  ) {
    return this.mpi.reveal(id, q.field);
  }
}
