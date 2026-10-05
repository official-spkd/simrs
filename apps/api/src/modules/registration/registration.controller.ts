import { Body, Controller, Get, Headers, HttpCode, Inject, Param, ParseUUIDPipe, Post } from '@nestjs/common';
import { ApiTags } from '@nestjs/swagger';
import {
  type DukcapilLookupResult,
  dukcapilLookupSchema,
  type OutpatientRegistrationInput,
  outpatientRegistrationSchema,
  type RegistrationDesk,
  type RegistrationResult,
} from '@simrs/shared';
import { Audited, type AuditSource, paramId } from '../../common/audited.decorator';
import { NoRequestTransaction } from '../../common/no-request-transaction.decorator';
import { RequireModule } from '../../common/require-module.decorator';
import { RequirePermission } from '../../common/require-permission.decorator';
import { TenantScoped } from '../../common/tenant-scoped.decorator';
import { ZodValidationPipe } from '../../common/zod-validation.pipe';
import type { LookupConnector } from '../../infra/lookup/lookup-connector';
import { LookupGateway } from '../../infra/lookup/lookup.gateway';
import { DUKCAPIL_LOOKUP } from './dukcapil-lookup';
import { RegistrationService } from './registration.service';

const uuid = new ParseUUIDPipe();
const resultPatient = ({ result }: AuditSource): string | undefined =>
  (result as RegistrationResult | undefined)?.encounter.patientId;

/**
 * F03 · Registrasi (`/api/v1/registration`, kontrak `@simrs/shared` `schemas/registration`). Rawat jalan
 * (potongan 5a); IGD dan admisi menyusul (potongan 7). Registrasi diaudit `create` per pasien oleh service (ulangan
 * Idempotency-Key diaudit `read`).
 */
@ApiTags('registration (F03)')
@TenantScoped()
@RequireModule('F03')
@Controller('registration')
export class RegistrationController {
  constructor(
    private readonly registration: RegistrationService,
    private readonly lookups: LookupGateway,
    @Inject(DUKCAPIL_LOOKUP)
    private readonly dukcapil: LookupConnector<{ nik: string }, DukcapilLookupResult>,
  ) {}

  /** Registrasi rawat jalan. Header `Idempotency-Key` (UUID) wajib; ulangan dengan kunci sama = hasil sama (201). */
  @RequirePermission('encounter', 'write')
  @Post('outpatient')
  outpatient(
    @Body(new ZodValidationPipe(outpatientRegistrationSchema)) body: OutpatientRegistrationInput,
    @Headers('idempotency-key') key: string | undefined,
  ): Promise<RegistrationResult> {
    return this.registration.registerOutpatient(body, key);
  }

  /** Meja pendaftaran: antrean loket + kuota dokter hari ini. */
  @RequirePermission('encounter', 'write')
  @Get('desk')
  desk(): Promise<RegistrationDesk> {
    return this.registration.desk();
  }

  @RequirePermission('encounter', 'read')
  @Get('encounters/:id')
  @Audited({ action: 'read', resource: 'encounter', resourceId: paramId, patientId: resultPatient })
  encounter(@Param('id', uuid) id: string): Promise<RegistrationResult> {
    return this.registration.getEncounter(id);
  }

  /** Isian otomatis pasien baru dari Dukcapil (NIK di body; tidak disimpan). */
  @RequirePermission('patient', 'write')
  @Post('dukcapil-lookup')
  @HttpCode(200)
  @NoRequestTransaction()
  dukcapilLookup(@Body(new ZodValidationPipe(dukcapilLookupSchema)) body: { nik: string }) {
    return this.lookups.lookup(this.dukcapil, { nik: body.nik });
  }
}
