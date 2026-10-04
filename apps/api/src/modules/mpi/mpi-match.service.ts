import { Inject, Injectable } from '@nestjs/common';
import { lockMpi, type Prisma, toDbDate } from '@simrs/db';
import {
  AppError,
  editDistance,
  formatTanggalLahir,
  type IdentifierSystem,
  type MatchListQuery,
  type MatchReason,
  matchSeverity,
  type MatchSeverity,
  type MatchStatus,
  matchSummary,
  maskIdentifier,
  maskPhone,
  MERGE_ATTRIBUTE_LABEL,
  MERGE_ATTRIBUTES,
  MERGE_UNDO_DAYS,
  type MergeAttribute,
  type MergeCandidateInput,
  type MpiDecisionInput,
  nameSimilarity,
  newId,
  normalizeAddress,
  normalizePersonName,
  PATIENT_SEX_LABEL,
  type PatientSex,
  trigramSimilarity,
} from '@simrs/shared';
import { PatientCrypto } from '@simrs/shared/node';
import { AuditedDenial } from '../../common/audited-denial';
import type { PendingAudit } from '../../common/request-context';
import { API_ENV, type ApiEnv } from '../../config/env';
import { TenantDb } from '../../infra/tenant-db';
import { DuplicateDetector } from './duplicate-detector';
import {
  type CandidateRow,
  type LinkRow,
  type MatchPatientRow,
  MpiMatchRepository,
} from './mpi-match.repository';

const DAY = 86_400_000;
const isoDate = (d: Date | null) => (d ? d.toISOString().slice(0, 10) : null);

/** Status verifikasi NIK di kolom banding: bahan keputusan petugas rekam medis. */
const NIK_VERIFICATION_NOTE: Record<string, string> = {
  pending: 'menunggu Dukcapil',
  verified: 'terverifikasi Dukcapil',
  mismatch: 'tidak sesuai Dukcapil',
  not_found: 'tidak ditemukan di Dukcapil',
};

export type AttributeMatch = 'sama' | 'mirip' | 'beda' | 'kosong';

export interface CompareRow {
  attribute: MergeAttribute;
  label: string;
  /** Nilai tampilan (identitas tersamar). */
  a: string | null;
  b: string | null;
  match: AttributeMatch;
}

/** Nilai rekam medis A sebelum ditimpa nilai B; disimpan terenkripsi di `patient_links`. */
interface SurvivorSnapshot {
  name?: { name: string; nameSearch: string };
  sex?: string;
  birthDate?: { value: string | null; estimated: boolean };
  motherName?: string | null;
  /** Ciphertext alamat A (tujuan `contact`). */
  address?: string | null;
  phone?: { enc: string | null; hash: string | null };
  identifiers?: Partial<Record<IdentifierSystem, { valueEnc: string; valueHash: string } | null>>;
}

interface Person {
  id: string;
  mrn: string;
  name: string;
}

/**
 * P05 · Tinjauan kemungkinan rekam medis ganda (layar MPI): antrean, banding atribut, gabung berjejak,
 * "bukan orang yang sama", dan pembatalan ≤ 30 hari.
 * - Gabung tidak memindah atau menghapus data: B ditandai `merged` + rujukan ke A; data B tetap utuh dan
 *   ikut terbaca lewat kelompok rekam medis (`app_patient_group`).
 * - Atribut yang diambil dari B menimpa nilai A; nilai lama A disimpan terenkripsi untuk pemulihan.
 * - Setiap tampilan dan keputusan dicatat di audit untuk KEDUA pasien.
 */
@Injectable()
export class MpiMatchService {
  constructor(
    @Inject(API_ENV) private readonly env: ApiEnv,
    private readonly db: TenantDb,
    private readonly repo: MpiMatchRepository,
    private readonly detector: DuplicateDetector,
  ) {}

  private crypto(): PatientCrypto {
    return new PatientCrypto(
      { encKeyB64: this.env.FIELD_ENCRYPTION_KEY, hashKeyB64: this.env.FIELD_HASH_KEY },
      this.db.tenantId(),
    );
  }

  /** Tinjauan MPI menyentuh dua pasien sekaligus: hanya untuk peran berlingkup seluruh pasien. */
  private assertScopeAll(): void {
    if (this.db.permissionScope() !== 'all') {
      throw new AuditedDenial('Tinjauan rekam medis ganda membutuhkan akses ke seluruh pasien', {
        resourceType: 'patient_match',
        details: { scope: this.db.permissionScope() },
      });
    }
  }

  /** Satu entri audit per pasien yang tersentuh (A dan B), saling merujuk. */
  private auditPair(entry: Omit<PendingAudit, 'patientId'>, aId: string, bId: string): void {
    this.db.audit({
      ...entry,
      patientId: aId,
      details: { ...entry.details, role: 'A', otherPatientId: bId },
    });
    this.db.audit({
      ...entry,
      patientId: bId,
      details: { ...entry.details, role: 'B', otherPatientId: aId },
    });
  }

  async list(q: MatchListQuery) {
    this.assertScopeAll();
    const since = new Date(Date.now() - MERGE_UNDO_DAYS * DAY);
    const open =
      q.status === 'decided'
        ? []
        : await this.repo.listCandidates(
            { status: 'open' },
            [{ score: 'desc' }, { detectedAt: 'desc' }],
            q.limit,
          );
    const decided =
      q.status === 'open'
        ? []
        : await this.repo.listCandidates(
            { status: { in: ['merged', 'distinct'] }, decidedAt: { gte: since } },
            [{ decidedAt: 'desc' }],
            q.limit,
          );
    const items = [...open, ...decided].map((c) => ({
      id: c.id,
      status: c.status as MatchStatus,
      score: c.score,
      severity: matchSeverity(c.score),
      reasons: c.reasons as MatchReason[],
      summary: matchSummary(c.reasons as string[]),
      detectedAt: c.detectedAt.toISOString(),
      decidedAt: c.decidedAt?.toISOString() ?? null,
      a: c.patientA as Person,
      b: c.patientB as Person,
    }));
    for (const it of items) {
      this.auditPair(
        { action: 'search', resourceType: 'patient_match', resourceId: it.id, details: { via: 'mpi' } },
        it.a.id,
        it.b.id,
      );
    }
    return { openCount: await this.repo.countCandidates('open'), items };
  }

  async compare(id: string) {
    this.assertScopeAll();
    const cand = await this.repo.findCandidate(id);
    if (!cand) throw new AppError('NOT_FOUND', 'Pasangan tidak ditemukan', 404);
    const [a, b] = await this.loadPair(cand.patientAId, cand.patientBId);
    const crypto = this.crypto();
    const link = await this.repo.latestLink(cand.id);
    const names = await this.repo.userNames([cand.decidedBy, link?.mergedBy ?? null, link?.undoneBy ?? null]);
    const rows = this.compareRows(a, b, crypto);
    const now = new Date();
    this.auditPair(
      { action: 'read', resourceType: 'patient_match', resourceId: cand.id, details: { via: 'mpi' } },
      a.id,
      b.id,
    );
    return {
      id: cand.id,
      status: cand.status as MatchStatus,
      score: cand.score,
      severity: matchSeverity(cand.score) as MatchSeverity,
      reasons: cand.reasons as MatchReason[],
      summary: matchSummary(cand.reasons as string[]),
      detectedAt: cand.detectedAt.toISOString(),
      a: { id: a.id, mrn: a.mrn, name: a.name, status: a.status },
      b: { id: b.id, mrn: b.mrn, name: b.name, status: b.status },
      rows,
      impact: [
        {
          n: await this.repo.activeRelationshipCount(b.id, now),
          label: 'relasi perawatan B ikut berlaku untuk A',
        },
        { n: b.identifiers.length, label: 'identifier B tetap tersimpan, pencarian diarahkan ke A' },
        { n: 0, label: 'data yang dihapus atau dipindah' },
      ],
      decision: cand.decidedAt
        ? {
            at: cand.decidedAt.toISOString(),
            by: cand.decidedBy ? (names.get(cand.decidedBy) ?? null) : null,
            reason: cand.decisionReason,
          }
        : null,
      link: link ? this.presentLink(link, names, now) : null,
    };
  }

  async merge(id: string, input: MergeCandidateInput) {
    this.assertScopeAll();
    await lockMpi(this.db.tx());
    const cand = await this.lockOpen(id);
    await this.repo.lockPatients([cand.patientAId, cand.patientBId]);
    const [a, b] = await this.loadPair(cand.patientAId, cand.patientBId);
    if (a.status !== 'active' || b.status !== 'active') {
      throw new AppError(
        'CONFLICT',
        'Salah satu rekam medis sudah digabung ke rekam medis lain. Muat ulang antrean.',
        409,
      );
    }
    const taken = MERGE_ATTRIBUTES.filter((attr) => input.takeFromB.includes(attr));
    const missing = taken.filter((attr) => !this.hasValue(attr, b));
    if (missing.length > 0) {
      throw new AppError(
        'VALIDATION_FAILED',
        `Rekam medis B tidak memiliki ${missing.map((m) => MERGE_ATTRIBUTE_LABEL[m]).join(', ')}`,
        400,
      );
    }

    const crypto = this.crypto();
    const snapshot: SurvivorSnapshot = {};
    const data: Prisma.PatientUncheckedUpdateInput = {};
    for (const attr of taken) {
      switch (attr) {
        case 'name':
          snapshot.name = { name: a.name, nameSearch: a.nameSearch };
          data.name = b.name;
          data.nameSearch = b.nameSearch;
          break;
        case 'sex':
          snapshot.sex = a.sex;
          data.sex = b.sex;
          break;
        case 'birthDate':
          snapshot.birthDate = { value: isoDate(a.birthDate), estimated: a.birthDateEstimated };
          data.birthDate = b.birthDate;
          data.birthDateEstimated = b.birthDateEstimated;
          break;
        case 'motherName':
          snapshot.motherName = a.motherName;
          data.motherName = b.motherName;
          break;
        case 'address':
          snapshot.address = a.addressEnc;
          data.addressEnc = b.addressEnc;
          break;
        case 'phone':
          snapshot.phone = { enc: a.phoneEnc, hash: a.phoneHash };
          data.phoneEnc = b.phoneEnc;
          data.phoneHash = b.phoneHash;
          break;
        default: {
          const current = a.identifiers.find((i) => i.system === attr);
          const fromB = b.identifiers.find((i) => i.system === attr);
          if (!fromB) break;
          snapshot.identifiers = {
            ...snapshot.identifiers,
            [attr]: current ? { valueEnc: current.valueEnc, valueHash: current.valueHash } : null,
          };
          if (current) {
            await this.repo.deactivateIdentifier(
              current.id,
              `Diganti nilai dari RM ${b.mrn} saat penggabungan`,
            );
          }
          await this.repo.insertIdentifier(a.id, attr, fromB, fromB);
        }
      }
    }
    if (Object.keys(data).length > 0) await this.repo.updatePatient(a.id, data);

    const mergedAt = new Date();
    await this.repo.markMerged(b.id, a.id, mergedAt);
    const linkId = newId();
    await this.repo.createLink({
      id: linkId,
      survivorId: a.id,
      mergedId: b.id,
      candidateId: cand.id,
      reason: input.reason,
      takenAttributes: taken,
      survivorSnapshotEnc: taken.length > 0 ? crypto.encryptSnapshot(snapshot) : null,
      mergedAt,
    });
    await this.repo.decide(cand.id, 'merged', input.reason);
    await this.repo.supersedeOpenInvolving(b.id, cand.id);
    await this.detector.run(crypto, a.id);
    this.auditPair(
      {
        action: 'merge',
        resourceType: 'patient_link',
        resourceId: linkId,
        reason: input.reason,
        details: { taken },
      },
      a.id,
      b.id,
    );
    return {
      linkId,
      survivor: { id: a.id, mrn: a.mrn },
      merged: { id: b.id, mrn: b.mrn },
      taken,
      undoUntil: new Date(mergedAt.getTime() + MERGE_UNDO_DAYS * DAY).toISOString(),
    };
  }

  /**
   * Batalkan penggabungan (≤ 30 hari): B aktif lagi, atribut A yang masih bernilai sama dengan B dipulihkan
   * dari snapshot. Atribut A yang sudah diubah petugas sejak penggabungan dibiarkan (dilaporkan `kept`).
   */
  async undo(linkId: string, input: MpiDecisionInput) {
    this.assertScopeAll();
    await lockMpi(this.db.tx());
    await this.repo.lockLink(linkId);
    const link = await this.repo.findLink(linkId);
    if (!link) throw new AppError('NOT_FOUND', 'Jejak penggabungan tidak ditemukan', 404);
    if (link.undoneAt) throw new AppError('CONFLICT', 'Penggabungan ini sudah dibatalkan', 409);
    if (Date.now() - link.mergedAt.getTime() > MERGE_UNDO_DAYS * DAY) {
      throw new AppError(
        'CONFLICT',
        `Batas pembatalan ${MERGE_UNDO_DAYS} hari sudah lewat; penggabungan hanya bisa dikoreksi lewat prosedur rekam medis`,
        409,
      );
    }
    await this.repo.lockPatients([link.survivorId, link.mergedId]);
    const [a, b] = await this.loadPair(link.survivorId, link.mergedId);
    if (b.status !== 'merged' || b.mergedIntoId !== a.id) {
      throw new AppError('CONFLICT', 'Status rekam medis tidak sesuai jejak penggabungan', 409);
    }

    const crypto = this.crypto();
    const snapshot = link.survivorSnapshotEnc
      ? crypto.decryptSnapshot<SurvivorSnapshot>(link.survivorSnapshotEnc)
      : {};
    const restored: MergeAttribute[] = [];
    const kept: MergeAttribute[] = [];
    const data: Prisma.PatientUncheckedUpdateInput = {};
    for (const attr of link.takenAttributes as MergeAttribute[]) {
      if (!this.stillFromB(attr, a, b)) {
        kept.push(attr);
        continue;
      }
      restored.push(attr);
      switch (attr) {
        case 'name':
          if (snapshot.name) {
            data.name = snapshot.name.name;
            data.nameSearch = snapshot.name.nameSearch;
          }
          break;
        case 'sex':
          if (snapshot.sex) data.sex = snapshot.sex;
          break;
        case 'birthDate':
          data.birthDate = snapshot.birthDate?.value ? toDbDate(snapshot.birthDate.value) : null;
          data.birthDateEstimated = snapshot.birthDate?.estimated ?? false;
          break;
        case 'motherName':
          data.motherName = snapshot.motherName ?? null;
          break;
        case 'address':
          data.addressEnc = snapshot.address ?? null;
          break;
        case 'phone':
          data.phoneEnc = snapshot.phone?.enc ?? null;
          data.phoneHash = snapshot.phone?.hash ?? null;
          break;
        default: {
          const copy = a.identifiers.find((i) => i.system === attr);
          if (copy)
            await this.repo.deactivateIdentifier(copy.id, `Penggabungan dengan RM ${b.mrn} dibatalkan`);
          const previous = snapshot.identifiers?.[attr];
          if (previous) await this.repo.insertIdentifier(a.id, attr, previous);
        }
      }
    }
    if (Object.keys(data).length > 0) await this.repo.updatePatient(a.id, data);
    await this.repo.markActive(b.id);
    await this.repo.undoLink(link.id, input.reason);
    if (link.candidateId) await this.repo.reopen(link.candidateId);
    await this.detector.run(crypto, a.id);
    await this.detector.run(crypto, b.id);
    this.auditPair(
      {
        action: 'unmerge',
        resourceType: 'patient_link',
        resourceId: link.id,
        reason: input.reason,
        details: { restored, kept },
      },
      a.id,
      b.id,
    );
    return { restored, kept };
  }

  async distinct(id: string, input: MpiDecisionInput) {
    this.assertScopeAll();
    await lockMpi(this.db.tx());
    const cand = await this.lockOpen(id);
    await this.repo.decide(cand.id, 'distinct', input.reason);
    this.auditPair(
      {
        action: 'review',
        resourceType: 'patient_match',
        resourceId: cand.id,
        reason: input.reason,
        details: { outcome: 'distinct' },
      },
      cand.patientAId,
      cand.patientBId,
    );
    return { id: cand.id, status: 'distinct' as const };
  }

  /** Batalkan keputusan "bukan orang yang sama": pasangan kembali ke antrean. */
  async reopen(id: string, input: MpiDecisionInput) {
    this.assertScopeAll();
    await lockMpi(this.db.tx());
    await this.repo.lockCandidate(id);
    const cand = await this.repo.findCandidate(id);
    if (!cand) throw new AppError('NOT_FOUND', 'Pasangan tidak ditemukan', 404);
    if (cand.status !== 'distinct') {
      throw new AppError(
        'CONFLICT',
        cand.status === 'merged'
          ? 'Pasangan ini sudah digabung; batalkan lewat jejak penggabungan'
          : 'Pasangan ini belum diputuskan',
        409,
      );
    }
    await this.repo.reopen(cand.id);
    this.auditPair(
      {
        action: 'review',
        resourceType: 'patient_match',
        resourceId: cand.id,
        reason: input.reason,
        details: { outcome: 'reopened' },
      },
      cand.patientAId,
      cand.patientBId,
    );
    return { id: cand.id, status: 'open' as const };
  }

  private async lockOpen(id: string): Promise<CandidateRow> {
    await this.repo.lockCandidate(id);
    const cand = await this.repo.findCandidate(id);
    if (!cand) throw new AppError('NOT_FOUND', 'Pasangan tidak ditemukan', 404);
    if (cand.status !== 'open') {
      throw new AppError('CONFLICT', 'Pasangan ini sudah diputuskan atau tidak lagi relevan', 409);
    }
    return cand;
  }

  private async loadPair(aId: string, bId: string): Promise<[MatchPatientRow, MatchPatientRow]> {
    const rows = await this.repo.patients([aId, bId]);
    const a = rows.find((r) => r.id === aId);
    const b = rows.find((r) => r.id === bId);
    if (!a || !b) throw new AppError('NOT_FOUND', 'Rekam medis pasangan tidak ditemukan', 404);
    return [a, b];
  }

  private identifier(row: MatchPatientRow, system: IdentifierSystem) {
    return row.identifiers.find((i) => i.system === system);
  }

  private hasValue(attr: MergeAttribute, row: MatchPatientRow): boolean {
    switch (attr) {
      case 'name':
        return true;
      case 'sex':
        return row.sex !== 'unknown';
      case 'birthDate':
        return row.birthDate !== null;
      case 'motherName':
        return row.motherName !== null;
      case 'address':
        return row.addressEnc !== null;
      case 'phone':
        return row.phoneEnc !== null;
      default:
        return Boolean(this.identifier(row, attr));
    }
  }

  /** Nilai A pada atribut ini masih nilai yang diambil dari B (belum diubah sejak penggabungan). */
  private stillFromB(attr: MergeAttribute, a: MatchPatientRow, b: MatchPatientRow): boolean {
    switch (attr) {
      case 'name':
        return a.name === b.name;
      case 'sex':
        return a.sex === b.sex;
      case 'birthDate':
        return isoDate(a.birthDate) === isoDate(b.birthDate) && a.birthDateEstimated === b.birthDateEstimated;
      case 'motherName':
        return a.motherName === b.motherName;
      case 'address':
        return a.addressEnc === b.addressEnc;
      case 'phone':
        return a.phoneEnc === b.phoneEnc && a.phoneHash === b.phoneHash;
      default:
        return (
          this.identifier(a, attr)?.valueHash !== undefined &&
          this.identifier(a, attr)?.valueHash === this.identifier(b, attr)?.valueHash
        );
    }
  }

  private compareRows(a: MatchPatientRow, b: MatchPatientRow, crypto: PatientCrypto): CompareRow[] {
    const shown: MergeAttribute[] = [
      'name',
      'sex',
      'nik',
      'birthDate',
      'motherName',
      'address',
      'bpjs',
      'phone',
      'ihs',
    ];
    if (this.identifier(a, 'paspor') || this.identifier(b, 'paspor')) shown.push('paspor');
    return shown.map((attr) => ({
      attribute: attr,
      label: MERGE_ATTRIBUTE_LABEL[attr],
      a: this.display(attr, a, crypto),
      b: this.display(attr, b, crypto),
      match: this.matchOf(attr, a, b, crypto),
    }));
  }

  private display(attr: MergeAttribute, row: MatchPatientRow, crypto: PatientCrypto): string | null {
    switch (attr) {
      case 'name':
        return row.name;
      case 'sex':
        return row.sex === 'unknown' ? null : (PATIENT_SEX_LABEL[row.sex as PatientSex] ?? row.sex);
      case 'birthDate': {
        const d = isoDate(row.birthDate);
        return d ? `${formatTanggalLahir(d)}${row.birthDateEstimated ? ' (perkiraan)' : ''}` : null;
      }
      case 'motherName':
        return row.motherName;
      case 'address':
        return row.addressEnc ? crypto.decryptContact(row.addressEnc) : null;
      case 'phone':
        return row.phoneEnc ? maskPhone(crypto.decryptContact(row.phoneEnc)) : null;
      default: {
        const id = this.identifier(row, attr);
        if (!id) return null;
        const masked = maskIdentifier(attr, crypto.decryptIdentifier(id.valueEnc));
        const note = attr === 'nik' ? NIK_VERIFICATION_NOTE[id.verificationStatus] : undefined;
        return note ? `${masked} · ${note}` : masked;
      }
    }
  }

  private matchOf(
    attr: MergeAttribute,
    a: MatchPatientRow,
    b: MatchPatientRow,
    crypto: PatientCrypto,
  ): AttributeMatch {
    if (!this.hasValue(attr, a) || !this.hasValue(attr, b)) return 'kosong';
    const grade = (same: boolean, similar: boolean): AttributeMatch =>
      same ? 'sama' : similar ? 'mirip' : 'beda';
    switch (attr) {
      case 'name': {
        const x = normalizePersonName(a.name);
        const y = normalizePersonName(b.name);
        return grade(x === y, nameSimilarity(x, y) >= 0.3);
      }
      case 'sex':
        return grade(a.sex === b.sex, false);
      case 'birthDate': {
        const x = isoDate(a.birthDate) ?? '';
        const y = isoDate(b.birthDate) ?? '';
        const estimated = a.birthDateEstimated || b.birthDateEstimated;
        const years = Math.abs(Number(x.slice(0, 4)) - Number(y.slice(0, 4)));
        return grade(x === y && !estimated, estimated && years <= 5);
      }
      case 'motherName': {
        const x = normalizePersonName(a.motherName ?? '');
        const y = normalizePersonName(b.motherName ?? '');
        return grade(x === y, trigramSimilarity(x, y) >= 0.5);
      }
      case 'address': {
        const x = normalizeAddress(crypto.decryptContact(a.addressEnc ?? ''));
        const y = normalizeAddress(crypto.decryptContact(b.addressEnc ?? ''));
        return grade(x === y, trigramSimilarity(x, y) >= 0.5);
      }
      case 'phone':
        return grade(a.phoneHash === b.phoneHash, false);
      default: {
        const x = this.identifier(a, attr);
        const y = this.identifier(b, attr);
        if (!x || !y) return 'kosong';
        const typo =
          attr === 'nik' &&
          editDistance(crypto.decryptIdentifier(x.valueEnc), crypto.decryptIdentifier(y.valueEnc)) <= 2;
        return grade(x.valueHash === y.valueHash, typo);
      }
    }
  }

  private presentLink(link: LinkRow, names: Map<string, string>, now: Date) {
    const undoUntil = new Date(link.mergedAt.getTime() + MERGE_UNDO_DAYS * DAY);
    return {
      id: link.id,
      mergedAt: link.mergedAt.toISOString(),
      mergedBy: link.mergedBy ? (names.get(link.mergedBy) ?? null) : null,
      reason: link.reason,
      taken: link.takenAttributes as MergeAttribute[],
      undoUntil: undoUntil.toISOString(),
      undoable: !link.undoneAt && now < undoUntil,
      undoneAt: link.undoneAt?.toISOString() ?? null,
      undoneBy: link.undoneBy ? (names.get(link.undoneBy) ?? null) : null,
      undoReason: link.undoReason,
    };
  }
}
