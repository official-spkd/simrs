import { Injectable } from '@nestjs/common';
import type { Prisma } from '@simrs/db';
import { type IdentifierSystem, type MatchStatus, newId } from '@simrs/shared';
import { TenantDb } from '../../infra/tenant-db';

/** Data pasien yang dibandingkan di layar MPI (nilai terenkripsi didekripsi di service). */
export const MATCH_PATIENT_SELECT = {
  id: true,
  mrn: true,
  name: true,
  nameSearch: true,
  sex: true,
  birthDate: true,
  birthDateEstimated: true,
  motherName: true,
  addressEnc: true,
  phoneEnc: true,
  phoneHash: true,
  unidentified: true,
  status: true,
  mergedIntoId: true,
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
      verificationDetails: true,
    },
  },
} as const;
export type MatchPatientRow = Prisma.PatientGetPayload<{ select: typeof MATCH_PATIENT_SELECT }>;
export type IdentifierRow = MatchPatientRow['identifiers'][number];

const CANDIDATE_SELECT = {
  id: true,
  patientAId: true,
  patientBId: true,
  score: true,
  reasons: true,
  status: true,
  detectedAt: true,
  decidedAt: true,
  decidedBy: true,
  decisionReason: true,
} as const;
export type CandidateRow = Prisma.PatientMatchCandidateGetPayload<{ select: typeof CANDIDATE_SELECT }>;

const LINK_SELECT = {
  id: true,
  survivorId: true,
  mergedId: true,
  candidateId: true,
  reason: true,
  takenAttributes: true,
  survivorSnapshotEnc: true,
  mergedAt: true,
  mergedBy: true,
  undoneAt: true,
  undoneBy: true,
  undoReason: true,
} as const;
export type LinkRow = Prisma.PatientLinkGetPayload<{ select: typeof LINK_SELECT }>;

const PERSON = { select: { id: true, mrn: true, name: true } } as const;

/** P05 · Akses data antrean duplikat dan jejak penggabungan (transaksi permintaan, RLS aktif). */
@Injectable()
export class MpiMatchRepository {
  constructor(private readonly db: TenantDb) {}

  listCandidates(
    where: Prisma.PatientMatchCandidateWhereInput,
    orderBy: Prisma.PatientMatchCandidateOrderByWithRelationInput[],
    take: number,
  ) {
    return this.db.tx().patientMatchCandidate.findMany({
      where,
      orderBy,
      take,
      select: { ...CANDIDATE_SELECT, patientA: PERSON, patientB: PERSON },
    });
  }

  countCandidates(status: MatchStatus): Promise<number> {
    return this.db.tx().patientMatchCandidate.count({ where: { status } });
  }

  findCandidate(id: string): Promise<CandidateRow | null> {
    return this.db.tx().patientMatchCandidate.findUnique({ where: { id }, select: CANDIDATE_SELECT });
  }

  /** Kunci baris sampai transaksi selesai: dua petugas tidak bisa memutuskan pasangan yang sama serentak. */
  async lockCandidate(id: string): Promise<void> {
    await this.db.tx()
      .$queryRaw`SELECT 1 AS locked FROM patient_match_candidates WHERE id = ${id}::uuid FOR UPDATE`;
  }

  async lockLink(id: string): Promise<void> {
    await this.db.tx().$queryRaw`SELECT 1 AS locked FROM patient_links WHERE id = ${id}::uuid FOR UPDATE`;
  }

  /** Kunci kedua rekam medis dalam urutan tetap (hindari deadlock antar-penggabungan). */
  async lockPatients(ids: string[]): Promise<void> {
    const sorted = [...ids].sort();
    await this.db.tx()
      .$queryRaw`SELECT 1 AS locked FROM patients WHERE id = ANY(${sorted}::uuid[]) ORDER BY id FOR UPDATE`;
  }

  patients(ids: string[]): Promise<MatchPatientRow[]> {
    return this.db.tx().patient.findMany({ where: { id: { in: ids } }, select: MATCH_PATIENT_SELECT });
  }

  findLink(id: string): Promise<LinkRow | null> {
    return this.db.tx().patientLink.findUnique({ where: { id }, select: LINK_SELECT });
  }

  /** Jejak penggabungan terbaru untuk satu kandidat (aktif atau sudah dibatalkan). */
  latestLink(candidateId: string): Promise<LinkRow | null> {
    return this.db.tx().patientLink.findFirst({
      where: { candidateId },
      orderBy: { mergedAt: 'desc' },
      select: LINK_SELECT,
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

  activeRelationshipCount(patientId: string, at: Date): Promise<number> {
    return this.db.tx().accessRelationship.count({
      where: { patientId, validFrom: { lte: at }, OR: [{ validUntil: null }, { validUntil: { gt: at } }] },
    });
  }

  updatePatient(id: string, data: Prisma.PatientUncheckedUpdateInput) {
    return this.db.tx().patient.update({
      where: { id },
      data: { ...data, updatedBy: this.db.actorUserId() },
      select: { id: true },
    });
  }

  markMerged(id: string, survivorId: string, at: Date) {
    return this.updatePatient(id, { status: 'merged', mergedIntoId: survivorId, mergedAt: at });
  }

  markActive(id: string) {
    return this.updatePatient(id, { status: 'active', mergedIntoId: null, mergedAt: null });
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

  /** Identifier baru untuk pasien dari nilai terenkripsi yang sudah ada (salinan dari B atau pemulihan A). */
  insertIdentifier(
    patientId: string,
    system: IdentifierSystem,
    value: { valueEnc: string; valueHash: string },
    verification?: Pick<IdentifierRow, 'verificationStatus' | 'verifiedAt' | 'verificationDetails'>,
  ) {
    return this.db.tx().patientIdentifier.create({
      data: {
        id: newId(),
        tenantId: this.db.tenantId(),
        patientId,
        system,
        valueEnc: value.valueEnc,
        valueHash: value.valueHash,
        ...(verification
          ? {
              verificationStatus: verification.verificationStatus,
              verifiedAt: verification.verifiedAt,
              verificationDetails: verification.verificationDetails ?? undefined,
            }
          : {}),
        createdBy: this.db.actorUserId(),
      },
      select: { id: true },
    });
  }

  createLink(data: {
    id: string;
    survivorId: string;
    mergedId: string;
    candidateId: string;
    reason: string;
    takenAttributes: string[];
    survivorSnapshotEnc: string | null;
    mergedAt: Date;
  }) {
    return this.db.tx().patientLink.create({
      data: { ...data, tenantId: this.db.tenantId(), mergedBy: this.db.actorUserId() },
      select: { id: true },
    });
  }

  undoLink(id: string, reason: string) {
    return this.db.tx().patientLink.update({
      where: { id },
      data: { undoneAt: new Date(), undoneBy: this.db.actorUserId(), undoReason: reason },
      select: { id: true },
    });
  }

  decide(id: string, status: 'merged' | 'distinct', reason: string) {
    return this.db.tx().patientMatchCandidate.update({
      where: { id },
      data: { status, decidedAt: new Date(), decidedBy: this.db.actorUserId(), decisionReason: reason },
      select: { id: true },
    });
  }

  reopen(id: string) {
    return this.db.tx().patientMatchCandidate.update({
      where: { id },
      data: { status: 'open', decidedAt: null, decidedBy: null, decisionReason: null },
      select: { id: true },
    });
  }

  /** Kandidat terbuka lain yang melibatkan rekam medis yang baru digabung tidak relevan lagi. */
  supersedeOpenInvolving(patientId: string, exceptCandidateId: string) {
    return this.db.tx().patientMatchCandidate.updateMany({
      where: {
        status: 'open',
        id: { not: exceptCandidateId },
        OR: [{ patientAId: patientId }, { patientBId: patientId }],
      },
      data: { status: 'superseded' },
    });
  }
}
