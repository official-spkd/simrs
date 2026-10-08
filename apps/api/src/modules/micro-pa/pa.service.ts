import { Injectable } from '@nestjs/common';
import { Prisma } from '@simrs/db';
import { AppError, type PaReportCreateInput, type PaReportRecord, type PaWorklist } from '@simrs/shared';
import { ClinicalRecordService } from '../../infra/clinical/clinical-record.service';
import { ClinicalSigningService } from '../../infra/clinical/clinical-signing.service';
import {
  assertSupportItem,
  inSupportWindow,
  patientsLite,
  supportScope,
} from '../../infra/clinical/support-access';
import { DomainEvents } from '../../infra/events/domain-events';
import { TenantDb } from '../../infra/tenant-db';
import { PatientAccessService } from '../authz/patient-access.service';

const CURRENT = { supersededBy: { none: {} } } as const;

type PaRow = {
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
  patientId: string;
  encounterId: string;
  surgeryCaseId: string | null;
  specimenSite: string;
  macroscopic: string;
  microscopic: string;
  diagnosis: string;
  icd10: string | null;
  imageDocumentIds: string[];
  surgerySpecimenId: string | null;
};

/**
 * S02 · Patologi anatomi (rencana fase 4 §4.8, ADR-0120): laporan berversi ADR-0028 di `pa_reports` (baru, koreksi
 * sebelum TTE, addendum sesudahnya) berisi makroskopik/mikroskopik/diagnosis + ICD-10 + gambar (dokumen pasien P08),
 * TTE dokter (Sp.PA) lewat `ClinicalSigningService` (versi ber-TTE terkunci, `RECORD_LOCKED`), event
 * `pa.report_signed`. Akses: dokter di unit penunjang = tampilan layanan (kunjungan berjalan + 7 hari).
 */
@Injectable()
export class PaService {
  constructor(
    private readonly db: TenantDb,
    private readonly access: PatientAccessService,
    private readonly records: ClinicalRecordService,
    private readonly signing: ClinicalSigningService,
    private readonly events: DomainEvents,
  ) {}

  private async encounterFor(encounterId: string) {
    const enc = await this.db.tx().encounter.findUnique({
      where: { id: encounterId },
      select: { id: true, patientId: true, status: true, endedAt: true, unitId: true, number: true },
    });
    if (!enc) throw new AppError('NOT_FOUND', 'Kunjungan tidak ditemukan', 404);
    const scope = await supportScope(this.db, this.access);
    await assertSupportItem(
      scope,
      this.access,
      enc.patientId,
      inSupportWindow(enc.status === 'in_progress', enc.endedAt),
    );
    if (enc.status === 'cancelled') throw new AppError('CONFLICT', 'Kunjungan sudah dibatalkan', 409);
    return enc;
  }

  /**
   * Worklist PA: spesimen kamar operasi yang dikirim (`surgery_specimens`, 4.7b), terbaru + belum berlaporan atau
   * dikirim ≤ 7 hari. Tampilan layanan (dokter unit penunjang) melihat semua; selain itu disaring ABAC pasien.
   */
  async worklist(): Promise<PaWorklist> {
    const tx = this.db.tx();
    const now = new Date();
    const scope = await supportScope(this.db, this.access);
    if ('none' in scope) return { serverNow: now.toISOString(), view: scope.view, items: [] };
    const abac = scope.view === 'ruangan' ? Prisma.sql`AND ${scope.filter}` : Prisma.empty;
    const since = new Date(now.getTime() - 7 * 86_400_000);
    const rows = await tx.$queryRaw<Array<{ id: string; patient_id: string }>>`
      SELECT s.id::text AS id, c.patient_id::text AS patient_id
      FROM surgery_specimens s
      JOIN surgery_cases c ON c.tenant_id = s.tenant_id AND c.id = s.surgery_case_id
      JOIN patients p ON p.tenant_id = c.tenant_id AND p.id = c.patient_id
      WHERE (s.sent_at >= ${since} OR NOT EXISTS (
               SELECT 1 FROM pa_reports r WHERE r.tenant_id = s.tenant_id AND r.surgery_specimen_id = s.id))
        ${abac}
      ORDER BY s.cito DESC, s.sent_at, s.id
      LIMIT 200`;
    const specimens = await tx.surgerySpecimen.findMany({
      where: { id: { in: rows.map((r) => r.id) } },
      include: { surgeryCase: { select: { caseNo: true, encounterId: true } } },
    });
    const reports = await tx.paReport.findMany({
      where: { surgerySpecimenId: { in: specimens.map((x) => x.id) }, addendumOf: null, ...CURRENT },
    });
    const recs = await this.toRecords(reports);
    const patients = await patientsLite(
      tx,
      specimens.map((x) => x.surgeryCase.encounterId),
    );
    const byId = new Map(specimens.map((x) => [x.id, x]));
    for (const pid of new Set(rows.map((r) => r.patient_id))) {
      this.db.audit({ action: 'read', resourceType: 'pa_worklist', patientId: pid });
    }
    return {
      serverNow: now.toISOString(),
      view: scope.view,
      items: rows.flatMap((r) => {
        const sp = byId.get(r.id);
        const p = sp ? patients.get(sp.surgeryCase.encounterId) : undefined;
        if (!sp || !p) return [];
        const { unitId: _u, ...patient } = p;
        return [
          {
            surgerySpecimenId: sp.id,
            labelNo: `${sp.surgeryCase.caseNo}-S${sp.seq}`,
            site: sp.site,
            examination: sp.examination,
            clinicalNote: sp.clinicalNote,
            cito: sp.cito,
            sentAt: sp.sentAt.toISOString(),
            encounterId: sp.surgeryCase.encounterId,
            surgeryCaseId: sp.surgeryCaseId,
            patient,
            report: recs.find((x) => x.surgerySpecimenId === sp.id) ?? null,
          },
        ];
      }),
    };
  }

  async listForEncounter(encounterId: string): Promise<PaReportRecord[]> {
    const enc = await this.encounterFor(encounterId);
    const rows = await this.db.tx().paReport.findMany({
      where: { encounterId, ...CURRENT },
      orderBy: [{ occurredAt: 'desc' }, { id: 'desc' }],
    });
    this.db.audit({ action: 'read', resourceType: 'pa_report', patientId: enc.patientId });
    return this.toRecords(rows);
  }

  async create(input: PaReportCreateInput): Promise<PaReportRecord> {
    const enc = await this.encounterFor(input.encounterId);
    const tx = this.db.tx();
    let surgeryCaseId = input.surgeryCaseId;
    if (input.surgerySpecimenId) {
      const sp = await tx.surgerySpecimen.findUnique({
        where: { id: input.surgerySpecimenId },
        select: { surgeryCaseId: true, surgeryCase: { select: { encounterId: true } } },
      });
      if (sp?.surgeryCase.encounterId !== enc.id) {
        throw new AppError('VALIDATION_FAILED', 'Spesimen bukan milik kunjungan ini', 422, {
          fields: ['surgerySpecimenId'],
        });
      }
      if (input.surgeryCaseId && input.surgeryCaseId !== sp.surgeryCaseId) {
        throw new AppError('VALIDATION_FAILED', 'Kasus operasi tidak sesuai spesimen', 422, {
          fields: ['surgeryCaseId'],
        });
      }
      surgeryCaseId = sp.surgeryCaseId;
      if (input.revision.kind === 'baru') {
        const dup = await tx.paReport.findFirst({
          where: { surgerySpecimenId: input.surgerySpecimenId, addendumOf: null, supersededBy: { none: {} } },
          select: { id: true },
        });
        if (dup) {
          throw new AppError(
            'CONFLICT',
            'Spesimen ini sudah berlaporan PA; gunakan koreksi atau addendum',
            409,
          );
        }
      }
    } else if (surgeryCaseId) {
      const sc = await tx.surgeryCase.findUnique({
        where: { id: surgeryCaseId },
        select: { encounterId: true },
      });
      if (sc?.encounterId !== enc.id) {
        throw new AppError('VALIDATION_FAILED', 'Kasus operasi bukan milik kunjungan ini', 422, {
          fields: ['surgeryCaseId'],
        });
      }
    }
    await this.assertDocuments(enc.patientId, input.imageDocumentIds);
    const f = await this.records.prepare('pa_reports', {
      patientId: enc.patientId,
      encounterId: enc.id,
      occurredAt: input.occurredAt,
      revision: input.revision,
    });
    await this.records.insert(() =>
      tx.paReport.create({
        data: {
          ...f,
          encounterId: enc.id,
          surgeryCaseId,
          surgerySpecimenId: input.surgerySpecimenId,
          specimenSite: input.specimenSite,
          macroscopic: input.macroscopic,
          microscopic: input.microscopic,
          diagnosis: input.diagnosis,
          icd10: input.icd10,
          imageDocumentIds: input.imageDocumentIds,
        },
      }),
    );
    this.db.audit({
      action: f.supersedesId ? 'correct' : 'create',
      resourceType: 'pa_report',
      resourceId: f.id,
      patientId: enc.patientId,
      details: { encounterId: enc.id, revision: input.revision.kind },
    });
    const row = await tx.paReport.findUniqueOrThrow({ where: { id: f.id } });
    return (await this.toRecords([row]))[0] as PaReportRecord;
  }

  /** TTE dokter atas versi terkini (PDF deterministik ADR-0029); versi terkunci, perubahan lewat addendum. */
  async sign(id: string): Promise<PaReportRecord> {
    this.records.author();
    const tx = this.db.tx();
    const row = await tx.paReport.findUnique({ where: { id } });
    if (!row) throw new AppError('NOT_FOUND', 'Laporan PA tidak ditemukan', 404);
    const enc = await this.encounterFor(row.encounterId);
    if ((await this.records.lockedIds('pa_reports', [row.id])).has(row.id)) {
      throw new AppError('CONFLICT', 'Laporan PA ini sudah ditandatangani', 409);
    }
    const unit = await tx.unit.findUniqueOrThrow({ where: { id: enc.unitId }, select: { name: true } });
    await this.signing.issueSigned('pa_reports', row.id, {
      patientId: row.patientId,
      kind: 'hasil',
      title: 'Laporan patologi anatomi',
      fileName: `patologi anatomi ${enc.number}`,
      issuedAt: row.recordedAt,
      patientExtra: [
        { label: 'Kunjungan', value: enc.number },
        { label: 'Unit', value: unit.name },
      ],
      sections: [
        {
          title: 'Spesimen',
          blocks: [{ kind: 'fields', rows: [{ label: 'Lokasi/jenis', value: row.specimenSite }] }],
        },
        { title: 'Makroskopik', blocks: [{ kind: 'paragraph', text: row.macroscopic }] },
        { title: 'Mikroskopik', blocks: [{ kind: 'paragraph', text: row.microscopic }] },
        {
          title: 'Diagnosis',
          blocks: [
            { kind: 'paragraph', text: row.diagnosis },
            ...(row.icd10
              ? [{ kind: 'fields' as const, rows: [{ label: 'ICD-10', value: row.icd10 }] }]
              : []),
          ],
        },
        ...(row.imageDocumentIds.length
          ? [
              {
                title: 'Gambar',
                blocks: [
                  {
                    kind: 'paragraph' as const,
                    text: `${row.imageDocumentIds.length} gambar terlampir di berkas pasien.`,
                  },
                ],
              },
            ]
          : []),
      ],
      tte: { role: 'Dokter spesialis patologi anatomi', caption: null },
      accessChecked: true,
    });
    await this.events.publish('pa.report_signed', {
      paReportId: row.id,
      encounterId: row.encounterId,
      patientId: row.patientId,
      unitId: enc.unitId,
      surgeryCaseId: row.surgeryCaseId,
    });
    this.db.audit({
      action: 'sign',
      resourceType: 'pa_report',
      resourceId: row.id,
      patientId: row.patientId,
    });
    return (await this.toRecords([row]))[0] as PaReportRecord;
  }

  private async assertDocuments(patientId: string, ids: readonly string[]) {
    if (ids.length === 0) return;
    const n = await this.db
      .tx()
      .document.count({ where: { id: { in: [...ids] }, patientId, voidedAt: null } });
    if (n !== new Set(ids).size) {
      throw new AppError('VALIDATION_FAILED', 'Gambar harus dokumen aktif milik pasien ini', 422, {
        fields: ['imageDocumentIds'],
      });
    }
  }

  private async toRecords(rows: PaRow[]): Promise<PaReportRecord[]> {
    const tx = this.db.tx();
    const meta = await this.records.meta('pa_reports', rows);
    const patients = await patientsLite(
      tx,
      rows.map((r) => r.encounterId),
    );
    const docs = await tx.document.findMany({
      where: { sourceType: 'pa_reports', sourceId: { in: rows.map((r) => r.id) }, voidedAt: null },
      select: { id: true, sourceId: true },
    });
    return rows.flatMap((r) => {
      const p = patients.get(r.encounterId);
      const m = meta.get(r.id);
      if (!p || !m) return [];
      const { unitId: _u, ...patient } = p;
      return [
        {
          meta: m,
          encounterId: r.encounterId,
          patient,
          surgeryCaseId: r.surgeryCaseId,
          specimenSite: r.specimenSite,
          macroscopic: r.macroscopic,
          microscopic: r.microscopic,
          diagnosis: r.diagnosis,
          icd10: r.icd10,
          imageDocumentIds: r.imageDocumentIds,
          surgerySpecimenId: r.surgerySpecimenId,
          documentId: docs.find((d) => d.sourceId === r.id)?.id ?? null,
        },
      ];
    });
  }
}
