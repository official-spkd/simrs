import { Injectable } from '@nestjs/common';
import { Prisma } from '@simrs/db';
import {
  type Antibiogram,
  type AntibiogramQuery,
  AppError,
  formatTanggalWaktu,
  MICRO_PANEL_CODE,
  MICRO_STAGE_LABEL,
  type MicroIsolateStageInput,
  type MicroOrderRecord,
  type MicroTechnicalInput,
  type MicroWorklist,
  newId,
  supportError,
} from '@simrs/shared';
import { ClinicalRecordService } from '../../infra/clinical/clinical-record.service';
import {
  assertSupportItem,
  inSupportWindow,
  patientsLite,
  supportScope,
  supportWrite,
  userNames,
} from '../../infra/clinical/support-access';
import { DomainEvents } from '../../infra/events/domain-events';
import { TenantDb } from '../../infra/tenant-db';
import { PatientAccessService } from '../authz/patient-access.service';
import { ClinicalPdfService } from '../documents/clinical-pdf.service';

const MAX_ORDERS = 200;

/**
 * S02 · Mikrobiologi (rencana fase 4 §4.8, ADR-0120): worklist order kultur (uji panel `MIKRO`), isolat per tahap
 * (laporan awal tanpa kepekaan, laporan akhir dengan S/I/R + MIC), laporan per tahap ber-validasi dua tingkat seperti
 * lab (validasi teknis analis → rilis klinis dokter LAIN dengan PDF ber-TTE), event `micro.report_released`, dan
 * antibiogram kumulatif (isolat pertama per pasien × organisme) untuk PPRA. Urutan tahap, penguncian isolat, dan
 * dua validator ditegakkan trigger database.
 */
@Injectable()
export class MicroService {
  constructor(
    private readonly db: TenantDb,
    private readonly access: PatientAccessService,
    private readonly records: ClinicalRecordService,
    private readonly pdf: ClinicalPdfService,
    private readonly events: DomainEvents,
  ) {}

  /** Predikat SQL: order lab `o` memuat uji kultur (panel MIKRO) yang tidak dibatalkan. */
  private microSql() {
    return Prisma.sql`EXISTS (
      SELECT 1 FROM lab_order_items li
      JOIN service_requests sr ON sr.tenant_id = li.tenant_id AND sr.id = li.service_request_id
      JOIN lab_test_definitions d ON d.tenant_id = sr.tenant_id AND d.orderable_id = sr.orderable_id
      WHERE li.tenant_id = o.tenant_id AND li.lab_order_id = o.id AND li.voided_at IS NULL
        AND d.panel_code = ${MICRO_PANEL_CODE})`;
  }

  async worklist(): Promise<MicroWorklist> {
    const tx = this.db.tx();
    const now = new Date();
    const scope = await supportScope(this.db, this.access);
    if ('none' in scope) return { serverNow: now.toISOString(), view: scope.view, orders: [] };
    const abac = scope.view === 'ruangan' ? Prisma.sql`AND ${scope.filter}` : Prisma.empty;
    const since = new Date(now.getTime() - 7 * 86_400_000);
    const rows = await tx.$queryRaw<Array<{ id: string; patient_id: string }>>`
      SELECT o.id::text AS id, o.patient_id::text AS patient_id
      FROM lab_orders o JOIN patients p ON p.tenant_id = o.tenant_id AND p.id = o.patient_id
      WHERE o.status <> 'batal' AND ${this.microSql()}
        AND NOT EXISTS (SELECT 1 FROM micro_reports r WHERE r.tenant_id = o.tenant_id AND r.lab_order_id = o.id
                          AND r.stage = 'akhir' AND r.clinical_at < ${since})
        ${abac}
      ORDER BY (o.priority = 'cito') DESC, o.accepted_at, o.id
      LIMIT ${MAX_ORDERS}`;
    for (const pid of new Set(rows.map((r) => r.patient_id))) {
      this.db.audit({ action: 'read', resourceType: 'micro_worklist', patientId: pid });
    }
    return {
      serverNow: now.toISOString(),
      view: scope.view,
      orders: await this.load(rows.map((r) => r.id)),
    };
  }

  /** Satu order kultur + akses (layanan: jendela 7 hari setelah laporan akhir; ruangan: ABAC pasien). */
  private async orderFor(labOrderId: string) {
    const tx = this.db.tx();
    const rows = await tx.$queryRaw<Array<{ id: string }>>`
      SELECT o.id::text AS id FROM lab_orders o WHERE o.id = ${labOrderId}::uuid AND ${this.microSql()}`;
    const o = rows.length
      ? await tx.labOrder.findUnique({
          where: { id: labOrderId },
          include: { microReports: { where: { stage: 'akhir' }, select: { clinicalAt: true } } },
        })
      : null;
    if (!o) throw new AppError('NOT_FOUND', 'Order kultur tidak ditemukan', 404);
    const finalAt = o.microReports[0]?.clinicalAt ?? null;
    const scope = await supportScope(this.db, this.access);
    await assertSupportItem(scope, this.access, o.patientId, inSupportWindow(finalAt === null, finalAt));
    if (o.status === 'batal') throw new AppError('CONFLICT', 'Order lab sudah dibatalkan', 409);
    return o;
  }

  async get(labOrderId: string): Promise<MicroOrderRecord> {
    const o = await this.orderFor(labOrderId);
    this.db.audit({ action: 'read', resourceType: 'micro_order', resourceId: o.id, patientId: o.patientId });
    return (await this.load([o.id]))[0] as MicroOrderRecord;
  }

  /** Isolat + uji kepekaan (append-only); tahap yang sudah divalidasi menolak (`MICRO_STAGE_CLOSED`). */
  async addIsolate(input: MicroIsolateStageInput): Promise<MicroOrderRecord> {
    const me = this.records.author();
    const o = await this.orderFor(input.labOrderId);
    const codes = input.susceptibilities.map((s) => s.antibioticCode);
    if (new Set(codes).size !== codes.length) {
      throw new AppError('VALIDATION_FAILED', 'Antibiotik uji kepekaan tidak boleh ganda', 422, {
        fields: ['susceptibilities'],
      });
    }
    const tx = this.db.tx();
    const id = newId();
    await supportWrite(async () => {
      await tx.microIsolate.create({
        data: {
          id,
          tenantId: this.db.tenantId(),
          labOrderId: o.id,
          stage: input.stage,
          organismCode: input.organismCode,
          growth: input.growth,
          recordedBy: me.userId,
        },
      });
      for (const s of input.susceptibilities) {
        await tx.microSusceptibility.create({
          data: {
            id: newId(),
            tenantId: this.db.tenantId(),
            isolateId: id,
            antibioticCode: s.antibioticCode,
            result: s.result,
            micValue: s.micValue,
          },
        });
      }
    });
    this.db.audit({
      action: 'create',
      resourceType: 'micro_isolate',
      resourceId: id,
      patientId: o.patientId,
      details: { stage: input.stage, susceptibilities: input.susceptibilities.length },
    });
    return (await this.load([o.id]))[0] as MicroOrderRecord;
  }

  /** Validasi teknis satu tahap (analis, `lab.result.verify`); laporan akhir hanya setelah awal dirilis (trigger). */
  async technical(input: MicroTechnicalInput): Promise<MicroOrderRecord> {
    const me = this.records.author();
    const o = await this.orderFor(input.labOrderId);
    const tx = this.db.tx();
    if (
      await tx.microReport.findFirst({
        where: { labOrderId: o.id, stage: input.stage },
        select: { id: true },
      })
    ) {
      throw new AppError('CONFLICT', 'Tahap laporan ini sudah divalidasi teknis', 409);
    }
    const id = newId();
    await supportWrite(() =>
      tx.microReport.create({
        data: {
          id,
          tenantId: this.db.tenantId(),
          labOrderId: o.id,
          stage: input.stage,
          conclusion: input.conclusion,
          technicalBy: me.userId,
        },
      }),
    );
    this.db.audit({
      action: 'create',
      resourceType: 'micro_report',
      resourceId: id,
      patientId: o.patientId,
      details: { stage: input.stage, level: 'teknis' },
    });
    return (await this.load([o.id]))[0] as MicroOrderRecord;
  }

  /**
   * Rilis klinis (dokter, `lab.result.release`) oleh orang LAIN dari validator teknis: PDF ber-TTE atas isi tahap itu,
   * lalu event `micro.report_released` (penerima hasil: panel hasil, PPRA, SATUSEHAT kelak).
   */
  async release(reportId: string): Promise<MicroOrderRecord> {
    const me = this.records.author();
    const tx = this.db.tx();
    await tx.$queryRaw`SELECT id FROM micro_reports WHERE tenant_id = ${this.db.tenantId()}::uuid AND id = ${reportId}::uuid FOR UPDATE`;
    const r = await tx.microReport.findUnique({ where: { id: reportId } });
    if (!r) throw new AppError('NOT_FOUND', 'Laporan mikrobiologi tidak ditemukan', 404);
    const o = await this.orderFor(r.labOrderId);
    if (r.clinicalBy) throw new AppError('CONFLICT', 'Laporan tahap ini sudah dirilis', 409);
    if (r.technicalBy === me.userId) {
      throw supportError('VALIDATOR_SAME_USER');
    }
    const isolates = await tx.microIsolate.findMany({
      where: { labOrderId: o.id, stage: r.stage },
      orderBy: [{ recordedAt: 'asc' }, { id: 'asc' }],
      include: { susceptibilities: { orderBy: { antibioticCode: 'asc' } } },
    });
    const enc = await tx.encounter.findUniqueOrThrow({
      where: { id: o.encounterId },
      select: { number: true, unit: { select: { name: true } } },
    });
    const names = await userNames(tx, [r.technicalBy]);
    const issued = await this.pdf.issue({
      patientId: o.patientId,
      kind: 'hasil',
      title: `Hasil mikrobiologi · ${MICRO_STAGE_LABEL[r.stage as 'awal' | 'akhir']}`,
      fileName: `mikrobiologi ${o.labNo} ${r.stage}`,
      issuedAt: new Date(),
      patientExtra: [
        { label: 'No. lab', value: o.labNo },
        { label: 'Kunjungan', value: enc.number },
        { label: 'Unit', value: enc.unit.name },
      ],
      sections: [
        ...isolates.map((i) => ({
          title: `Isolat: ${i.organismCode}`,
          blocks: [
            { kind: 'fields' as const, rows: [{ label: 'Pertumbuhan', value: i.growth }] },
            ...(i.susceptibilities.length
              ? [
                  {
                    kind: 'fields' as const,
                    rows: i.susceptibilities.map((s) => ({
                      label: s.antibioticCode,
                      value: `${s.result}${s.micValue !== null ? ` · MIC ${s.micValue.toString()}` : ''}`,
                    })),
                  },
                ]
              : []),
          ],
        })),
        { title: 'Kesimpulan', blocks: [{ kind: 'paragraph' as const, text: r.conclusion }] },
        {
          title: 'Validasi',
          blocks: [
            {
              kind: 'fields' as const,
              rows: [
                {
                  label: 'Validasi teknis',
                  value: `${names.get(r.technicalBy) ?? '–'}, ${formatTanggalWaktu(r.technicalAt)}`,
                },
              ],
            },
          ],
        },
      ],
      source: { table: 'micro_reports', id: r.id },
      tte: { role: 'Dokter penanggung jawab mikrobiologi', caption: null },
      accessChecked: true,
    });
    await supportWrite(() =>
      tx.microReport.update({
        where: { id: r.id },
        data: { clinicalBy: me.userId, clinicalAt: new Date(), documentId: issued.document.id },
      }),
    );
    await this.events.publish('micro.report_released', {
      labOrderId: o.id,
      encounterId: o.encounterId,
      patientId: o.patientId,
      unitId: o.unitId,
      stage: r.stage as 'awal' | 'akhir',
      isolateIds: isolates.map((i) => i.id),
    });
    this.db.audit({
      action: 'sign',
      resourceType: 'micro_report',
      resourceId: r.id,
      patientId: o.patientId,
      details: { stage: r.stage, level: 'klinis', documentId: issued.document.id },
    });
    return (await this.load([o.id]))[0] as MicroOrderRecord;
  }

  /**
   * Antibiogram kumulatif (CLSI M39 sederhana): laporan akhir yang dirilis di periode, isolat pertama per pasien ×
   * organisme; % S per antibiotik. Agregat tanpa identitas pasien (sumber PPRA fase 8).
   */
  async antibiogram(q: AntibiogramQuery): Promise<Antibiogram> {
    if (q.to < q.from) throw new AppError('VALIDATION_FAILED', 'Rentang tanggal terbalik', 422);
    const from = new Date(`${q.from}T00:00:00+07:00`);
    const to = new Date(new Date(`${q.to}T00:00:00+07:00`).getTime() + 86_400_000);
    const rows = await this.db.tx().$queryRaw<
      Array<{ organism: string; antibiotic: string | null; result: string | null }>
    >`
      WITH first_isolates AS (
        SELECT DISTINCT ON (o.patient_id, i.organism_code) i.id, i.organism_code
        FROM micro_isolates i
        JOIN lab_orders o ON o.tenant_id = i.tenant_id AND o.id = i.lab_order_id
        JOIN micro_reports r ON r.tenant_id = i.tenant_id AND r.lab_order_id = i.lab_order_id AND r.stage = 'akhir'
        WHERE i.stage = 'akhir' AND r.clinical_at >= ${from} AND r.clinical_at < ${to}
        ORDER BY o.patient_id, i.organism_code, i.recorded_at, i.id
      )
      SELECT f.organism_code AS organism, s.antibiotic_code AS antibiotic, s.result
      FROM first_isolates f
      LEFT JOIN micro_susceptibilities s ON s.isolate_id = f.id
      ORDER BY f.organism_code, s.antibiotic_code`;
    const isolateCount = await this.db.tx().$queryRaw<Array<{ organism: string; n: number }>>`
      SELECT organism_code AS organism, count(*)::int AS n FROM (
        SELECT DISTINCT ON (o.patient_id, i.organism_code) i.organism_code
        FROM micro_isolates i
        JOIN lab_orders o ON o.tenant_id = i.tenant_id AND o.id = i.lab_order_id
        JOIN micro_reports r ON r.tenant_id = i.tenant_id AND r.lab_order_id = i.lab_order_id AND r.stage = 'akhir'
        WHERE i.stage = 'akhir' AND r.clinical_at >= ${from} AND r.clinical_at < ${to}
        ORDER BY o.patient_id, i.organism_code, i.recorded_at, i.id) x
      GROUP BY organism_code ORDER BY organism_code`;
    const byOrganism = new Map<string, Map<string, { S: number; I: number; R: number }>>();
    for (const row of rows) {
      const abx = byOrganism.get(row.organism) ?? new Map();
      byOrganism.set(row.organism, abx);
      if (!row.antibiotic || !row.result) continue;
      const c = abx.get(row.antibiotic) ?? { S: 0, I: 0, R: 0 };
      c[row.result as 'S' | 'I' | 'R'] += 1;
      abx.set(row.antibiotic, c);
    }
    this.db.audit({ action: 'read', resourceType: 'micro_antibiogram', details: { from: q.from, to: q.to } });
    return {
      from: q.from,
      to: q.to,
      rows: isolateCount.map((x) => ({
        organismCode: x.organism,
        isolates: x.n,
        antibiotics: [...(byOrganism.get(x.organism) ?? new Map()).entries()].map(([code, c]) => {
          const tested = c.S + c.I + c.R;
          return {
            antibioticCode: code,
            tested,
            susceptible: c.S,
            intermediate: c.I,
            resistant: c.R,
            percentSusceptible: tested > 0 ? Math.round((c.S / tested) * 100) : null,
          };
        }),
      })),
    };
  }

  private async load(ids: readonly string[]): Promise<MicroOrderRecord[]> {
    if (ids.length === 0) return [];
    const tx = this.db.tx();
    const orders = await tx.labOrder.findMany({
      where: { id: { in: [...ids] } },
      include: {
        items: { where: { voidedAt: null }, include: { serviceRequest: { select: { orderableId: true } } } },
        microIsolates: {
          orderBy: [{ recordedAt: 'asc' }, { id: 'asc' }],
          include: { susceptibilities: { orderBy: { antibioticCode: 'asc' } } },
        },
        microReports: { orderBy: { technicalAt: 'asc' } },
      },
    });
    const tests = await tx.labTestDefinition.findMany({
      where: {
        panelCode: MICRO_PANEL_CODE,
        orderableId: { in: orders.flatMap((o) => o.items.map((i) => i.serviceRequest.orderableId)) },
      },
      select: { orderableId: true, code: true, name: true, specimenType: true },
    });
    const patients = await patientsLite(
      tx,
      orders.map((o) => o.encounterId),
    );
    const names = await userNames(tx, [
      ...orders.flatMap((o) => o.microIsolates.map((i) => i.recordedBy)),
      ...orders.flatMap((o) => o.microReports.flatMap((r) => [r.technicalBy, r.clinicalBy])),
    ]);
    const person = (id: string) => ({ id, name: names.get(id) ?? '–' });
    const byId = new Map(orders.map((o) => [o.id, o]));
    const out: MicroOrderRecord[] = [];
    for (const id of ids) {
      const o = byId.get(id);
      const p = o ? patients.get(o.encounterId) : undefined;
      if (!o || !p) continue;
      const { unitId: _u, ...patient } = p;
      out.push({
        labOrderId: o.id,
        labNo: o.labNo,
        encounterId: o.encounterId,
        patient,
        priority: o.priority,
        status: o.status,
        acceptedAt: o.acceptedAt.toISOString(),
        tests: tests
          .filter((t) => o.items.some((i) => i.serviceRequest.orderableId === t.orderableId))
          .map((t) => ({ code: t.code, name: t.name, specimenType: t.specimenType })),
        isolates: o.microIsolates.map((i) => ({
          id: i.id,
          stage: i.stage as 'awal' | 'akhir',
          organismCode: i.organismCode,
          growth: i.growth,
          recordedBy: person(i.recordedBy),
          recordedAt: i.recordedAt.toISOString(),
          susceptibilities: i.susceptibilities.map((s) => ({
            antibioticCode: s.antibioticCode,
            result: s.result as 'S' | 'I' | 'R',
            micValue: s.micValue === null ? null : s.micValue.toNumber(),
          })),
        })),
        reports: o.microReports.map((r) => ({
          id: r.id,
          stage: r.stage as 'awal' | 'akhir',
          conclusion: r.conclusion,
          technicalBy: person(r.technicalBy),
          technicalAt: r.technicalAt.toISOString(),
          clinicalBy: r.clinicalBy ? person(r.clinicalBy) : null,
          clinicalAt: r.clinicalAt?.toISOString() ?? null,
          documentId: r.documentId,
        })),
      });
    }
    return out;
  }
}
