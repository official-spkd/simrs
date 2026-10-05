import { Injectable } from '@nestjs/common';
import { getConcept } from '@simrs/db';
import {
  type AllergyInput,
  type AllergyRecord,
  AppError,
  type ClinicalEntryMeta,
  clinicalError,
  type ConditionInput,
  type ConditionRecord,
  type PatientAllergies,
  type ProcedureInput,
  type ProcedureRecord,
} from '@simrs/shared';
import {
  assertRevisionAllowed,
  clinicalEncounter,
  clinicalPatient,
  lockClinicalKey,
  patientGroupIds,
} from '../../infra/clinical/clinical-context';
import { type ClinicalTable, ClinicalRecordService } from '../../infra/clinical/clinical-record.service';
import { BillableRecorder, SatusehatRecorder } from '../../infra/clinical/staging';
import { PermissionMatrix } from '../../infra/permission-matrix';
import { TenantDb } from '../../infra/tenant-db';
import { PatientAccessService } from '../authz/patient-access.service';

/** Tabel K08 yang punya endpoint salah entri di modul ini. */
export const DIAGNOSIS_ENTRY_TABLES = {
  conditions: 'conditions',
  procedures: 'procedures',
  allergies: 'allergy_intolerances',
} as const satisfies Record<string, ClinicalTable>;
export type DiagnosisEntryKind = keyof typeof DIAGNOSIS_ENTRY_TABLES;

const RESOURCE: Record<DiagnosisEntryKind, string> = {
  conditions: 'condition',
  procedures: 'procedure',
  allergies: 'allergy_intolerance',
};
const SATUSEHAT: Record<DiagnosisEntryKind, 'Condition' | 'Procedure' | 'AllergyIntolerance'> = {
  conditions: 'Condition',
  procedures: 'Procedure',
  allergies: 'AllergyIntolerance',
};

const ROLE_RANK: Record<string, number> = { utama: 0, sekunder: 1, komplikasi: 2 };
const ROLE_ORDER = (c: { role: string | null }) => (c.role === null ? 3 : (ROLE_RANK[c.role] ?? 3));

/** Versi terkini (belum digantikan). */
const CURRENT = { supersededBy: { none: {} } } as const;

const ALLERGY_SELECT = {
  id: true,
  rootId: true,
  version: true,
  supersedesId: true,
  addendumOf: true,
  status: true,
  correctionReason: true,
  occurredAt: true,
  recordedAt: true,
  authorUserId: true,
  authorRole: true,
  patientId: true,
  encounterId: true,
  kind: true,
  text: true,
  category: true,
  criticality: true,
  reaction: true,
  substance: { select: { id: true, code: true, name: true } },
} as const;

/**
 * K08 · Diagnosis ICD-10 (kunjungan + problem list), prosedur ICD-9-CM, alergi/NKDA (rencana fase 3 §3.2a). Semua
 * lewat `ClinicalRecordService` (ADR-0028): entri berversi, penulis dari sesi, koreksi oleh penulis asli, addendum,
 * salah entri. Nama kode SELALU dari data rujukan `ref` (tidak dikarang, CLAUDE.md §4.10). Aturan yang tidak bisa
 * dijadikan indeks unik ditegakkan di sini di bawah kunci advisory:
 * - satu diagnosis utama final per kunjungan;
 * - NKDA tidak berdampingan dengan alergi final; satu entri per zat terkode.
 * Staging SATUSEHAT `held` per versi (ADR-0032); prosedur juga peristiwa biaya `tindakan` per rantai.
 */
@Injectable()
export class DiagnosisService {
  constructor(
    private readonly db: TenantDb,
    private readonly records: ClinicalRecordService,
    private readonly access: PatientAccessService,
    private readonly matrix: PermissionMatrix,
    private readonly satusehat: SatusehatRecorder,
    private readonly billable: BillableRecorder,
  ) {}

  // ------------------------------------------------------------------------------------------------------------
  // Diagnosis (conditions)
  // ------------------------------------------------------------------------------------------------------------

  async createCondition(input: ConditionInput): Promise<ConditionRecord> {
    await assertRevisionAllowed(this.db, this.matrix, input.revision);
    const enc = await clinicalEncounter(this.db, this.access, input.encounterId, 'write');
    const display = await this.refDisplay('icd10', input.code);
    const tx = this.db.tx();
    if (input.kind === 'encounter' && input.role === 'utama')
      await lockClinicalKey(this.db, `primary:${enc.id}`);
    const f = await this.records.prepare('conditions', {
      patientId: enc.patientId,
      encounterId: enc.id,
      occurredAt: input.occurredAt,
      revision: input.revision,
    });
    if (input.kind === 'encounter' && input.role === 'utama') {
      const other = await tx.condition.findFirst({
        where: {
          encounterId: enc.id,
          kind: 'encounter',
          role: 'utama',
          status: 'final',
          rootId: { not: f.rootId },
          ...CURRENT,
        },
        select: { id: true },
      });
      if (other) {
        throw clinicalError('PRIMARY_DIAGNOSIS_EXISTS', { existingId: other.id });
      }
    }
    await this.records.insert(() =>
      tx.condition.create({
        data: {
          ...f,
          encounterId: enc.id,
          kind: input.kind,
          role: input.role,
          code: input.code,
          display,
          clinicalStatus: input.clinicalStatus,
          note: input.note,
        },
      }),
    );
    await this.satusehat.record('Condition', f.id, f.version);
    this.auditWrite('conditions', f, enc.patientId, { kind: input.kind, role: input.role });
    const row = await tx.condition.findUniqueOrThrow({ where: { id: f.id } });
    return (await this.presentConditions([row]))[0] as ConditionRecord;
  }

  async listConditions(encounterId: string): Promise<ConditionRecord[]> {
    const enc = await clinicalEncounter(this.db, this.access, encounterId, 'read');
    const rows = await this.db.tx().condition.findMany({
      where: { encounterId: enc.id, status: 'final', ...CURRENT },
      orderBy: [{ occurredAt: 'asc' }, { id: 'asc' }],
    });
    // Diagnosis utama dulu, lalu sekunder, komplikasi, problem list; di dalamnya menurut waktu kejadian.
    rows.sort((a, b) => ROLE_ORDER(a) - ROLE_ORDER(b));
    this.auditRead('condition', enc.patientId, { encounterId: enc.id, count: rows.length });
    return this.presentConditions(rows);
  }

  /** Problem list pasien: masalah final terkini dari SELURUH kelompok rekam medis (ADR-0016). */
  async problemList(patientId: string): Promise<ConditionRecord[]> {
    await clinicalPatient(this.db, this.access, patientId);
    const group = await patientGroupIds(this.db.tx(), patientId);
    const rows = await this.db.tx().condition.findMany({
      where: { patientId: { in: group }, kind: 'problem_list', status: 'final', ...CURRENT },
      orderBy: [{ occurredAt: 'desc' }, { id: 'desc' }],
    });
    this.auditRead('condition', patientId, { view: 'problem_list', count: rows.length });
    return this.presentConditions(rows);
  }

  // ------------------------------------------------------------------------------------------------------------
  // Prosedur
  // ------------------------------------------------------------------------------------------------------------

  async createProcedure(input: ProcedureInput): Promise<ProcedureRecord> {
    await assertRevisionAllowed(this.db, this.matrix, input.revision);
    const enc = await clinicalEncounter(this.db, this.access, input.encounterId, 'write');
    const display = await this.refDisplay('icd9cm', input.code);
    const tx = this.db.tx();
    const f = await this.records.prepare('procedures', {
      patientId: enc.patientId,
      encounterId: enc.id,
      occurredAt: input.occurredAt,
      revision: input.revision,
    });
    await this.records.insert(() =>
      tx.procedure.create({
        data: { ...f, encounterId: enc.id, code: input.code, display, note: input.note },
      }),
    );
    await this.satusehat.record('Procedure', f.id, f.version);
    // Biaya per rantai (bukan per versi): koreksi tidak menagih dua kali (ADR-0032 butir 2).
    await this.billable.record({
      encounterId: enc.id,
      patientId: enc.patientId,
      sourceType: 'procedures',
      sourceId: f.rootId,
      kind: 'tindakan',
      occurredAt: f.occurredAt,
    });
    this.auditWrite('procedures', f, enc.patientId, {});
    const row = await tx.procedure.findUniqueOrThrow({ where: { id: f.id } });
    return (await this.presentProcedures([row]))[0] as ProcedureRecord;
  }

  async listProcedures(encounterId: string): Promise<ProcedureRecord[]> {
    const enc = await clinicalEncounter(this.db, this.access, encounterId, 'read');
    const rows = await this.db.tx().procedure.findMany({
      where: { encounterId: enc.id, status: 'final', ...CURRENT },
      orderBy: [{ occurredAt: 'asc' }, { id: 'asc' }],
    });
    this.auditRead('procedure', enc.patientId, { encounterId: enc.id, count: rows.length });
    return this.presentProcedures(rows);
  }

  // ------------------------------------------------------------------------------------------------------------
  // Alergi + NKDA
  // ------------------------------------------------------------------------------------------------------------

  async createAllergy(input: AllergyInput): Promise<AllergyRecord> {
    await assertRevisionAllowed(this.db, this.matrix, input.revision);
    await clinicalPatient(this.db, this.access, input.patientId);
    const tx = this.db.tx();
    if (input.encounterId) {
      const enc = await clinicalEncounter(this.db, this.access, input.encounterId, 'write');
      if (enc.patientId !== input.patientId) {
        throw new AppError('VALIDATION_FAILED', 'Kunjungan bukan milik pasien ini', 422);
      }
    }
    if (input.substanceId) {
      const s = await tx.drugSubstance.findUnique({
        where: { id: input.substanceId },
        select: { active: true },
      });
      if (!s?.active) throw new AppError('VALIDATION_FAILED', 'Zat alergen tidak dikenal atau nonaktif', 422);
    }
    const group = await patientGroupIds(tx, input.patientId);
    await lockClinicalKey(this.db, `allergy:${[...group].sort()[0]}`);
    const f = await this.records.prepare('allergy_intolerances', {
      patientId: input.patientId,
      encounterId: input.encounterId,
      occurredAt: input.occurredAt,
      revision: input.revision,
    });
    // Rantai lain yang masih final dan terkini (rantai yang dikoreksi/ditambah addendum tidak dihitung).
    const excluded = [f.rootId];
    if (f.addendumOf) {
      const target = await tx.allergyIntolerance.findUnique({
        where: { id: f.addendumOf },
        select: { rootId: true },
      });
      if (target) excluded.push(target.rootId);
    }
    const others = await tx.allergyIntolerance.findMany({
      where: { patientId: { in: group }, status: 'final', rootId: { notIn: excluded }, ...CURRENT },
      select: { kind: true, substanceId: true },
    });
    if (input.kind === 'nkda' && others.length > 0) {
      throw new AppError(
        'CONFLICT',
        others.some((o) => o.kind === 'alergi')
          ? 'Pasien sudah tercatat beralergi; NKDA tidak bisa dicatat bersamaan'
          : 'NKDA sudah tercatat untuk pasien ini',
        409,
        { rule: 'nkda_exclusive' },
      );
    }
    if (input.kind === 'alergi' && others.some((o) => o.kind === 'nkda')) {
      throw new AppError(
        'CONFLICT',
        'Pasien tercatat tidak ada alergi obat (NKDA); koreksi atau tandai salah entri NKDA itu lebih dulu',
        409,
        { rule: 'nkda_exclusive' },
      );
    }
    if (input.substanceId && others.some((o) => o.substanceId === input.substanceId)) {
      throw new AppError('CONFLICT', 'Alergi zat ini sudah tercatat; koreksi entri yang ada', 409, {
        rule: 'one_entry_per_substance',
      });
    }
    await this.records.insert(() =>
      tx.allergyIntolerance.create({
        data: {
          ...f,
          kind: input.kind,
          substanceId: input.substanceId,
          text: input.text,
          category: input.category,
          criticality: input.criticality,
          reaction: input.reaction,
        },
      }),
    );
    await this.satusehat.record('AllergyIntolerance', f.id, f.version);
    this.auditWrite('allergies', f, input.patientId, { kind: input.kind });
    const row = await tx.allergyIntolerance.findUniqueOrThrow({
      where: { id: f.id },
      select: ALLERGY_SELECT,
    });
    return (await this.presentAllergies([row]))[0] as AllergyRecord;
  }

  async patientAllergies(patientId: string): Promise<PatientAllergies> {
    await clinicalPatient(this.db, this.access, patientId);
    const result = await this.allergiesOf(patientId);
    this.auditRead('allergy_intolerance', patientId, { count: result.allergies.length });
    return result;
  }

  /** Alergi final terkini kelompok rekam medis (tanpa ABAC/audit; pemanggil sudah memeriksa). */
  async allergiesOf(patientId: string): Promise<PatientAllergies> {
    const group = await patientGroupIds(this.db.tx(), patientId);
    const rows = await this.db.tx().allergyIntolerance.findMany({
      where: { patientId: { in: group }, status: 'final', ...CURRENT },
      orderBy: [{ occurredAt: 'asc' }, { id: 'asc' }],
      select: ALLERGY_SELECT,
    });
    const present = await this.presentAllergies(rows);
    const allergies = present.filter((a) => a.kind === 'alergi');
    const nkda = present.find((a) => a.kind === 'nkda') ?? null;
    return {
      status: allergies.length > 0 ? 'ada' : nkda ? 'nkda' : 'belum_dikaji',
      allergies,
      nkda: allergies.length > 0 ? null : nkda,
    };
  }

  // ------------------------------------------------------------------------------------------------------------
  // Salah entri
  // ------------------------------------------------------------------------------------------------------------

  async enteredInError(kind: DiagnosisEntryKind, id: string, reason: string): Promise<ClinicalEntryMeta> {
    const table = DIAGNOSIS_ENTRY_TABLES[kind];
    const owner = await this.ownerOf(kind, id);
    await this.access.assert(owner);
    const { id: newIdValue } = await this.records.enteredInError(table, id, reason);
    const meta = await this.metaOf(kind, newIdValue);
    await this.satusehat.record(SATUSEHAT[kind], meta.id, meta.version);
    this.db.audit({
      action: 'correct',
      resourceType: RESOURCE[kind],
      resourceId: meta.id,
      patientId: owner,
      reason,
      details: { version: meta.version, status: 'entered_in_error', supersedesId: id },
    });
    return meta;
  }

  // ------------------------------------------------------------------------------------------------------------

  private async ownerOf(kind: DiagnosisEntryKind, id: string): Promise<string> {
    const tx = this.db.tx();
    const row =
      kind === 'conditions'
        ? await tx.condition.findUnique({ where: { id }, select: { patientId: true } })
        : kind === 'procedures'
          ? await tx.procedure.findUnique({ where: { id }, select: { patientId: true } })
          : await tx.allergyIntolerance.findUnique({ where: { id }, select: { patientId: true } });
    if (!row) throw new AppError('NOT_FOUND', 'Entri klinis tidak ditemukan', 404);
    return row.patientId;
  }

  private async metaOf(kind: DiagnosisEntryKind, id: string): Promise<ClinicalEntryMeta> {
    const tx = this.db.tx();
    const table = DIAGNOSIS_ENTRY_TABLES[kind];
    const row =
      kind === 'conditions'
        ? await tx.condition.findUniqueOrThrow({ where: { id } })
        : kind === 'procedures'
          ? await tx.procedure.findUniqueOrThrow({ where: { id } })
          : await tx.allergyIntolerance.findUniqueOrThrow({ where: { id } });
    return (await this.records.meta(table, [row])).get(id) as ClinicalEntryMeta;
  }

  private async refDisplay(system: 'icd10' | 'icd9cm', code: string): Promise<string> {
    const concept = await getConcept(this.db.tx(), system, code);
    if (!concept?.active) {
      throw new AppError(
        'VALIDATION_FAILED',
        `Kode ${code} tidak ada di data rujukan ${system === 'icd10' ? 'ICD-10' : 'ICD-9-CM'}`,
        422,
        { fields: ['code'] },
      );
    }
    return concept.display;
  }

  private auditWrite(
    kind: DiagnosisEntryKind,
    f: { id: string; version: number; supersedesId: string | null; addendumOf: string | null },
    patientId: string,
    details: Record<string, unknown>,
  ): void {
    this.db.audit({
      action: f.supersedesId ? 'correct' : 'create',
      resourceType: RESOURCE[kind],
      resourceId: f.id,
      patientId,
      details: { version: f.version, addendumOf: f.addendumOf, ...details },
    });
  }

  private auditRead(resourceType: string, patientId: string, details: Record<string, unknown>): void {
    this.db.audit({ action: 'read', resourceType, patientId, details });
  }

  async presentConditions(
    rows: Array<Parameters<ClinicalRecordService['meta']>[1][number] & ConditionFields>,
  ): Promise<ConditionRecord[]> {
    const meta = await this.records.meta('conditions', rows);
    return rows.map((r) => ({
      ...(meta.get(r.id) as ClinicalEntryMeta),
      patientId: r.patientId,
      encounterId: r.encounterId,
      kind: r.kind as ConditionRecord['kind'],
      role: r.role as ConditionRecord['role'],
      code: r.code,
      display: r.display,
      clinicalStatus: r.clinicalStatus as ConditionRecord['clinicalStatus'],
      note: r.note,
    }));
  }

  async presentProcedures(
    rows: Array<Parameters<ClinicalRecordService['meta']>[1][number] & ProcedureFields>,
  ): Promise<ProcedureRecord[]> {
    const meta = await this.records.meta('procedures', rows);
    return rows.map((r) => ({
      ...(meta.get(r.id) as ClinicalEntryMeta),
      patientId: r.patientId,
      encounterId: r.encounterId,
      code: r.code,
      display: r.display,
      note: r.note,
    }));
  }

  async presentAllergies(
    rows: Array<Parameters<ClinicalRecordService['meta']>[1][number] & AllergyFields>,
  ): Promise<AllergyRecord[]> {
    const meta = await this.records.meta('allergy_intolerances', rows);
    return rows.map((r) => ({
      ...(meta.get(r.id) as ClinicalEntryMeta),
      patientId: r.patientId,
      encounterId: r.encounterId,
      kind: r.kind as AllergyRecord['kind'],
      substance: r.substance,
      text: r.text,
      category: r.category as AllergyRecord['category'],
      criticality: r.criticality as AllergyRecord['criticality'],
      reaction: r.reaction,
    }));
  }
}

interface ConditionFields {
  patientId: string;
  encounterId: string;
  kind: string;
  role: string | null;
  code: string;
  display: string;
  clinicalStatus: string;
  note: string | null;
}
interface ProcedureFields {
  patientId: string;
  encounterId: string;
  code: string;
  display: string;
  note: string | null;
}
interface AllergyFields {
  patientId: string;
  encounterId: string | null;
  kind: string;
  text: string | null;
  category: string | null;
  criticality: string | null;
  reaction: string | null;
  substance: { id: string; code: string; name: string } | null;
}
