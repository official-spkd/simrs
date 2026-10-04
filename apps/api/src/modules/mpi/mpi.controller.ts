import {
  Body,
  Controller,
  Get,
  HttpCode,
  Param,
  ParseUUIDPipe,
  Patch,
  Post,
  Put,
  Query,
} from '@nestjs/common';
import { ApiTags } from '@nestjs/swagger';
import {
  createConsentSchema,
  type CreateConsentInput,
  createPatientSchema,
  type CreatePatientInput,
  identifierSystemParam,
  type IdentifierSystem,
  patientSearchSchema,
  type PatientSearchQuery,
  revealQuerySchema,
  revokeConsentSchema,
  type RevokeConsentInput,
  setIdentifierSchema,
  type SetIdentifierInput,
  updatePatientSchema,
  type UpdatePatientInput,
} from '@simrs/shared';
import type { z } from 'zod';
import {
  Audited,
  type AuditSource,
  bodyReason,
  changedFields,
  param,
  paramId,
  resultId,
} from '../../common/audited.decorator';
import { RequireModule } from '../../common/require-module.decorator';
import { RequirePermission } from '../../common/require-permission.decorator';
import { TenantScoped } from '../../common/tenant-scoped.decorator';
import { ZodValidationPipe } from '../../common/zod-validation.pipe';
import { ConsentService } from './consent.service';
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

/** Jenis persetujuan (tanpa nama penerima, yang bisa mengidentifikasi hubungan pasien). */
const consentDetails = ({ body }: AuditSource) => {
  const b = (body ?? {}) as { kind?: unknown };
  return typeof b.kind === 'string' ? { kind: b.kind } : undefined;
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
  constructor(
    private readonly mpi: MpiService,
    private readonly consents: ConsentService,
  ) {}

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

  /** Verifikasi ulang NIK ke Dukcapil (lewat outbox); hasil diisi worker. */
  @RequirePermission('patient', 'write')
  @Post(':id/identifiers/nik/verify')
  @HttpCode(202)
  verifyNik(@Param('id', uuid) id: string) {
    return this.mpi.verifyNik(id);
  }

  @RequirePermission('patient', 'read')
  @Get(':id/consents')
  @Audited({ action: 'read', resource: 'privacy_consent', resourceId: paramId, patientId: paramId })
  listConsents(@Param('id', uuid) id: string) {
    return this.consents.list(id);
  }

  @RequirePermission('patient', 'write')
  @Post(':id/consents')
  @Audited({
    action: 'create',
    resource: 'privacy_consent',
    resourceId: resultId,
    patientId: paramId,
    details: consentDetails,
  })
  createConsent(
    @Param('id', uuid) id: string,
    @Body(new ZodValidationPipe(createConsentSchema)) body: CreateConsentInput,
  ) {
    return this.consents.create(id, body);
  }

  @RequirePermission('patient', 'write')
  @Post(':id/consents/:consentId/revoke')
  @HttpCode(200)
  @Audited({
    action: 'deactivate',
    resource: 'privacy_consent',
    resourceId: param('consentId'),
    patientId: paramId,
    reason: bodyReason,
  })
  revokeConsent(
    @Param('id', uuid) id: string,
    @Param('consentId', uuid) consentId: string,
    @Body(new ZodValidationPipe(revokeConsentSchema)) body: RevokeConsentInput,
  ) {
    return this.consents.revoke(id, consentId, body);
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
