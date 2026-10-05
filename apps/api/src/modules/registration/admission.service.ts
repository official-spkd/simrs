import { Inject, Injectable } from '@nestjs/common';
import { allocateNumber, insertPatient } from '@simrs/db';
import {
  type AdmissionInput,
  AppError,
  type CancelEncounterInput,
  type EmergencyRegistrationInput,
  type EncounterList,
  type EncounterListQuery,
  encounterClassToken,
  frontOfficeError,
  isoDateJakarta,
  newId,
  type RegistrationResult,
  unidentifiedPatientName,
} from '@simrs/shared';
import { PatientCrypto } from '@simrs/shared/node';
import { AuditedDenial } from '../../common/audited-denial';
import { type IdempotencyClaim, IdempotencyService } from '../../common/idempotency';
import { API_ENV, type ApiEnv } from '../../config/env';
import { DomainEvents } from '../../infra/events/domain-events';
import { TenantDb } from '../../infra/tenant-db';
import { PatientAccessService, patientAccessSql } from '../authz/patient-access.service';
import { ContactsService } from './contacts.service';
import { RegistrationRepository } from './registration.repository';
import { RegistrationService, toEncounter } from './registration.service';

export const EMERGENCY_SCOPE = 'registration.emergency';
export const ADMISSION_SCOPE = 'registration.admission';

const invalid = (message: string, details?: unknown) =>
  new AppError('VALIDATION_FAILED', message, 422, details);

/**
 * F03 · Registrasi IGD dan admisi rawat inap (rencana fase 2 potongan 7). Pola sama dengan rawat jalan 5a: satu
 * transaksi permintaan, `Idempotency-Key` wajib, penjaminan/persetujuan/penanggung jawab/relasi DPJP lewat bagian
 * bersama `RegistrationService`, event `encounter.registered`.
 * - IGD (`EMER`, `arrived`): pasien MPI atau pasien TANPA IDENTITAS yang dibuat saat itu juga sebagai rekam medis
 *   `unidentified` bernama sementara ("Tn. X"); kelak diperbarui identitasnya / digabung di MPI. Persetujuan umum
 *   tidak menghalangi gawat darurat. SEP IGD belum diterbitkan otomatis (kode poli BPJS IGD belum ditetapkan).
 * - Admisi (`IMP`, `planned`): unit rawat inap + DPJP + rencana masuk, dari kunjungan RJ/IGD asal dan/atau SPRI;
 *   persetujuan umum per admisi; SEP rawat inap terbit saat pasien benar-benar masuk (ADT fase 3).
 * Satu kunjungan IGD aktif dan satu admisi aktif per pasien (dicek di sini, dijamin indeks unik database).
 */
@Injectable()
export class AdmissionService {
  constructor(
    @Inject(API_ENV) private readonly env: ApiEnv,
    private readonly db: TenantDb,
    private readonly repo: RegistrationRepository,
    private readonly idempotency: IdempotencyService,
    private readonly registration: RegistrationService,
    private readonly contacts: ContactsService,
    private readonly access: PatientAccessService,
    private readonly events: DomainEvents,
  ) {}

  private crypto(): PatientCrypto {
    return new PatientCrypto(this.env.fieldKeys, this.db.tenantId());
  }

  // ------------------------------------------------------------------------------------------------------------
  // IGD
  // ------------------------------------------------------------------------------------------------------------

  async registerEmergency(input: EmergencyRegistrationInput, key: unknown): Promise<RegistrationResult> {
    const claim = await this.idempotency.claim(EMERGENCY_SCOPE, key, input);
    if (claim.existingResourceId) return this.registration.result(claim.existingResourceId, { replay: true });
    const id = await this.createEmergency(input, claim);
    return this.registration.result(id, { replay: false });
  }

  private async createEmergency(input: EmergencyRegistrationInput, claim: IdempotencyClaim): Promise<string> {
    const unit = await this.repo.findUnit(input.unitId);
    if (!unit || !unit.active || unit.kind !== 'igd') throw invalid('Unit tujuan bukan IGD yang aktif');

    let patientId: string;
    let identificationNote: string | null = null;
    if (input.patient.kind === 'known') {
      patientId = (await this.activePatient(input.patient.patientId)).id;
      if (await this.repo.activeEncounterOfClass(patientId, 'EMER')) {
        throw frontOfficeError(
          'ENCOUNTER_DUPLICATE',
          undefined,
          'Pasien masih punya kunjungan IGD yang aktif',
        );
      }
    } else {
      // Pasien tanpa identitas: rekam medis baru `unidentified`, tanpa identifier; tanggal lahir perkiraan bila
      // umur diperkirakan. Deteksi duplikat dijalankan MPI saat identitasnya diisi.
      const { sex, estimatedAgeYears, description } = input.patient;
      const year = Number(isoDateJakarta(new Date()).slice(0, 4));
      const created = await insertPatient(this.db.tx(), this.crypto(), {
        name: unidentifiedPatientName(sex),
        sex,
        birthDate: estimatedAgeYears === undefined ? undefined : `${year - estimatedAgeYears}-01-01`,
        birthDateEstimated: estimatedAgeYears !== undefined,
        unidentified: true,
        createdBy: this.db.actorUserId(),
      });
      patientId = created.id;
      identificationNote = description;
      this.db.audit({
        action: 'create',
        resourceType: 'patient',
        resourceId: patientId,
        patientId,
        details: { unidentified: true, source: 'igd' },
      });
    }

    const patient = await this.activePatient(patientId);
    const bpjsIdentifier = input.coverage
      ? this.registration.bpjsIdentifierFor(patient, input.coverage)
      : null;

    const number = await allocateNumber(this.db.tx(), this.db.tenantId(), 'encounter_igd');
    const encounterId = newId();
    await this.repo.createEncounter({
      id: encounterId,
      number: number.number,
      patientId,
      encounterClass: 'EMER',
      status: 'arrived',
      unitId: unit.id,
      arrivedAt: new Date(),
      arrivalMode: input.arrivalMode,
      identificationNote,
    });
    await this.repo.addStatusHistory(encounterId, null, 'arrived');
    if (input.guarantor) await this.contacts.resolveGuarantor(patientId, input.guarantor);
    if (input.coverage) {
      await this.registration.createCoverage(encounterId, input.coverage, bpjsIdentifier?.id ?? null);
    }
    await this.events.publish('encounter.registered', {
      encounterId,
      patientId,
      encounterClass: encounterClassToken('EMER'),
      unitId: unit.id,
      appointmentId: null,
      payer: input.coverage?.payer ?? null,
    });
    await this.idempotency.record(claim, 'encounter', encounterId);
    return encounterId;
  }

  // ------------------------------------------------------------------------------------------------------------
  // Admisi rawat inap
  // ------------------------------------------------------------------------------------------------------------

  async admit(input: AdmissionInput, key: unknown): Promise<RegistrationResult> {
    const claim = await this.idempotency.claim(ADMISSION_SCOPE, key, input);
    if (claim.existingResourceId) return this.registration.result(claim.existingResourceId, { replay: true });
    const id = await this.createAdmission(input, claim);
    return this.registration.result(id, { replay: false });
  }

  private async createAdmission(input: AdmissionInput, claim: IdempotencyClaim): Promise<string> {
    const patient = await this.activePatient(input.patientId);
    const unit = await this.repo.findUnit(input.unitId);
    if (!unit || !unit.active || unit.kind !== 'rawat_inap') {
      throw invalid('Unit tujuan bukan unit rawat inap yang aktif');
    }
    const dpjp = await this.repo.findPractitioner(input.practitionerId);
    if (!dpjp || !dpjp.active || dpjp.profession !== 'dokter')
      throw invalid('DPJP tidak ditemukan atau nonaktif');
    if (new Date(input.plannedAt).getTime() < Date.now() - 24 * 3_600_000) {
      throw invalid('Rencana masuk tidak boleh lebih dari sehari yang lalu');
    }

    if (input.sourceEncounterId) {
      const source = await this.repo.findEncounter(input.sourceEncounterId);
      if (!source || source.patientId !== patient.id)
        throw invalid('Kunjungan asal tidak ditemukan untuk pasien ini');
      if (source.encounterClass === 'IMP' || source.status === 'cancelled') {
        throw frontOfficeError(
          'ENCOUNTER_STATE_INVALID',
          undefined,
          'Kunjungan asal harus rawat jalan/IGD yang tidak batal',
        );
      }
    }
    if (input.spriReferralId) {
      const spri = await this.repo.findReferralById(input.spriReferralId);
      if (!spri || spri.kind !== 'spri' || spri.patientId !== patient.id) {
        throw invalid('SPRI tidak ditemukan untuk pasien ini');
      }
      if (spri.status !== 'active' || !spri.number) {
        throw frontOfficeError(
          'REFERRAL_STATE_INVALID',
          undefined,
          spri.status === 'pending' ? 'SPRI belum bernomor dari BPJS' : `SPRI berstatus ${spri.status}`,
        );
      }
      if (await this.repo.admissionForReferral(spri.id)) {
        throw frontOfficeError('REFERRAL_STATE_INVALID', undefined, 'SPRI ini sudah dipakai admisi lain');
      }
    }
    if (await this.repo.activeEncounterOfClass(patient.id, 'IMP')) {
      throw frontOfficeError(
        'ENCOUNTER_DUPLICATE',
        undefined,
        'Pasien masih punya admisi rawat inap yang aktif',
      );
    }
    const bpjsIdentifier = this.registration.bpjsIdentifierFor(patient, input.coverage);

    const number = await allocateNumber(this.db.tx(), this.db.tenantId(), 'encounter_ri');
    const encounterId = newId();
    await this.repo.createEncounter({
      id: encounterId,
      number: number.number,
      patientId: patient.id,
      encounterClass: 'IMP',
      status: 'planned',
      unitId: unit.id,
      practitionerId: dpjp.id,
      plannedAt: new Date(input.plannedAt),
      sourceEncounterId: input.sourceEncounterId ?? null,
      referralId: input.spriReferralId ?? null,
    });
    await this.repo.addStatusHistory(encounterId, null, 'planned');
    // Persetujuan umum rawat inap berlaku per admisi (keputusan fase 2 #9).
    await this.registration.createConsent(patient.id, input.generalConsent, encounterId);
    if (input.guarantor) await this.contacts.resolveGuarantor(patient.id, input.guarantor);
    await this.registration.createCoverage(
      encounterId,
      input.coverage,
      bpjsIdentifier?.id ?? null,
      input.careClass,
    );
    await this.registration.grantDpjpAccess(
      dpjp.id,
      patient.id,
      encounterId,
      isoDateJakarta(input.plannedAt),
    );
    await this.events.publish('encounter.registered', {
      encounterId,
      patientId: patient.id,
      encounterClass: encounterClassToken('IMP'),
      unitId: unit.id,
      appointmentId: null,
      payer: input.coverage.payer,
    });
    await this.idempotency.record(claim, 'encounter', encounterId);
    return encounterId;
  }

  // ------------------------------------------------------------------------------------------------------------
  // Daftar dan pembatalan
  // ------------------------------------------------------------------------------------------------------------

  /**
   * Daftar kunjungan dengan ABAC (ADR-0031): lingkup `unit` dipaksa ke unit penugasan (unit lain di filter → 403
   * diaudit) dan hanya kunjungan AKTIF (selesai/batal menutup akses, sama dengan `patientAccessSql`), lingkup
   * `relationship` hanya pasien berelasi/akses darurat. Setiap pasien yang tampil diaudit `read`.
   */
  async list(q: EncounterListQuery): Promise<EncounterList> {
    const scope = this.db.permissionScope();
    let unitId = q.unitId;
    let access = null;
    if (scope !== 'all') {
      const actor = this.access.scopedActor();
      if (!actor) throw new AppError('UNAUTHENTICATED', 'Belum login', 401);
      if (scope === 'unit') {
        const own = this.db.actor().unitId;
        if (!own || (unitId && unitId !== own)) {
          throw new AuditedDenial('Daftar kunjungan hanya untuk unit penugasan Anda', {
            resourceType: 'encounter',
            details: { scope, unitId: unitId ?? null },
          });
        }
        unitId = own;
      } else {
        access = patientAccessSql(actor, new Date());
      }
    }
    const ids = await this.repo.listEncounterIds({
      cursor: q.cursor,
      limit: q.limit + 1,
      date: q.date,
      encounterClass: q.class,
      status: q.status,
      unitId,
      patientId: q.patientId,
      activeOnly: scope === 'unit',
      access,
    });
    const page = ids.slice(0, q.limit);
    const rows = await this.repo.encountersByIds(page);
    for (const patientId of new Set(rows.map((r) => r.patientId))) {
      this.db.audit({ action: 'read', resourceType: 'encounter', patientId, details: { list: true } });
    }
    return {
      items: rows.map((r) => ({
        encounter: toEncounter(r),
        patient: {
          id: r.patient.id,
          mrn: r.patient.mrn,
          name: r.patient.name,
          unidentified: r.patient.unidentified,
        },
      })),
      nextCursor: ids.length > q.limit ? (page[page.length - 1] ?? null) : null,
    };
  }

  /**
   * Batal kunjungan IGD (`arrived`, salah daftar) atau admisi yang masih `planned`. Rawat jalan dibatalkan lewat
   * booking (task 99), bukan di sini. Riwayat status + event `encounter.cancelled`; diaudit `update` beralasan.
   */
  async cancel(id: string, input: CancelEncounterInput): Promise<RegistrationResult> {
    if (!(await this.repo.lockEncounter(id)))
      throw new AppError('NOT_FOUND', 'Kunjungan tidak ditemukan', 404);
    const row = await this.repo.findEncounter(id);
    if (!row) throw new AppError('NOT_FOUND', 'Kunjungan tidak ditemukan', 404);
    if (this.db.permissionScope() !== 'all') await this.access.assert(row.patientId);
    const allowed =
      (row.encounterClass === 'EMER' && row.status === 'arrived') ||
      (row.encounterClass === 'IMP' && row.status === 'planned');
    if (!allowed) {
      throw frontOfficeError(
        'ENCOUNTER_STATE_INVALID',
        undefined,
        row.encounterClass === 'AMB'
          ? 'Kunjungan rawat jalan dibatalkan lewat booking'
          : `Kunjungan berstatus ${row.status} tidak bisa dibatalkan`,
      );
    }
    const updated = await this.repo.cancelEncounter(id, input.reason);
    await this.repo.addStatusHistory(id, row.status, 'cancelled', input.reason);
    await this.events.publish('encounter.cancelled', {
      encounterId: id,
      patientId: row.patientId,
      appointmentId: row.appointmentId,
    });
    this.db.audit({
      action: 'update',
      resourceType: 'encounter',
      resourceId: id,
      patientId: row.patientId,
      reason: input.reason,
      details: { status: 'cancelled', class: row.encounterClass },
    });
    return this.registration.present(updated);
  }

  private async activePatient(id: string) {
    const patient = await this.repo.findPatient(id);
    if (!patient) throw new AppError('NOT_FOUND', 'Pasien tidak ditemukan', 404);
    if (patient.status !== 'active') {
      throw new AppError('CONFLICT', 'Rekam medis ini sudah digabung; pakai rekam medis tujuan', 409, {
        mergedInto: patient.mergedIntoId,
      });
    }
    return patient;
  }
}
