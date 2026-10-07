import {
  Body,
  Controller,
  Get,
  Headers,
  HttpCode,
  Inject,
  Param,
  ParseUUIDPipe,
  Post,
  Query,
} from '@nestjs/common';
import { ApiTags } from '@nestjs/swagger';
import {
  type AdmissionInput,
  admissionSchema,
  type CancelEncounterInput,
  cancelEncounterSchema,
  type DukcapilLookupResult,
  dukcapilLookupSchema,
  type EmergencyAdmissionInput,
  emergencyAdmissionInputSchema,
  type EmergencyAdmissionResult,
  type EmergencyRegistrationInput,
  emergencyRegistrationSchema,
  type EncounterList,
  type EncounterListQuery,
  encounterListQuerySchema,
  type OutpatientRegistrationInput,
  type PrintableVisit,
  outpatientRegistrationSchema,
  type PractitionerOption,
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
import { AdmissionService } from './admission.service';
import { DUKCAPIL_LOOKUP } from './dukcapil-lookup';
import { RegistrationService } from './registration.service';

const uuid = new ParseUUIDPipe();
const resultPatient = ({ result }: AuditSource): string | undefined =>
  (result as RegistrationResult | undefined)?.encounter.patientId;

/**
 * F03 · Registrasi (`/api/v1/registration`, kontrak `@simrs/shared` `schemas/registration`): rawat jalan
 * (potongan 5a), IGD dan admisi rawat inap (potongan 7). Registrasi diaudit `create` per pasien oleh service (ulangan
 * Idempotency-Key diaudit `read`); daftar kunjungan diaudit per pasien yang tampil.
 */
@ApiTags('registration (F03)')
@TenantScoped()
@RequireModule('F03')
@Controller('registration')
export class RegistrationController {
  constructor(
    private readonly registration: RegistrationService,
    private readonly admissions: AdmissionService,
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

  /** Registrasi IGD (pasien tanpa identitas boleh). Header `Idempotency-Key` (UUID) wajib. */
  @RequirePermission('encounter', 'write')
  @Post('emergency')
  emergency(
    @Body(new ZodValidationPipe(emergencyRegistrationSchema)) body: EmergencyRegistrationInput,
    @Headers('idempotency-key') key: string | undefined,
  ): Promise<RegistrationResult> {
    return this.admissions.registerEmergency(body, key);
  }

  /** Admisi rawat inap terencana (`planned`). Header `Idempotency-Key` (UUID) wajib. */
  @RequirePermission('encounter', 'write')
  @Post('admissions')
  admission(
    @Body(new ZodValidationPipe(admissionSchema)) body: AdmissionInput,
    @Headers('idempotency-key') key: string | undefined,
  ): Promise<RegistrationResult> {
    return this.admissions.admit(body, key);
  }

  /**
   * Admisi dari IGD (W3): permintaan bed IGD yang sudah dialokasikan → admisi rawat inap + masuk bed + gelang, satu
   * transaksi. Header `Idempotency-Key` (UUID) wajib.
   */
  @RequirePermission('encounter', 'write')
  @Post('emergency-admissions')
  emergencyAdmission(
    @Body(new ZodValidationPipe(emergencyAdmissionInputSchema)) body: EmergencyAdmissionInput,
    @Headers('idempotency-key') key: string | undefined,
  ): Promise<EmergencyAdmissionResult> {
    return this.admissions.admitFromEmergency(body, key);
  }

  /** Dokter aktif untuk pilihan DPJP admisi rawat inap (nama + spesialisasi saja). */
  @RequirePermission('encounter', 'write')
  @Get('practitioners')
  practitioners(): Promise<{ items: PractitionerOption[] }> {
    return this.admissions.doctors();
  }

  /** Daftar kunjungan (ABAC: lingkup unit = unit penugasan, relasi = pasien berelasi). */
  @RequirePermission('encounter', 'read')
  @Get('encounters')
  list(
    @Query(new ZodValidationPipe(encounterListQuerySchema)) q: EncounterListQuery,
  ): Promise<EncounterList> {
    return this.admissions.list(q);
  }

  /** Batal kunjungan IGD (`arrived`) atau admisi `planned`; alasan wajib. */
  @RequirePermission('encounter', 'cancel')
  @Post('encounters/:id/cancel')
  @HttpCode(200)
  cancel(
    @Param('id', uuid) id: string,
    @Body(new ZodValidationPipe(cancelEncounterSchema)) body: CancelEncounterInput,
  ): Promise<RegistrationResult> {
    return this.admissions.cancel(id, body);
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

  /** Lembar cetak loket (tiket poli + ringkasan SEP, HTML 80 mm di web); diaudit `print` oleh service. */
  @RequirePermission('documents', 'print')
  @Get('encounters/:id/print')
  print(@Param('id', uuid) id: string): Promise<PrintableVisit> {
    return this.registration.printable(id);
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
