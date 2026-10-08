import { Injectable } from '@nestjs/common';
import { Prisma } from '@simrs/db';
import {
  AppError,
  DIAGNOSTIC_FORMS,
  DIAGNOSTIC_KIND_CODES,
  DIAGNOSTIC_KIND_LABEL,
  DIAGNOSTIC_KINDS,
  type DiagnosticKind,
  diagnosticKindOf,
  type DiagnosticReportCreateInput,
  type DiagnosticFormInput,
  type DiagnosticReportS10,
  type DiagnosticWorklist,
  type DiagnosticWorklistItem,
} from '@simrs/shared';
import { ClinicalRecordService } from '../../infra/clinical/clinical-record.service';
import { ClinicalSigningService } from '../../infra/clinical/clinical-signing.service';
import { assertSupportItem, patientsLite, supportScope } from '../../infra/clinical/support-access';
import { DomainEvents } from '../../infra/events/domain-events';
import { TenantDb } from '../../infra/tenant-db';
import { PatientAccessService } from '../authz/patient-access.service';
import { FormResponsesService } from '../forms/form-responses.service';

const CURRENT = { supersededBy: { none: {} } } as const;
const MAX_ITEMS = 200;

type ReportRow = Prisma.DiagnosticReportGetPayload<object>;

/**
 * S10 · Diagnostik lain (EKG, USG, echo, endoskopi, treadmill; rencana fase 4 §4.8, ADR-0120): worklist = order F3-1
 * ber-kode ICD-9-CM jenis S10 yang aktif; laporan = entri berversi `diagnostic_reports` fase 3 (kategori `lainnya`,
 * jenis, isian P07 `diag_<jenis>`, lampiran P08, kesimpulan); TTE dokter (`diagnostics.sign`) lewat
 * `ClinicalSigningService` lalu event `diagnostic.report_signed`. Laporan tampil di panel hasil fase 3 (F3-9) karena
 * memakai tabel hasil yang sama.
 */
@Injectable()
export class DiagnosticsService {
  constructor(
    private readonly db: TenantDb,
    private readonly access: PatientAccessService,
    private readonly records: ClinicalRecordService,
    private readonly signing: ClinicalSigningService,
    private readonly events: DomainEvents,
    private readonly forms: FormResponsesService,
  ) {}

  /** Isian P07 `diag_<jenis>` untuk order ini (akses = aturan order S10; hak tulis profesi tetap dari formulir). */
  async fillForm(serviceRequestId: string, input: DiagnosticFormInput): Promise<{ formResponseId: string }> {
    const { sr, kind } = await this.requestFor(serviceRequestId);
    if (sr.encounter.status === 'cancelled')
      throw new AppError('CONFLICT', 'Kunjungan sudah dibatalkan', 409);
    const r = await this.forms.create(
      sr.patientId,
      DIAGNOSTIC_FORMS[kind].code,
      input.answers,
      sr.encounterId,
      {
        accessChecked: true,
      },
    );
    this.db.audit({
      action: 'create',
      resourceType: 'form_response',
      resourceId: r.id,
      patientId: sr.patientId,
      details: { form: DIAGNOSTIC_FORMS[kind].code, serviceRequestId: sr.id },
    });
    return { formResponseId: r.id };
  }

  /** Predikat SQL kode S10 untuk order `sr`. */
  private codeSql() {
    const prefixes = DIAGNOSTIC_KINDS.flatMap((k) => DIAGNOSTIC_KIND_CODES[k].map((p) => `${p}%`));
    return Prisma.sql`sr.code_system = 'icd9cm' AND sr.code LIKE ANY(${prefixes}::text[])`;
  }

  async worklist(): Promise<DiagnosticWorklist> {
    const tx = this.db.tx();
    const now = new Date();
    const scope = await supportScope(this.db, this.access);
    if ('none' in scope) return { serverNow: now.toISOString(), view: scope.view, items: [] };
    const abac = scope.view === 'ruangan' ? Prisma.sql`AND ${scope.filter}` : Prisma.empty;
    const since = new Date(now.getTime() - 7 * 86_400_000);
    const rows = await tx.$queryRaw<Array<{ id: string; patient_id: string }>>`
      SELECT sr.id::text AS id, sr.patient_id::text AS patient_id
      FROM service_requests sr
      JOIN patients p ON p.tenant_id = sr.tenant_id AND p.id = sr.patient_id
      WHERE ${this.codeSql()}
        AND coalesce((SELECT e.status FROM order_status_events e WHERE e.tenant_id = sr.tenant_id
                        AND e.service_request_id = sr.id ORDER BY e.changed_at DESC, e.id DESC LIMIT 1), 'aktif')
            <> 'dibatalkan'
        AND (sr.created_at >= ${since} OR NOT EXISTS (
              SELECT 1 FROM diagnostic_reports d WHERE d.tenant_id = sr.tenant_id AND d.service_request_id = sr.id))
        ${abac}
      ORDER BY (sr.priority = 'cito') DESC, sr.created_at, sr.id
      LIMIT ${MAX_ITEMS}`;
    const srs = await tx.serviceRequest.findMany({ where: { id: { in: rows.map((r) => r.id) } } });
    const reports = await tx.diagnosticReport.findMany({
      where: { serviceRequestId: { in: srs.map((s) => s.id) }, ...CURRENT, addendumOf: null },
      orderBy: [{ recordedAt: 'desc' }],
    });
    const recs = await this.toRecords(reports);
    const patients = await patientsLite(
      tx,
      srs.map((s) => s.encounterId),
    );
    const byId = new Map(srs.map((s) => [s.id, s]));
    const items: DiagnosticWorklistItem[] = [];
    for (const r of rows) {
      const sr = byId.get(r.id);
      const kind = diagnosticKindOf(sr?.code ?? null);
      const p = sr ? patients.get(sr.encounterId) : undefined;
      if (!sr || !kind || !p) continue;
      const { unitId: _u, ...patient } = p;
      items.push({
        serviceRequestId: sr.id,
        encounterId: sr.encounterId,
        patient,
        kind,
        name: sr.name,
        priority: sr.priority,
        orderedAt: sr.createdAt.toISOString(),
        report: recs.find((x) => x.serviceRequestId === sr.id) ?? null,
      });
    }
    for (const pid of new Set(rows.map((r) => r.patient_id))) {
      this.db.audit({ action: 'read', resourceType: 'diagnostic_worklist', patientId: pid });
    }
    return { serverNow: now.toISOString(), view: scope.view, items };
  }

  /** Order S10 + akses (layanan: order ≤ 7 hari atau belum berlaporan; ruangan: ABAC pasien). */
  private async requestFor(serviceRequestId: string) {
    const tx = this.db.tx();
    const sr = await tx.serviceRequest.findUnique({
      where: { id: serviceRequestId },
      include: { encounter: { select: { id: true, number: true, unitId: true, status: true } } },
    });
    const kind = diagnosticKindOf(sr?.codeSystem === 'icd9cm' ? (sr?.code ?? null) : null);
    if (!sr || !kind) throw new AppError('NOT_FOUND', 'Order diagnostik tidak ditemukan', 404);
    const scope = await supportScope(this.db, this.access);
    const recent = Date.now() - sr.createdAt.getTime() <= 7 * 86_400_000;
    await assertSupportItem(scope, this.access, sr.patientId, recent);
    return { sr, kind };
  }

  async create(input: DiagnosticReportCreateInput): Promise<DiagnosticReportS10> {
    const { sr, kind } = await this.requestFor(input.serviceRequestId);
    if (kind !== input.kind) {
      throw new AppError('VALIDATION_FAILED', `Order ini adalah ${DIAGNOSTIC_KIND_LABEL[kind]}`, 422, {
        fields: ['kind'],
      });
    }
    if (sr.encounter.status === 'cancelled')
      throw new AppError('CONFLICT', 'Kunjungan sudah dibatalkan', 409);
    const tx = this.db.tx();
    const resp = await tx.formResponse.findUnique({
      where: { id: input.formResponseId },
      select: {
        patientId: true,
        encounterId: true,
        status: true,
        definition: { select: { code: true } },
        supersededBy: { select: { id: true } },
      },
    });
    if (
      !resp ||
      resp.patientId !== sr.patientId ||
      resp.encounterId !== sr.encounterId ||
      resp.status !== 'final' ||
      resp.supersededBy.length > 0 ||
      resp.definition.code !== DIAGNOSTIC_FORMS[kind].code
    ) {
      throw new AppError(
        'VALIDATION_FAILED',
        `Isian formulir harus ${DIAGNOSTIC_FORMS[kind].title} terkini untuk kunjungan ini`,
        422,
        { fields: ['formResponseId'] },
      );
    }
    if (input.documentIds.length > 0) {
      const n = await tx.document.count({
        where: { id: { in: input.documentIds }, patientId: sr.patientId, voidedAt: null },
      });
      if (n !== new Set(input.documentIds).size) {
        throw new AppError('VALIDATION_FAILED', 'Lampiran harus dokumen aktif milik pasien ini', 422, {
          fields: ['documentIds'],
        });
      }
    }
    const existing = await tx.diagnosticReport.findFirst({
      where: { serviceRequestId: sr.id, ...CURRENT, addendumOf: null },
      select: { id: true },
    });
    if (existing) {
      throw new AppError('CONFLICT', 'Order ini sudah berlaporan; gunakan koreksi atau addendum', 409);
    }
    const f = await this.records.prepare('diagnostic_reports', {
      patientId: sr.patientId,
      encounterId: sr.encounterId,
      occurredAt: input.occurredAt,
      revision: { kind: 'baru' },
    });
    await this.records.insert(() =>
      tx.diagnosticReport.create({
        data: {
          ...f,
          encounterId: sr.encounterId,
          category: 'lainnya',
          display: `${DIAGNOSTIC_KIND_LABEL[kind]}: ${sr.name}`.slice(0, 200),
          conclusion: input.conclusion,
          serviceRequestId: sr.id,
          kind,
          formResponseId: input.formResponseId,
          documentIds: input.documentIds,
        },
      }),
    );
    this.db.audit({
      action: 'create',
      resourceType: 'diagnostic_report',
      resourceId: f.id,
      patientId: sr.patientId,
      details: { kind, serviceRequestId: sr.id },
    });
    const row = await tx.diagnosticReport.findUniqueOrThrow({ where: { id: f.id } });
    return (await this.toRecords([row]))[0] as DiagnosticReportS10;
  }

  /** TTE dokter pelaksana atas versi terkini; event `diagnostic.report_signed`. */
  async sign(id: string): Promise<DiagnosticReportS10> {
    this.records.author();
    const tx = this.db.tx();
    const row = await tx.diagnosticReport.findUnique({ where: { id } });
    if (!row?.kind || !row.serviceRequestId)
      throw new AppError('NOT_FOUND', 'Laporan diagnostik tidak ditemukan', 404);
    const { sr } = await this.requestFor(row.serviceRequestId);
    if ((await this.records.lockedIds('diagnostic_reports', [row.id])).has(row.id)) {
      throw new AppError('CONFLICT', 'Laporan ini sudah ditandatangani', 409);
    }
    const kind = row.kind as DiagnosticKind;
    const unit = await tx.unit.findUniqueOrThrow({
      where: { id: sr.encounter.unitId },
      select: { name: true },
    });
    const answers = row.formResponseId
      ? await tx.formResponse.findUnique({ where: { id: row.formResponseId }, select: { answers: true } })
      : null;
    const fields = DIAGNOSTIC_FORMS[kind].schema.sections.flatMap((s) => s.fields);
    const ans = (answers?.answers ?? {}) as Record<string, unknown>;
    await this.signing.issueSigned('diagnostic_reports', row.id, {
      patientId: row.patientId,
      kind: 'hasil',
      title: `Laporan ${DIAGNOSTIC_KIND_LABEL[kind]}`,
      fileName: `${kind} ${sr.encounter.number}`,
      issuedAt: row.recordedAt,
      patientExtra: [
        { label: 'Kunjungan', value: sr.encounter.number },
        { label: 'Unit', value: unit.name },
        { label: 'Order', value: sr.name },
      ],
      sections: [
        {
          title: 'Temuan',
          blocks: [
            {
              kind: 'fields',
              rows: fields
                .filter((fd) => ans[fd.key] !== undefined && ans[fd.key] !== null && ans[fd.key] !== '')
                .map((fd) => {
                  const v = ans[fd.key];
                  const opt = 'options' in fd ? fd.options?.find((o) => o.value === v) : undefined;
                  return { label: fd.label, value: opt?.label ?? String(v) };
                }),
            },
          ],
        },
        { title: 'Kesimpulan', blocks: [{ kind: 'paragraph', text: row.conclusion ?? '–' }] },
        ...(row.documentIds.length
          ? [
              {
                title: 'Lampiran',
                blocks: [
                  {
                    kind: 'paragraph' as const,
                    text: `${row.documentIds.length} lampiran di berkas pasien.`,
                  },
                ],
              },
            ]
          : []),
      ],
      tte: { role: `Dokter pelaksana ${DIAGNOSTIC_KIND_LABEL[kind]}`, caption: null },
      accessChecked: true,
    });
    await this.events.publish('diagnostic.report_signed', {
      diagnosticReportId: row.id,
      serviceRequestId: row.serviceRequestId,
      encounterId: row.encounterId,
      patientId: row.patientId,
      unitId: sr.encounter.unitId,
      kind,
    });
    this.db.audit({
      action: 'sign',
      resourceType: 'diagnostic_report',
      resourceId: row.id,
      patientId: row.patientId,
    });
    return (await this.toRecords([row]))[0] as DiagnosticReportS10;
  }

  private async toRecords(rows: ReportRow[]): Promise<DiagnosticReportS10[]> {
    if (rows.length === 0) return [];
    const meta = await this.records.meta('diagnostic_reports', rows);
    const docs = await this.db.tx().document.findMany({
      where: { sourceType: 'diagnostic_reports', sourceId: { in: rows.map((r) => r.id) }, voidedAt: null },
      select: { id: true, sourceId: true },
    });
    return rows.flatMap((r) => {
      const m = meta.get(r.id);
      if (!m || !r.encounterId) return [];
      return [
        {
          meta: m,
          encounterId: r.encounterId,
          serviceRequestId: r.serviceRequestId,
          kind: (r.kind as DiagnosticKind | null) ?? null,
          display: r.display,
          conclusion: r.conclusion,
          formResponseId: r.formResponseId,
          documentIds: r.documentIds,
          documentId: docs.find((d) => d.sourceId === r.id)?.id ?? null,
        },
      ];
    });
  }
}
