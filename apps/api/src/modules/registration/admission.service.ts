import { EmergencySepService } from '../encounter/emergency-sep.service';
import { Inject, Injectable } from '@nestjs/common';
import { allocateNumber, insertPatient } from '@simrs/db';
import {
  type AdmissionInput,
  AppError,
  type CancelEncounterInput,
  COVERAGE_CARE_CLASSES,
  type CoverageCareClass,
  type EmergencyAdmissionInput,
  type EmergencyAdmissionResult,
  type EmergencyRegistrationInput,
  type EncounterList,
  type PractitionerOption,
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
import { AdtService } from '../adt/adt.service';
import { PatientAccessService, patientAccessSql } from '../authz/patient-access.service';
import { ContactsService } from './contacts.service';
import { RegistrationRepository } from './registration.repository';
import { RegistrationService, toEncounter } from './registration.service';

export const EMERGENCY_SCOPE = 'registration.emergency';
export const ADMISSION_SCOPE = 'registration.admission';
export const EMERGENCY_ADMISSION_SCOPE = 'registration.emergency_admission';

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
    private readonly emergencySep: EmergencySepService,
    private readonly adt: AdtService,
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
    await this.assertWriteScope(
      input.unitId,
      input.patient.kind === 'known' ? input.patient.patientId : null,
    );
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
      // Fase 3 (utang fase 2): SEP IGD otomatis bila diagnosa awal sudah ada; selain itu menyusul.
      if (input.coverage.payer === 'bpjs' && input.coverage.initialDiagnosis) {
        await this.emergencySep.create(encounterId, input.coverage.initialDiagnosis, null);
      }
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

  /**
   * `encounter.write` berlingkup selain `all` (ADR-0031): kunjungan aktif di sebuah unit membuka akses unit ke
   * pasiennya, jadi pendaftar berlingkup unit/relasi hanya boleh mendaftarkan ke unit penugasannya sendiri, dan pasien
   * yang sudah ada harus sudah bisa ia akses (`PatientAccessService`: relasi, kunjungan aktif di unitnya, atau akses
   * darurat). Pasien tanpa identitas baru boleh. Pelanggaran → 403 tercatat (`AuditedDenial`).
   */
  private async assertWriteScope(unitId: string, patientId: string | null): Promise<void> {
    const scope = this.db.permissionScope();
    if (scope === 'all') return;
    const own = this.db.actor().unitId;
    if (!own || own !== unitId) {
      throw new AuditedDenial('Pendaftaran kunjungan hanya ke unit penugasan Anda', {
        resourceType: 'encounter',
        patientId,
        details: { scope, unitId },
      });
    }
    if (patientId) await this.access.assert(patientId);
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

  // ------------------------------------------------------------------------------------------------------------
  // Admisi dari IGD (W3, keputusan fase 3 no. 7)
  // ------------------------------------------------------------------------------------------------------------

  /**
   * Keputusan rawat inap pasien IGD yang bed-nya sudah dialokasikan (`bed_requests` `dialokasi`): admisi `IMP`
   * ber-`sourceEncounterId` IGD (penjaminan IGD dibawa apa adanya, kelas rawat dari permintaan bed), lalu masuk bed lewat
   * `AdtService.admit` (gelang terbit, DPJP di tim, IGD selesai disposisi rawat inap, SEP rawat inap BPJS). Satu
   * transaksi permintaan; admisi `planned` yang sudah ada untuk IGD ini dipakai ulang. `Idempotency-Key` wajib.
   */
  async admitFromEmergency(input: EmergencyAdmissionInput, key: unknown): Promise<EmergencyAdmissionResult> {
    const claim = await this.idempotency.claim(EMERGENCY_ADMISSION_SCOPE, key, input);
    if (claim.existingResourceId) return this.emergencyAdmissionResult(claim.existingResourceId);
    const tx = this.db.tx();
    const req = await tx.bedRequest.findUnique({ where: { id: input.bedRequestId } });
    if (!req) throw new AppError('NOT_FOUND', 'Permintaan bed tidak ditemukan', 404);
    if (req.status !== 'dialokasi' || !req.allocatedLocationId) {
      throw frontOfficeError(
        'ENCOUNTER_STATE_INVALID',
        undefined,
        req.status === 'menunggu' ? 'Alokasikan bed dulu sebelum admisi' : 'Permintaan bed ini sudah ditutup',
      );
    }
    const source = await this.repo.findEncounter(req.encounterId);
    if (!source || source.encounterClass !== 'EMER') {
      throw invalid('Admisi dari IGD hanya untuk permintaan bed kunjungan IGD');
    }
    if (source.status !== 'arrived' && source.status !== 'in_progress') {
      throw frontOfficeError('ENCOUNTER_STATE_INVALID', undefined, 'Kunjungan IGD sudah tidak aktif');
    }
    const bed = await tx.location.findUniqueOrThrow({
      where: { id: req.allocatedLocationId },
      select: { unitId: true },
    });
    const existing = await tx.encounter.findFirst({
      where: { sourceEncounterId: source.id, encounterClass: 'IMP', status: 'planned' },
      select: { id: true },
    });
    const admissionId =
      existing?.id ?? (await this.createAdmissionFromEmergency(input, source, bed.unitId, req.careClass));
    await this.adt.admit({
      encounterId: admissionId,
      locationId: req.allocatedLocationId,
      initialDiagnosis: input.initialDiagnosis,
    });
    await this.idempotency.record(claim, 'encounter', admissionId);
    return this.emergencyAdmissionResult(admissionId);
  }

  private async createAdmissionFromEmergency(
    input: EmergencyAdmissionInput,
    source: { id: string; patientId: string },
    unitId: string,
    requestedClass: string,
  ): Promise<string> {
    await this.assertWriteScope(unitId, source.patientId);
    const coverages = await this.db.tx().coverage.findMany({
      where: { encounterId: source.id, status: 'active' },
      orderBy: { priority: 'asc' },
      include: { payer: { select: { kind: true } } },
    });
    const primary = coverages[0];
    if (!primary) throw invalid('Kunjungan IGD ini belum berpenjamin; lengkapi penjamin sebelum admisi');
    const careClass = (COVERAGE_CARE_CLASSES as readonly string[]).includes(requestedClass)
      ? (requestedClass as CoverageCareClass)
      : null;
    return this.insertPlannedAdmission(
      {
        patientId: source.patientId,
        unitId,
        practitionerId: input.practitionerId,
        plannedAt: new Date(),
        sourceEncounterId: source.id,
        referralId: null,
        generalConsent: input.generalConsent,
        guarantor: undefined,
        payer: primary.payer.kind as AdmissionInput['coverage']['payer'],
      },
      async (encounterId) => {
        for (const c of coverages) {
          await this.repo.createCoverage({
            id: newId(),
            encounterId,
            payerId: c.payerId,
            patientIdentifierId: c.patientIdentifierId,
            priority: c.priority,
            status: 'active',
            classEntitlement: c.classEntitlement,
            careClass: c.priority === primary.priority ? (careClass ?? c.careClass) : c.careClass,
            memberNoEnc: c.memberNoEnc,
            guaranteeLetterNo: c.guaranteeLetterNo,
          });
        }
      },
    );
  }

  /** Dokter aktif (pilihan DPJP admisi). */
  async doctors(): Promise<{ items: PractitionerOption[] }> {
    const rows = await this.db.tx().practitioner.findMany({
      where: { active: true, profession: 'dokter' },
      orderBy: { name: 'asc' },
      select: { id: true, name: true, specialty: true },
    });
    return { items: rows };
  }

  private async emergencyAdmissionResult(encounterId: string): Promise<EmergencyAdmissionResult> {
    const tx = this.db.tx();
    const enc = await tx.encounter.findUniqueOrThrow({
      where: { id: encounterId },
      select: { id: true, number: true, sourceEncounterId: true },
    });
    const [assignment, band, sep] = await Promise.all([
      tx.bedAssignment.findFirst({
        where: { encounterId },
        orderBy: { startedAt: 'desc' },
        include: { location: { select: { code: true } } },
      }),
      tx.patientWristband.findFirst({ where: { encounterId, voidedAt: null }, select: { code: true } }),
      tx.sep.findFirst({ where: { encounterId }, orderBy: { createdAt: 'desc' }, select: { id: true } }),
    ]);
    if (!assignment || !enc.sourceEncounterId) throw new Error('admisi IGD tanpa bed/kunjungan asal');
    return {
      encounterId: enc.id,
      number: enc.number,
      bedId: assignment.locationId,
      bedCode: assignment.location.code,
      wristbandCode: band?.code ?? '',
      sepId: sep?.id ?? null,
      sourceEncounterId: enc.sourceEncounterId,
    };
  }

  private async createAdmission(input: AdmissionInput, claim: IdempotencyClaim): Promise<string> {
    await this.assertWriteScope(input.unitId, input.patientId);
    const patient = await this.activePatient(input.patientId);
    const checkSpri = async () => {
      if (!input.spriReferralId) return;
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
    };
    const bpjsIdentifier = this.registration.bpjsIdentifierFor(patient, input.coverage);
    const encounterId = await this.insertPlannedAdmission(
      {
        patientId: patient.id,
        unitId: input.unitId,
        practitionerId: input.practitionerId,
        plannedAt: new Date(input.plannedAt),
        sourceEncounterId: input.sourceEncounterId ?? null,
        referralId: input.spriReferralId ?? null,
        generalConsent: input.generalConsent,
        guarantor: input.guarantor,
        payer: input.coverage.payer,
        extraChecks: checkSpri,
      },
      async (id) => {
        await this.registration.createCoverage(
          id,
          input.coverage,
          bpjsIdentifier?.id ?? null,
          input.careClass,
        );
      },
    );
    await this.idempotency.record(claim, 'encounter', encounterId);
    return encounterId;
  }

  /**
   * Admisi `planned` bersama (registrasi admisi + admisi dari IGD; lingkup tulis sudah diperiksa pemanggil): unit rawat inap, DPJP, kunjungan
   * asal, satu admisi aktif per pasien, nomor RI, riwayat status, persetujuan umum per admisi, penanggung jawab,
   * penjaminan (`createCoverages`), relasi DPJP, event `encounter.registered`.
   */
  private async insertPlannedAdmission(
    a: {
      patientId: string;
      unitId: string;
      practitionerId: string;
      plannedAt: Date;
      sourceEncounterId: string | null;
      referralId: string | null;
      generalConsent: AdmissionInput['generalConsent'];
      guarantor: AdmissionInput['guarantor'];
      payer: AdmissionInput['coverage']['payer'];
      /** Pemeriksaan tambahan setelah unit/DPJP/kunjungan asal, sebelum cek admisi aktif (mis. SPRI). */
      extraChecks?: () => Promise<void>;
    },
    createCoverages: (encounterId: string) => Promise<void>,
  ): Promise<string> {
    const patient = await this.activePatient(a.patientId);
    const unit = await this.repo.findUnit(a.unitId);
    if (!unit || !unit.active || unit.kind !== 'rawat_inap') {
      throw invalid('Unit tujuan bukan unit rawat inap yang aktif');
    }
    const dpjp = await this.repo.findPractitioner(a.practitionerId);
    if (!dpjp || !dpjp.active || dpjp.profession !== 'dokter')
      throw invalid('DPJP tidak ditemukan atau nonaktif');
    if (a.plannedAt.getTime() < Date.now() - 24 * 3_600_000) {
      throw invalid('Rencana masuk tidak boleh lebih dari sehari yang lalu');
    }
    if (a.sourceEncounterId) {
      const source = await this.repo.findEncounter(a.sourceEncounterId);
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
    await a.extraChecks?.();
    if (await this.repo.activeEncounterOfClass(patient.id, 'IMP')) {
      throw frontOfficeError(
        'ENCOUNTER_DUPLICATE',
        undefined,
        'Pasien masih punya admisi rawat inap yang aktif',
      );
    }

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
      plannedAt: a.plannedAt,
      sourceEncounterId: a.sourceEncounterId,
      referralId: a.referralId,
    });
    await this.repo.addStatusHistory(encounterId, null, 'planned');
    // Persetujuan umum rawat inap berlaku per admisi (keputusan fase 2 #9).
    await this.registration.createConsent(patient.id, a.generalConsent, encounterId);
    if (a.guarantor) await this.contacts.resolveGuarantor(patient.id, a.guarantor);
    await createCoverages(encounterId);
    await this.registration.grantDpjpAccess(dpjp.id, patient.id, encounterId, isoDateJakarta(a.plannedAt));
    await this.events.publish('encounter.registered', {
      encounterId,
      patientId: patient.id,
      encounterClass: encounterClassToken('IMP'),
      unitId: unit.id,
      appointmentId: null,
      payer: a.payer,
    });
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
    // Fase 3: bed IGD yang sempat ditempati, bed yang dipesan, dan permintaan bed ikut dilepas.
    await this.adt.releaseCancelledEncounter(id, new Date());
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
