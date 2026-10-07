import { Injectable } from '@nestjs/common';
import { Prisma, raisedDbCode, readTenantSetting, uniqueViolationTarget } from '@simrs/db';
import {
  AppError,
  type ClinicalEntryMeta,
  clinicalError,
  type ClinicalErrorCode,
  type ClinicalRevision,
  isLateEntry,
  newId,
  occurredInFuture,
} from '@simrs/shared';
import { TenantDb } from '../tenant-db';

/**
 * Tabel klinis berversi (ADR-0028). Nama hanya dari daftar ini yang boleh masuk SQL dinamis (identifier, bukan nilai).
 */
export const CLINICAL_TABLES = [
  'observations',
  'diagnostic_reports',
  'conditions',
  'procedures',
  'allergy_intolerances',
  'cppt_entries',
  'handovers',
  'consult_requests',
  'consult_responses',
  'consents',
  'discharge_summaries',
  'triage_assessments',
  'nursing_care_plans',
  'death_certificates',
] as const;
export type ClinicalTable = (typeof CLINICAL_TABLES)[number];

export function isClinicalTable(name: string): name is ClinicalTable {
  return (CLINICAL_TABLES as readonly string[]).includes(name);
}

/** Kolom pola berversi yang ditetapkan layanan ini (bukan modul). `recorded_at` diisi trigger dari jam server. */
export interface ClinicalVersionFields {
  id: string;
  tenantId: string;
  patientId: string;
  encounterId: string | null;
  rootId: string;
  version: number;
  supersedesId: string | null;
  addendumOf: string | null;
  status: 'final' | 'entered_in_error';
  correctionReason: string | null;
  occurredAt: Date;
  authorUserId: string;
  authorRole: string;
}

/** Baris pola berversi minimal untuk membentuk meta jawaban API. */
export interface ClinicalRowLike {
  id: string;
  rootId: string;
  version: number;
  supersedesId: string | null;
  addendumOf: string | null;
  status: string;
  correctionReason: string | null;
  occurredAt: Date;
  recordedAt: Date;
  authorUserId: string;
  authorRole: string;
}

interface PrevRow {
  id: string;
  root_id: string;
  version: number;
  patient_id: string;
  encounter_id: string | null;
  status: string;
  author_user_id: string;
  superseded: boolean;
}

/** Kode `RAISE` database → kode galat klinis (`CLINICAL_ERRORS`). */
const RAISED_TO_CLINICAL: Readonly<Record<string, ClinicalErrorCode>> = {
  RECORD_LOCKED: 'RECORD_LOCKED',
  RECORD_NOT_FINAL: 'RECORD_NOT_FINAL',
  WRISTBAND_MISMATCH: 'WRISTBAND_MISMATCH',
  WRISTBAND_SCAN_REQUIRED: 'WRISTBAND_SCAN_REQUIRED',
  DOUBLE_CHECK_REQUIRED: 'DOUBLE_CHECK_REQUIRED',
  DOSE_ALREADY_GIVEN: 'MEDICATION_ALREADY_GIVEN',
  BED_VERSION_CONFLICT: 'BED_VERSION_CONFLICT',
};

/**
 * Ubah galat database dari tabel klinis menjadi galat API stabil. Pesan database tidak pernah diteruskan (bisa memuat
 * nilai). Kembalikan `null` bila bukan galat klinis yang dikenal (lempar galat asli).
 */
export function clinicalDbError(err: unknown): AppError | null {
  const raised = raisedDbCode(err);
  if (raised) {
    const mapped = RAISED_TO_CLINICAL[raised];
    if (mapped) return clinicalError(mapped);
    if (raised === 'CLINICAL_CHAIN') {
      return new AppError(
        'VALIDATION_FAILED',
        'Koreksi/addendum tidak melanjutkan rantai entri yang sama',
        422,
      );
    }
    if (raised === 'REF_CODE_UNKNOWN') {
      return new AppError(
        'VALIDATION_FAILED',
        'Kode tidak ada di data rujukan (ICD-10/ICD-9-CM/LOINC/KFA)',
        422,
      );
    }
    if (raised === 'APPEND_ONLY') {
      return new AppError('CONFLICT', 'Entri klinis tidak bisa diubah atau dihapus; buat koreksi', 409);
    }
  }
  const target = uniqueViolationTarget(err);
  if (/supersedes/.test(target)) return clinicalError('RECORD_SUPERSEDED');
  return null;
}

/**
 * ADR-0028 · Satu tempat untuk pola entri klinis berversi di API: versi 1, koreksi (penulis asli saja; versi yang sudah
 * digantikan → 409 `RECORD_SUPERSEDED`; versi ber-TTE → 409 `RECORD_LOCKED`), salah entri, addendum oleh PPA lain,
 * penanda entri terlambat, dan pemetaan galat trigger. Penulis SELALU dari sesi (MRMIK 8a); modul tidak pernah
 * menerima penulis dari body.
 *
 * Kunci advisory per versi (`lockVersion`) menyerialkan koreksi dengan permintaan TTE atas versi yang sama (jalur TTE
 * memanggil `lockForSigning`), sehingga versi yang sedang dimintakan TTE tidak bisa digantikan diam-diam.
 */
@Injectable()
export class ClinicalRecordService {
  constructor(private readonly db: TenantDb) {}

  /** Penulis dari sesi: pengguna + peran penugasan. Tanpa keduanya (perangkat, mode header) → 403. */
  author(): { userId: string; role: string } {
    const actor = this.db.actor();
    if (!actor.userId || !actor.role || actor.devicePrincipal) {
      throw new AppError(
        'FORBIDDEN',
        'Entri klinis hanya bisa ditulis staf yang masuk dengan penugasannya',
        403,
      );
    }
    return { userId: actor.userId, role: actor.role };
  }

  /**
   * Kunci advisory transaksi per versi entri: koreksi dan permintaan TTE atas versi yang sama berjalan bergantian.
   * Dilepas otomatis saat transaksi permintaan selesai.
   */
  async lockVersion(table: ClinicalTable, versionId: string): Promise<void> {
    await this.db.tx()
      .$executeRaw`SELECT pg_advisory_xact_lock(hashtextextended(${`clinical:${table}:${versionId}`}, 0))`;
  }

  /**
   * Kolom pola berversi untuk entri baru/koreksi/addendum (belum disimpan). Modul menyimpan baris dengan kolom ini +
   * isinya sendiri di dalam `insert()`.
   */
  async prepare(
    table: ClinicalTable,
    input: {
      patientId: string;
      encounterId: string | null;
      occurredAt: Date | string;
      revision: ClinicalRevision;
    },
  ): Promise<ClinicalVersionFields> {
    const author = this.author();
    const occurredAt = new Date(input.occurredAt);
    if (occurredInFuture(occurredAt, new Date())) {
      throw new AppError('VALIDATION_FAILED', 'Waktu kejadian tidak boleh di masa depan', 422);
    }
    const base = {
      tenantId: this.db.tenantId(),
      patientId: input.patientId,
      encounterId: input.encounterId,
      occurredAt,
      authorUserId: author.userId,
      authorRole: author.role,
      status: 'final' as const,
    };
    const r = input.revision;
    if (r.kind === 'baru') {
      const id = newId();
      return {
        ...base,
        id,
        rootId: id,
        version: 1,
        supersedesId: null,
        addendumOf: null,
        correctionReason: null,
      };
    }
    if (r.kind === 'koreksi') {
      const prev = await this.loadForCorrection(table, r.supersedesId, input);
      return {
        ...base,
        id: newId(),
        rootId: prev.root_id,
        version: prev.version + 1,
        supersedesId: prev.id,
        addendumOf: null,
        correctionReason: r.correctionReason,
      };
    }
    const target = await this.load(table, r.addendumOf);
    this.assertSameContext(target, input);
    if (target.status !== 'final' || target.superseded) throw clinicalError('RECORD_NOT_FINAL');
    const id = newId();
    return {
      ...base,
      id,
      rootId: id,
      version: 1,
      supersedesId: null,
      addendumOf: target.id,
      correctionReason: null,
    };
  }

  /**
   * Salah entri: versi baru berstatus `entered_in_error` yang menyalin isi versi itu apa adanya (isi asli tetap
   * terbaca), oleh penulis asli dengan alasan. Generik untuk semua tabel klinis berversi.
   */
  async enteredInError(
    table: ClinicalTable,
    id: string,
    reason: string,
  ): Promise<{ id: string; patientId: string }> {
    const author = this.author();
    const prev = await this.loadForCorrection(table, id, null);
    const newIdValue = newId();
    await this.insert(() =>
      this.db.tx().$executeRawUnsafe(
        `INSERT INTO ${quoteIdent(table)}
         SELECT (jsonb_populate_record(NULL::${quoteIdent(table)}, to_jsonb(r) || jsonb_build_object(
           'id', $1::uuid, 'version', r.version + 1, 'supersedes_id', r.id, 'addendum_of', NULL,
           'status', 'entered_in_error', 'correction_reason', $2::text, 'author_user_id', $3::uuid,
           'author_role', $4::text, 'occurred_at', statement_timestamp(), 'recorded_at', statement_timestamp()))).*
         FROM ${quoteIdent(table)} r WHERE r.tenant_id = $5::uuid AND r.id = $6::uuid`,
        newIdValue,
        reason,
        author.userId,
        author.role,
        this.db.tenantId(),
        prev.id,
      ),
    );
    return { id: newIdValue, patientId: prev.patient_id };
  }

  /** Jalankan penyimpanan dan ubah galat trigger/unik menjadi galat klinis stabil. */
  async insert<T>(fn: () => Promise<T>): Promise<T> {
    try {
      return await fn();
    } catch (err) {
      throw clinicalDbError(err) ?? err;
    }
  }

  /**
   * Titik sambung jalur TTE (ADR-0028/0029): kunci versi, pastikan versi itu masih terkini dan final, lalu jalankan
   * `fn` (membuat dokumen + permintaan tanda tangan) di bawah kunci yang sama dengan koreksi.
   */
  async lockForSigning<T>(table: ClinicalTable, versionId: string, fn: () => Promise<T>): Promise<T> {
    await this.lockVersion(table, versionId);
    const row = await this.load(table, versionId);
    if (row.superseded) throw clinicalError('RECORD_SUPERSEDED');
    if (row.status !== 'final') throw clinicalError('RECORD_NOT_FINAL');
    return fn();
  }

  /** Versi mana saja yang terkunci TTE (dokumen sumber dengan tanda tangan pending/signed, tidak batal). */
  async lockedIds(table: ClinicalTable, ids: readonly string[]): Promise<Set<string>> {
    if (ids.length === 0) return new Set();
    const rows = await this.db.tx().$queryRaw<Array<{ id: string }>>`
      SELECT DISTINCT d.source_id::text AS id FROM documents d
      JOIN document_signatures s ON s.tenant_id = d.tenant_id AND s.document_id = d.id
      WHERE d.source_type = ${table} AND d.source_id = ANY(${[...ids]}::uuid[])
        AND d.voided_at IS NULL AND s.status <> 'failed'`;
    return new Set(rows.map((r) => r.id));
  }

  /** Meta jawaban API untuk baris-baris berversi: penulis bernama, penanda terlambat, kunci TTE. */
  async meta<R extends ClinicalRowLike>(
    table: ClinicalTable,
    rows: readonly R[],
  ): Promise<Map<string, ClinicalEntryMeta>> {
    const lateHours = await readTenantSetting(this.db.tx(), 'clinical.late_entry_hours');
    const names = await this.userNames(rows.map((r) => r.authorUserId));
    const locked = await this.lockedIds(
      table,
      rows.map((r) => r.id),
    );
    return new Map(
      rows.map((r) => [
        r.id,
        {
          id: r.id,
          rootId: r.rootId,
          version: r.version,
          supersedesId: r.supersedesId,
          addendumOf: r.addendumOf,
          status: r.status as ClinicalEntryMeta['status'],
          correctionReason: r.correctionReason,
          occurredAt: r.occurredAt.toISOString(),
          recordedAt: r.recordedAt.toISOString(),
          lateEntry: isLateEntry(r.occurredAt, r.recordedAt, lateHours),
          author: {
            userId: r.authorUserId,
            nama: names.get(r.authorUserId) ?? 'Pengguna',
            peran: r.authorRole,
          },
          locked: locked.has(r.id),
        },
      ]),
    );
  }

  async userNames(ids: readonly string[]): Promise<Map<string, string>> {
    const unique = [...new Set(ids)];
    if (unique.length === 0) return new Map();
    const users = await this.db.tx().user.findMany({
      where: { id: { in: unique } },
      select: { id: true, displayName: true },
    });
    return new Map(users.map((u) => [u.id, u.displayName]));
  }

  private async load(table: ClinicalTable, id: string): Promise<PrevRow> {
    const rows = await this.db.tx().$queryRawUnsafe<PrevRow[]>(
      `SELECT r.id::text, r.root_id::text, r.version, r.patient_id::text, r.encounter_id::text, r.status,
              r.author_user_id::text,
              EXISTS (SELECT 1 FROM ${quoteIdent(table)} n WHERE n.tenant_id = r.tenant_id AND n.supersedes_id = r.id)
                AS superseded
       FROM ${quoteIdent(table)} r WHERE r.tenant_id = $1::uuid AND r.id = $2::uuid`,
      this.db.tenantId(),
      id,
    );
    const row = rows[0];
    if (!row) throw new AppError('NOT_FOUND', 'Entri klinis tidak ditemukan', 404);
    return row;
  }

  /** Koreksi/salah entri: kunci versi, penulis asli, belum digantikan, belum ber-TTE. */
  private async loadForCorrection(
    table: ClinicalTable,
    id: string,
    input: { patientId: string; encounterId: string | null } | null,
  ): Promise<PrevRow> {
    await this.lockVersion(table, id);
    const prev = await this.load(table, id);
    if (input) this.assertSameContext(prev, input);
    if (prev.author_user_id !== this.author().userId) throw clinicalError('RECORD_NOT_AUTHOR');
    if (prev.superseded) throw clinicalError('RECORD_SUPERSEDED');
    if ((await this.lockedIds(table, [prev.id])).has(prev.id)) throw clinicalError('RECORD_LOCKED');
    return prev;
  }

  private assertSameContext(row: PrevRow, input: { patientId: string; encounterId: string | null }): void {
    if (row.patient_id !== input.patientId || (row.encounter_id ?? null) !== (input.encounterId ?? null)) {
      throw new AppError('VALIDATION_FAILED', 'Entri yang dirujuk bukan milik pasien/kunjungan ini', 422);
    }
  }
}

/** Identifier tabel klinis untuk SQL dinamis; hanya nama dari `CLINICAL_TABLES` (dicek ulang di sini). */
function quoteIdent(table: ClinicalTable): string {
  if (!isClinicalTable(table)) throw new Error(`Tabel klinis tidak dikenal: ${String(table)}`);
  return `"${table}"`;
}

/** Ekspor untuk modul yang menyusun SQL sendiri dengan identifier tabel klinis. */
export const clinicalTableSql = (table: ClinicalTable): Prisma.Sql => Prisma.raw(quoteIdent(table));
