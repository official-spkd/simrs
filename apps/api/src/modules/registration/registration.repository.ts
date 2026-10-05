import { Injectable } from '@nestjs/common';
import { Prisma } from '@simrs/db';
import { ACTIVE_ENCOUNTER_STATUSES, newId } from '@simrs/shared';
import { TenantDb } from '../../infra/tenant-db';

export const ENCOUNTER_SELECT = {
  id: true,
  number: true,
  encounterClass: true,
  status: true,
  patientId: true,
  unitId: true,
  serviceId: true,
  practitionerId: true,
  appointmentId: true,
  queueTicketId: true,
  arrivedAt: true,
  startedAt: true,
  endedAt: true,
  cancelReason: true,
  arrivalMode: true,
  plannedAt: true,
  sourceEncounterId: true,
  referralId: true,
  identificationNote: true,
  createdAt: true,
  service: { select: { code: true } },
  appointment: { select: { id: true, bookingCode: true } },
} satisfies Prisma.EncounterSelect;
export type EncounterRow = Prisma.EncounterGetPayload<{ select: typeof ENCOUNTER_SELECT }>;

export const COVERAGE_SELECT = {
  id: true,
  encounterId: true,
  payerId: true,
  priority: true,
  classEntitlement: true,
  careClass: true,
  status: true,
  lockedAt: true,
  memberNoEnc: true,
  payer: { select: { kind: true, name: true } },
  patientIdentifier: { select: { system: true, valueEnc: true } },
} satisfies Prisma.CoverageSelect;
export type CoverageRow = Prisma.CoverageGetPayload<{ select: typeof COVERAGE_SELECT }>;

/** F03 · Akses data registrasi (kunjungan, penjaminan, persetujuan umum, kontak, relasi DPJP). */
@Injectable()
export class RegistrationRepository {
  constructor(private readonly db: TenantDb) {}

  private base() {
    return { tenantId: this.db.tenantId(), createdBy: this.db.actorUserId() };
  }

  findPatient(id: string) {
    return this.db.tx().patient.findUnique({
      where: { id },
      select: {
        id: true,
        status: true,
        mergedIntoId: true,
        identifiers: { where: { active: true }, select: { id: true, system: true } },
      },
    });
  }

  findSession(id: string) {
    return this.db.tx().scheduleSession.findUnique({
      where: { id },
      select: {
        id: true,
        kind: true,
        sessionDate: true,
        serviceId: true,
        practitionerId: true,
        substituteId: true,
        service: { select: { id: true, kind: true, active: true, unitId: true } },
      },
    });
  }

  findAppointment(id: string) {
    return this.db.tx().appointment.findUnique({
      where: { id },
      select: {
        id: true,
        patientId: true,
        sessionId: true,
        serviceId: true,
        practitionerId: true,
        appointmentDate: true,
        status: true,
        quotaBucket: true,
      },
    });
  }

  /** Booking aktif pasien di layanan + tanggal ini (maks. satu: indeks unik `appointments_one_active_per_day`). */
  activeAppointment(patientId: string, serviceId: string, date: Date) {
    return this.db.tx().appointment.findFirst({
      where: { patientId, serviceId, appointmentDate: date, status: { in: ['booked', 'checked_in'] } },
      select: { id: true },
    });
  }

  activeEncounterForAppointment(appointmentId: string) {
    return this.db.tx().encounter.findFirst({
      where: { appointmentId, status: { not: 'cancelled' } },
      select: { id: true },
    });
  }

  /** Nomor poli yang dicadangkan saat booking. */
  reservedPoliTicket(appointmentId: string, serviceId: string) {
    return this.db.tx().queueTicket.findFirst({
      where: { appointmentId, serviceId, status: { not: 'cancelled' } },
      orderBy: { seq: 'asc' },
      select: { id: true, reserved: true },
    });
  }

  /** Pasien sudah terdaftar: nomor poli ikut panggilan berurutan ("panggil berikutnya"). */
  releaseTicketReservation(ticketId: string) {
    return this.db.tx().queueTicket.update({
      where: { id: ticketId },
      data: { reserved: false, updatedBy: this.db.actorUserId() },
      select: { id: true },
    });
  }

  payerByKind(kind: string) {
    return this.db.tx().payer.findFirst({
      where: { kind, active: true },
      orderBy: { code: 'asc' },
      select: { id: true, kind: true },
    });
  }

  payerById(id: string) {
    return this.db.tx().payer.findUnique({ where: { id }, select: { id: true, kind: true, active: true } });
  }

  /** Persetujuan umum rawat jalan yang masih berlaku (tanpa kunjungan = sampai dicabut, keputusan fase 2 #9). */
  activeOutpatientConsent(patientId: string) {
    return this.db.tx().privacyConsent.findFirst({
      where: { patientId, kind: 'umum', recipient: null, encounterId: null, revokedAt: null },
      select: { id: true },
    });
  }

  createConsent(data: {
    patientId: string;
    encounterId: string | null;
    note: string | null;
    evidenceDocumentId: string | null;
  }) {
    return this.db.tx().privacyConsent.create({
      data: {
        id: newId(),
        tenantId: this.db.tenantId(),
        patientId: data.patientId,
        encounterId: data.encounterId,
        kind: 'umum',
        note: data.note,
        evidenceDocumentId: data.evidenceDocumentId,
        givenBy: this.db.actorUserId(),
      },
      select: { id: true },
    });
  }

  documentPatient(id: string) {
    return this.db.tx().document.findUnique({ where: { id }, select: { patientId: true } });
  }

  bpjsPoliCode(serviceId: string) {
    return this.db.tx().externalId.findFirst({
      where: { entity: 'queue_service', entityId: serviceId, system: 'bpjs:poli', active: true },
      select: { value: true },
    });
  }

  practitionerUser(id: string) {
    return this.db.tx().practitioner.findUnique({ where: { id }, select: { userId: true } });
  }

  findReferral(kind: string, number: string) {
    return this.db.tx().referral.findUnique({
      where: { tenantId_kind_number: { tenantId: this.db.tenantId(), kind, number } },
      select: { id: true, patientId: true, status: true, validUntil: true },
    });
  }

  createReferral(data: Omit<Prisma.ReferralUncheckedCreateInput, 'id' | 'tenantId' | 'createdBy'>) {
    return this.db.tx().referral.create({
      data: { ...data, id: newId(), ...this.base() },
      select: { id: true },
    });
  }

  createEncounter(data: Omit<Prisma.EncounterUncheckedCreateInput, 'tenantId' | 'createdBy'>) {
    return this.db.tx().encounter.create({ data: { ...data, ...this.base() }, select: { id: true } });
  }

  addStatusHistory(
    encounterId: string,
    fromStatus: string | null,
    toStatus: string,
    reason: string | null = null,
  ) {
    return this.db.tx().encounterStatusHistory.create({
      data: {
        id: newId(),
        tenantId: this.db.tenantId(),
        encounterId,
        fromStatus,
        toStatus,
        reason,
        changedBy: this.db.actorUserId(),
      },
    });
  }

  createCoverage(data: Omit<Prisma.CoverageUncheckedCreateInput, 'tenantId' | 'createdBy'>) {
    return this.db.tx().coverage.create({ data: { ...data, ...this.base() }, select: { id: true } });
  }

  /** Relasi akses dokter ke pasien selama kunjungan (sumber = kunjungan); ABAC `PatientAccessService`. */
  createAccessRelationship(data: {
    userId: string;
    patientId: string;
    validUntil: Date | null;
    encounterId: string;
    kind: 'dpjp' | 'konsultan';
  }) {
    return this.db.tx().accessRelationship.create({
      data: {
        id: newId(),
        tenantId: this.db.tenantId(),
        userId: data.userId,
        patientId: data.patientId,
        kind: data.kind,
        validUntil: data.validUntil,
        sourceType: 'encounter',
        sourceId: data.encounterId,
      },
    });
  }

  findEncounter(id: string) {
    return this.db.tx().encounter.findUnique({ where: { id }, select: ENCOUNTER_SELECT });
  }

  /** Data tampilan lembar cetak loket: RS, pasien (nama + RM), poli, DPJP, dan rujukan dasar SEP. */
  async printDetails(encounterId: string, referralId: string | null) {
    const encounter = await this.db.tx().encounter.findUnique({
      where: { id: encounterId },
      select: {
        patient: { select: { name: true, mrn: true } },
        service: { select: { name: true, room: true } },
        unit: { select: { name: true } },
        practitioner: { select: { name: true } },
      },
    });
    const tenant = await this.db
      .tx()
      .tenant.findUnique({ where: { id: this.db.tenantId() }, select: { name: true } });
    const referral = referralId
      ? await this.db.tx().referral.findUnique({
          where: { id: referralId },
          select: { number: true, facilityName: true, kind: true },
        })
      : null;
    return { encounter, tenant, referral };
  }

  primaryCoverage(encounterId: string) {
    return this.db.tx().coverage.findFirst({
      where: { encounterId, status: 'active' },
      orderBy: { priority: 'asc' },
      select: COVERAGE_SELECT,
    });
  }

  // ---------- kontak / penanggung jawab ----------

  activeContacts(patientId: string) {
    return this.db.tx().patientContact.findMany({
      where: { patientId, status: 'active', supersededBy: { none: {} } },
      orderBy: { createdAt: 'asc' },
      select: { id: true, relation: true, nameEnc: true, phoneEnc: true, isGuarantor: true, status: true },
    });
  }

  findContact(id: string) {
    return this.db.tx().patientContact.findUnique({
      where: { id },
      select: { id: true, patientId: true, status: true, _count: { select: { supersededBy: true } } },
    });
  }

  createContact(data: {
    patientId: string;
    relation: string;
    nameEnc: string;
    phoneEnc: string | null;
    addressEnc: string | null;
    isGuarantor: boolean;
  }) {
    return this.db.tx().patientContact.create({
      data: { id: newId(), ...this.base(), ...data },
      select: { id: true, relation: true, nameEnc: true, phoneEnc: true, isGuarantor: true, status: true },
    });
  }

  // ---------- IGD, admisi, daftar kunjungan (potongan 7) ----------

  findUnit(id: string) {
    return this.db.tx().unit.findUnique({
      where: { id },
      select: { id: true, kind: true, active: true, name: true },
    });
  }

  findPractitioner(id: string) {
    return this.db.tx().practitioner.findUnique({
      where: { id },
      select: { id: true, active: true, profession: true, userId: true },
    });
  }

  /** Kunjungan aktif pasien berkelas ini (satu per pasien untuk IGD dan admisi, indeks unik database). */
  activeEncounterOfClass(patientId: string, encounterClass: 'EMER' | 'IMP') {
    return this.db.tx().encounter.findFirst({
      where: { patientId, encounterClass, status: { in: [...ACTIVE_ENCOUNTER_STATUSES] } },
      select: { id: true, number: true },
    });
  }

  findReferralById(id: string) {
    return this.db.tx().referral.findUnique({
      where: { id },
      select: { id: true, kind: true, patientId: true, status: true, number: true },
    });
  }

  admissionForReferral(referralId: string) {
    return this.db.tx().encounter.findFirst({
      where: { referralId, status: { not: 'cancelled' } },
      select: { id: true },
    });
  }

  /** Kunci baris kunjungan (pembatalan vs perubahan lain). */
  async lockEncounter(id: string): Promise<boolean> {
    const rows = await this.db.tx().$queryRaw<Array<{ id: string }>>`
      SELECT id FROM encounters WHERE id = ${id}::uuid FOR UPDATE`;
    return rows.length > 0;
  }

  cancelEncounter(id: string, reason: string) {
    return this.db.tx().encounter.update({
      where: { id },
      data: { status: 'cancelled', cancelReason: reason, updatedBy: this.db.actorUserId() },
      select: ENCOUNTER_SELECT,
    });
  }

  /**
   * ID kunjungan untuk daftar (urut UUID v7 = waktu dibuat, kursor `id > cursor`), sudah tersaring ABAC: `unitId`
   * paksa untuk lingkup unit, `access` = predikat `patientAccessSql` untuk lingkup relasi. Tanggal = hari WIB dari
   * waktu tiba, rencana masuk, atau dibuat.
   */
  async listEncounterIds(f: {
    cursor?: string;
    limit: number;
    date?: string;
    encounterClass?: string;
    status?: string;
    unitId?: string;
    patientId?: string;
    access: Prisma.Sql | null;
  }): Promise<string[]> {
    const rows = await this.db.tx().$queryRaw<Array<{ id: string }>>`
      SELECT e.id::text AS id
      FROM encounters e JOIN patients p ON p.id = e.patient_id
      WHERE TRUE
        ${f.cursor ? Prisma.sql`AND e.id > ${f.cursor}::uuid` : Prisma.empty}
        ${f.encounterClass ? Prisma.sql`AND e.class = ${f.encounterClass}` : Prisma.empty}
        ${f.status ? Prisma.sql`AND e.status = ${f.status}` : Prisma.empty}
        ${f.unitId ? Prisma.sql`AND e.unit_id = ${f.unitId}::uuid` : Prisma.empty}
        ${f.patientId ? Prisma.sql`AND e.patient_id = ${f.patientId}::uuid` : Prisma.empty}
        ${
          f.date
            ? Prisma.sql`AND (COALESCE(e.arrived_at, e.planned_at, e.created_at) AT TIME ZONE 'Asia/Jakarta')::date = ${f.date}::date`
            : Prisma.empty
        }
        ${f.access ? Prisma.sql`AND ${f.access}` : Prisma.empty}
      ORDER BY e.id
      LIMIT ${f.limit}`;
    return rows.map((r) => r.id);
  }

  encountersByIds(ids: string[]) {
    return this.db.tx().encounter.findMany({
      where: { id: { in: ids } },
      orderBy: { id: 'asc' },
      select: {
        ...ENCOUNTER_SELECT,
        patient: { select: { id: true, mrn: true, name: true, unidentified: true } },
      },
    });
  }

  // ---------- meja pendaftaran ----------

  counterService() {
    return this.db.tx().queueService.findFirst({
      where: { kind: 'loket', active: true },
      orderBy: { code: 'asc' },
      select: { id: true, name: true },
    });
  }
}
