import { Injectable } from '@nestjs/common';
import { Prisma } from '@simrs/db';
import { type IdentifierSystem, newId } from '@simrs/shared';
import { TenantDb } from '../../infra/tenant-db';

export const PATIENT_SELECT = {
  id: true,
  mrn: true,
  name: true,
  sex: true,
  birthDate: true,
  birthDateEstimated: true,
  motherName: true,
  addressEnc: true,
  phoneEnc: true,
  unidentified: true,
  status: true,
  mergedAt: true,
  createdAt: true,
  updatedAt: true,
  mergedInto: { select: { id: true, mrn: true } },
  identifiers: {
    where: { active: true },
    orderBy: { system: 'asc' },
    select: {
      id: true,
      system: true,
      valueEnc: true,
      valueHash: true,
      verificationStatus: true,
      verifiedAt: true,
    },
  },
} as const;

export type PatientRow = Prisma.PatientGetPayload<{ select: typeof PATIENT_SELECT }>;

export const CONSENT_SELECT = {
  id: true,
  patientId: true,
  kind: true,
  recipient: true,
  note: true,
  givenAt: true,
  givenBy: true,
  revokedAt: true,
  revokedBy: true,
  revokeReason: true,
} as const;
export type ConsentRow = Prisma.PrivacyConsentGetPayload<{ select: typeof CONSENT_SELECT }>;

/**
 * Relasi aktif atau akses darurat yang masih berlaku untuk pelaku (ABAC lingkup `relationship`/`unit`), ke
 * pasien ini atau rekam medis lain milik orang yang sama (kelompok gabungan, `app_patient_group`).
 */
const accessibleBy = (userId: string) => Prisma.sql`(
  EXISTS (SELECT 1 FROM access_relationships r
          WHERE r.patient_id IN (SELECT app_patient_group(p.id)) AND r.user_id = ${userId}::uuid
            AND r.valid_from <= now() AND (r.valid_until IS NULL OR r.valid_until > now()))
  OR EXISTS (SELECT 1 FROM break_glass_grants g
             WHERE g.patient_id IN (SELECT app_patient_group(p.id)) AND g.user_id = ${userId}::uuid
               AND g.granted_at <= now() AND g.expires_at > now()))`;

/** P05 · Akses data MPI (selalu transaksi permintaan, RLS aktif). */
@Injectable()
export class MpiRepository {
  constructor(private readonly db: TenantDb) {}

  findById(id: string): Promise<PatientRow | null> {
    return this.db.tx().patient.findUnique({ where: { id }, select: PATIENT_SELECT });
  }

  /** Baris pasien sesuai urutan `ids` (urutan relevansi pencarian dipertahankan). */
  async listByIds(ids: string[], birthDate?: Date): Promise<PatientRow[]> {
    if (ids.length === 0) return [];
    const rows = await this.db.tx().patient.findMany({
      where: { id: { in: ids }, ...(birthDate ? { birthDate } : {}) },
      select: PATIENT_SELECT,
    });
    const byId = new Map(rows.map((r) => [r.id, r]));
    return ids.flatMap((id) => byId.get(id) ?? []);
  }

  async idsByMrn(mrn: string): Promise<string[]> {
    const p = await this.db.tx().patient.findUnique({
      where: { tenantId_mrn: { tenantId: this.db.tenantId(), mrn } },
      select: { id: true },
    });
    return p ? [p.id] : [];
  }

  async idsByIdentifier(system: IdentifierSystem, valueHash: string, limit: number): Promise<string[]> {
    const rows = await this.db.tx().patientIdentifier.findMany({
      where: { system, valueHash, active: true },
      select: { patientId: true },
      orderBy: { createdAt: 'asc' },
      take: limit,
    });
    return [...new Set(rows.map((r) => r.patientId))];
  }

  /**
   * Rekam medis lain yang memegang nilai identifier ini (cek NIK/BPJS ganda saat daftar atau ganti identifier).
   * Rekam medis yang sudah digabung diarahkan ke rekam medis yang dipertahankan.
   */
  async findIdentifierOwner(
    system: IdentifierSystem,
    valueHash: string,
    exceptPatientId?: string,
  ): Promise<{ id: string; mrn: string } | null> {
    const row = await this.db.tx().patientIdentifier.findFirst({
      where: {
        system,
        valueHash,
        active: true,
        ...(exceptPatientId ? { patientId: { not: exceptPatientId } } : {}),
      },
      orderBy: { patient: { status: 'asc' } },
      select: {
        patient: {
          select: { id: true, mrn: true, status: true, mergedInto: { select: { id: true, mrn: true } } },
        },
      },
    });
    if (!row) return null;
    const owner =
      row.patient.status === 'merged' && row.patient.mergedInto ? row.patient.mergedInto : row.patient;
    return owner.id === exceptPatientId ? null : { id: owner.id, mrn: owner.mrn };
  }

  /**
   * Nama mirip (pg_trgm): kemiripan keseluruhan (`%`), kemiripan kata (`<%`, mis. sebagian nama), atau memuat
   * teks. `onlyFor` = ID pengguna bila lingkupnya bukan seluruh pasien (filter di SQL, sebelum LIMIT).
   */
  async idsByName(
    q: string,
    opts: { birthDate?: Date; limit: number; onlyFor: string | null },
  ): Promise<string[]> {
    const like = `%${q}%`;
    const rows = await this.db.tx().$queryRaw<Array<{ id: string }>>`
      SELECT p.id::text AS id
      FROM patients p
      WHERE (p.name_search % ${q} OR ${q} <% p.name_search OR p.name_search LIKE ${like})
        ${opts.birthDate ? Prisma.sql`AND p.birth_date = ${opts.birthDate}::date` : Prisma.empty}
        ${opts.onlyFor ? Prisma.sql`AND ${accessibleBy(opts.onlyFor)}` : Prisma.empty}
      ORDER BY greatest(similarity(p.name_search, ${q}), word_similarity(${q}, p.name_search)) DESC, p.mrn
      LIMIT ${opts.limit}`;
    return rows.map((r) => r.id);
  }

  /** Saring ID yang boleh dilihat pelaku berlingkup relasi (hasil cari RM/identifier). */
  async accessibleAmong(ids: string[], userId: string): Promise<string[]> {
    if (ids.length === 0) return [];
    const rows = await this.db.tx().$queryRaw<Array<{ id: string }>>`
      SELECT p.id::text AS id FROM patients p
      WHERE p.id = ANY(${ids}::uuid[]) AND ${accessibleBy(userId)}`;
    const ok = new Set(rows.map((r) => r.id));
    return ids.filter((id) => ok.has(id));
  }

  update(id: string, data: Prisma.PatientUpdateInput) {
    return this.db.tx().patient.update({
      where: { id },
      data: { ...data, updatedBy: this.db.actorUserId() },
      select: PATIENT_SELECT,
    });
  }

  deactivateIdentifier(id: string, reason: string) {
    return this.db.tx().patientIdentifier.update({
      where: { id },
      data: {
        active: false,
        deactivatedAt: new Date(),
        deactivatedBy: this.db.actorUserId(),
        deactivationReason: reason,
      },
      select: { id: true },
    });
  }

  /** NIK aktif pasien beserta status verifikasinya. */
  activeNik(patientId: string) {
    return this.db.tx().patientIdentifier.findFirst({
      where: { patientId, system: 'nik', active: true },
      select: { id: true, verificationStatus: true, verificationDetails: true },
    });
  }

  /**
   * Tandai NIK menunggu hasil Dukcapil dan kembalikan nomor permintaannya (dasar idempotency key outbox yang
   * deterministik: permintaan ke-n untuk identifier yang sama selalu satu pesan).
   */
  async markVerificationRequested(identifierId: string, at: Date): Promise<number> {
    const tx = this.db.tx();
    const current = await tx.patientIdentifier.findUniqueOrThrow({
      where: { id: identifierId },
      select: { verificationDetails: true },
    });
    const previous = (current.verificationDetails ?? {}) as Prisma.JsonObject;
    const requests = (typeof previous.requests === 'number' ? previous.requests : 0) + 1;
    await tx.patientIdentifier.update({
      where: { id: identifierId },
      data: {
        verificationStatus: 'pending',
        verificationDetails: { ...previous, requests, requestedAt: at.toISOString() },
      },
    });
    return requests;
  }

  // ---------- persetujuan privasi ----------
  listConsents(patientId: string) {
    return this.db.tx().privacyConsent.findMany({
      where: { patientId },
      orderBy: { givenAt: 'desc' },
      select: CONSENT_SELECT,
    });
  }

  findActiveConsent(patientId: string, kind: string, recipient: string | null) {
    return this.db.tx().privacyConsent.findFirst({
      where: {
        patientId,
        kind,
        revokedAt: null,
        recipient: recipient === null ? null : { equals: recipient, mode: 'insensitive' },
      },
      select: { id: true },
    });
  }

  createConsent(data: { patientId: string; kind: string; recipient: string | null; note: string | null }) {
    return this.db.tx().privacyConsent.create({
      data: { id: newId(), tenantId: this.db.tenantId(), ...data, givenBy: this.db.actorUserId() },
      select: CONSENT_SELECT,
    });
  }

  findConsent(id: string) {
    return this.db.tx().privacyConsent.findUnique({ where: { id }, select: CONSENT_SELECT });
  }

  revokeConsent(id: string, reason: string) {
    return this.db.tx().privacyConsent.update({
      where: { id },
      data: { revokedAt: new Date(), revokedBy: this.db.actorUserId(), revokeReason: reason },
      select: CONSENT_SELECT,
    });
  }

  async userNames(ids: Array<string | null>): Promise<Map<string, string>> {
    const wanted = [...new Set(ids.filter((x): x is string => Boolean(x)))];
    if (wanted.length === 0) return new Map();
    const users = await this.db.tx().user.findMany({
      where: { id: { in: wanted } },
      select: { id: true, displayName: true },
    });
    return new Map(users.map((u) => [u.id, u.displayName]));
  }

  insertIdentifier(
    patientId: string,
    system: IdentifierSystem,
    enc: { valueEnc: string; valueHash: string },
  ) {
    return this.db.tx().patientIdentifier.create({
      data: {
        id: newId(),
        tenantId: this.db.tenantId(),
        patientId,
        system,
        ...enc,
        createdBy: this.db.actorUserId(),
      },
      select: { id: true },
    });
  }
}
