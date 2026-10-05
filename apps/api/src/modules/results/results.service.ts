import { Injectable } from '@nestjs/common';
import { getConcept, type Prisma } from '@simrs/db';
import {
  AppError,
  type ClinicalEntryMeta,
  type DiagnosticReportRecord,
  type PatientResults,
  RESULT_CATEGORIES,
  type ResultObservationInput,
  type ResultObservationItem,
  type ResultObservationRecord,
  type ResultReportInput,
} from '@simrs/shared';
import {
  type ClinicalEncounter,
  clinicalEncounter,
  clinicalPatient,
  patientGroupIds,
} from '../../infra/clinical/clinical-context';
import { ClinicalRecordService, type ClinicalRowLike } from '../../infra/clinical/clinical-record.service';
import { SatusehatRecorder } from '../../infra/clinical/staging';
import { TenantDb } from '../../infra/tenant-db';
import { PatientAccessService } from '../authz/patient-access.service';

const CURRENT = { supersededBy: { none: {} } } as const;

export type ObservationRow = ClinicalRowLike & {
  patientId: string;
  encounterId: string;
  category: string;
  code: string | null;
  display: string;
  valueNumeric: Prisma.Decimal | null;
  valueUnit: string | null;
  valueText: string | null;
  interpretation: string | null;
  referenceRange: string | null;
  diagnosticReportId: string | null;
};

/**
 * K08 · Muara hasil penunjang (keputusan fase 3 no. 12, rencana §3.2a): observasi lab/imaging/survei + laporan
 * diagnostik, berversi lewat `ClinicalRecordService`. Izin `result.write` (analis lab/radiografer, lingkup semua
 * pasien selama input manual MVP); koreksi oleh penulis asli dengan izin yang sama. Kode LOINC hanya dari data
 * rujukan; nama pemeriksaan diambil dari sana. Fase 4 menulis ke tabel yang sama setelah validasi penunjang.
 * Staging SATUSEHAT `held` Observation/DiagnosticReport per versi (ADR-0032).
 */
@Injectable()
export class ResultsService {
  constructor(
    private readonly db: TenantDb,
    private readonly records: ClinicalRecordService,
    private readonly access: PatientAccessService,
    private readonly satusehat: SatusehatRecorder,
  ) {}

  async createObservation(input: ResultObservationInput): Promise<ResultObservationRecord> {
    const enc = await clinicalEncounter(this.db, this.access, input.encounterId, 'write');
    if (input.diagnosticReportId) await this.assertReport(input.diagnosticReportId, enc.id);
    const r = input.revision;
    const targetId = r.kind === 'koreksi' ? r.supersedesId : r.kind === 'addendum' ? r.addendumOf : null;
    if (targetId) {
      const target = await this.db.tx().observation.findUnique({
        where: { id: targetId },
        select: { category: true },
      });
      if (target?.category === 'vital') {
        throw new AppError(
          'VALIDATION_FAILED',
          'Tanda vital dikoreksi dari layar observasi keperawatan',
          422,
        );
      }
    }
    const id = await this.insertObservation(
      enc,
      input,
      input.occurredAt,
      input.revision,
      input.diagnosticReportId,
    );
    const row = await this.db.tx().observation.findUniqueOrThrow({ where: { id } });
    return (await this.presentObservations([row]))[0] as ResultObservationRecord;
  }

  async createReport(input: ResultReportInput): Promise<DiagnosticReportRecord> {
    const enc = await clinicalEncounter(this.db, this.access, input.encounterId, 'write');
    const display = input.code ? await this.loincDisplay(input.code) : (input.display as string);
    const tx = this.db.tx();
    const f = await this.records.prepare('diagnostic_reports', {
      patientId: enc.patientId,
      encounterId: enc.id,
      occurredAt: input.occurredAt,
      revision: input.revision,
    });
    await this.records.insert(() =>
      tx.diagnosticReport.create({
        data: {
          ...f,
          encounterId: enc.id,
          category: input.category,
          codeSystem: input.code ? 'loinc' : null,
          code: input.code,
          display,
          conclusion: input.conclusion,
        },
      }),
    );
    await this.satusehat.record('DiagnosticReport', f.id, f.version);
    for (const item of input.observations) {
      await this.insertObservation(enc, item, input.occurredAt, { kind: 'baru' }, f.id);
    }
    this.db.audit({
      action: f.supersedesId ? 'correct' : 'create',
      resourceType: 'diagnostic_report',
      resourceId: f.id,
      patientId: enc.patientId,
      details: { version: f.version, category: input.category, observations: input.observations.length },
    });
    const [report] = await this.reportsWithObservations([f.id]);
    return report as DiagnosticReportRecord;
  }

  async list(q: { patientId: string; encounterId?: string; limit: number }): Promise<PatientResults> {
    await clinicalPatient(this.db, this.access, q.patientId);
    const tx = this.db.tx();
    const group = await patientGroupIds(tx, q.patientId);
    const scope = { patientId: { in: group }, ...(q.encounterId ? { encounterId: q.encounterId } : {}) };
    const reportRows = await tx.diagnosticReport.findMany({
      where: { ...scope, status: 'final', ...CURRENT },
      orderBy: [{ occurredAt: 'desc' }, { id: 'desc' }],
      take: q.limit,
      select: { id: true },
    });
    const reports = await this.reportsWithObservations(reportRows.map((r) => r.id));
    const loose = await tx.observation.findMany({
      where: {
        ...scope,
        category: { in: [...RESULT_CATEGORIES] },
        diagnosticReportId: null,
        status: 'final',
        ...CURRENT,
      },
      orderBy: [{ occurredAt: 'desc' }, { id: 'desc' }],
      take: q.limit,
    });
    this.db.audit({
      action: 'read',
      resourceType: 'observation',
      patientId: q.patientId,
      details: { view: 'results', reports: reports.length, observations: loose.length },
    });
    return { reports, observations: await this.presentObservations(loose) };
  }

  /** Salah entri hasil (bukan tanda vital; tanda vital lewat modul observasi keperawatan). */
  async enteredInError(kind: 'observations' | 'diagnostic_reports', id: string, reason: string) {
    const tx = this.db.tx();
    const target =
      kind === 'observations'
        ? await tx.observation.findUnique({ where: { id }, select: { patientId: true, category: true } })
        : await tx.diagnosticReport.findUnique({
            where: { id },
            select: { patientId: true, category: true },
          });
    if (!target) throw new AppError('NOT_FOUND', 'Hasil tidak ditemukan', 404);
    if (kind === 'observations' && target.category === 'vital') {
      throw new AppError('VALIDATION_FAILED', 'Tanda vital dikoreksi dari layar observasi keperawatan', 422);
    }
    await this.access.assert(target.patientId);
    const done = await this.records.enteredInError(kind, id, reason);
    const meta = await this.metaOf(kind, done.id);
    await this.satusehat.record(
      kind === 'observations' ? 'Observation' : 'DiagnosticReport',
      meta.id,
      meta.version,
    );
    this.db.audit({
      action: 'correct',
      resourceType: kind === 'observations' ? 'observation' : 'diagnostic_report',
      resourceId: meta.id,
      patientId: target.patientId,
      reason,
      details: { version: meta.version, status: 'entered_in_error', supersedesId: id },
    });
    return meta;
  }

  /** Hasil terbaru kelompok rekam medis (ringkasan pasien K14), tanpa ABAC/audit (pemanggil sudah memeriksa). */
  async recentObservations(group: string[], limit: number): Promise<ResultObservationRecord[]> {
    const rows = await this.db.tx().observation.findMany({
      where: {
        patientId: { in: group },
        category: { in: [...RESULT_CATEGORIES] },
        status: 'final',
        ...CURRENT,
      },
      orderBy: [{ occurredAt: 'desc' }, { id: 'desc' }],
      take: limit,
    });
    return this.presentObservations(rows);
  }

  async presentObservations(rows: ObservationRow[]): Promise<ResultObservationRecord[]> {
    const meta = await this.records.meta('observations', rows);
    return rows.map((r) => ({
      ...(meta.get(r.id) as ClinicalEntryMeta),
      patientId: r.patientId,
      encounterId: r.encounterId,
      category: r.category as ResultObservationRecord['category'],
      code: r.code,
      display: r.display,
      valueNumeric: r.valueNumeric === null ? null : Number(r.valueNumeric),
      valueUnit: r.valueUnit,
      valueText: r.valueText,
      interpretation: r.interpretation as ResultObservationRecord['interpretation'],
      referenceRange: r.referenceRange,
      diagnosticReportId: r.diagnosticReportId,
    }));
  }

  // ------------------------------------------------------------------------------------------------------------

  private async insertObservation(
    enc: ClinicalEncounter,
    item: ResultObservationItem,
    occurredAt: string,
    revision: ResultObservationInput['revision'],
    diagnosticReportId: string | null,
  ): Promise<string> {
    const display = item.code ? await this.loincDisplay(item.code) : (item.display as string);
    const f = await this.records.prepare('observations', {
      patientId: enc.patientId,
      encounterId: enc.id,
      occurredAt,
      revision,
    });
    await this.records.insert(() =>
      this.db.tx().observation.create({
        data: {
          ...f,
          encounterId: enc.id,
          category: item.category,
          codeSystem: item.code ? 'loinc' : null,
          code: item.code,
          display,
          valueNumeric: item.valueNumeric,
          valueUnit: item.valueUnit,
          valueText: item.valueText,
          interpretation: item.interpretation,
          referenceRange: item.referenceRange,
          diagnosticReportId,
        },
      }),
    );
    await this.satusehat.record('Observation', f.id, f.version);
    this.db.audit({
      action: f.supersedesId ? 'correct' : 'create',
      resourceType: 'observation',
      resourceId: f.id,
      patientId: enc.patientId,
      details: { version: f.version, category: item.category, interpretation: item.interpretation },
    });
    return f.id;
  }

  /** Laporan + hasil terkini yang terhubung ke versi mana pun dari rantai laporan itu. */
  private async reportsWithObservations(ids: string[]): Promise<DiagnosticReportRecord[]> {
    if (ids.length === 0) return [];
    const tx = this.db.tx();
    const reports = await tx.diagnosticReport.findMany({ where: { id: { in: ids } } });
    const order = new Map(ids.map((id, i) => [id, i]));
    reports.sort((a, b) => (order.get(a.id) ?? 0) - (order.get(b.id) ?? 0));
    const chain = await tx.diagnosticReport.findMany({
      where: { rootId: { in: reports.map((r) => r.rootId) } },
      select: { id: true, rootId: true },
    });
    const rootOf = new Map(chain.map((c) => [c.id, c.rootId]));
    const obs = await tx.observation.findMany({
      where: { diagnosticReportId: { in: [...rootOf.keys()] }, status: 'final', ...CURRENT },
      orderBy: [{ occurredAt: 'asc' }, { id: 'asc' }],
    });
    const presentedObs = await this.presentObservations(obs);
    const meta = await this.records.meta('diagnostic_reports', reports);
    return reports.map((r) => ({
      ...(meta.get(r.id) as ClinicalEntryMeta),
      patientId: r.patientId,
      encounterId: r.encounterId,
      category: r.category as DiagnosticReportRecord['category'],
      code: r.code,
      display: r.display,
      conclusion: r.conclusion,
      observations: presentedObs.filter(
        (o) => o.diagnosticReportId && rootOf.get(o.diagnosticReportId) === r.rootId,
      ),
    }));
  }

  private async assertReport(reportId: string, encounterId: string): Promise<void> {
    const r = await this.db.tx().diagnosticReport.findUnique({
      where: { id: reportId },
      select: { encounterId: true },
    });
    if (!r || r.encounterId !== encounterId) {
      throw new AppError('VALIDATION_FAILED', 'Laporan hasil bukan milik kunjungan ini', 422);
    }
  }

  private async loincDisplay(code: string): Promise<string> {
    const concept = await getConcept(this.db.tx(), 'loinc', code);
    if (!concept?.active) {
      throw new AppError('VALIDATION_FAILED', `Kode ${code} tidak ada di data rujukan LOINC`, 422, {
        fields: ['code'],
      });
    }
    return concept.display;
  }

  private async metaOf(kind: 'observations' | 'diagnostic_reports', id: string): Promise<ClinicalEntryMeta> {
    const tx = this.db.tx();
    const row =
      kind === 'observations'
        ? await tx.observation.findUniqueOrThrow({ where: { id } })
        : await tx.diagnosticReport.findUniqueOrThrow({ where: { id } });
    return (await this.records.meta(kind, [row])).get(id) as ClinicalEntryMeta;
  }
}
