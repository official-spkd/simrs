import { createHash } from 'node:crypto';
import { Injectable } from '@nestjs/common';
import {
  allocateNumber,
  insertLabResult,
  isoFromDbDate,
  labOrderTests,
  labResultsComplete,
  labValueText,
  type LabTestDef,
  type Prisma,
  prepareLabResult,
  refreshLabOrderProgress,
  setLabOrderStatus,
  testsForOrderables,
} from '@simrs/db';
import {
  AppError,
  clinicalValidationBlock,
  isoDateJakarta,
  type LabFlag,
  type LabInboundIssue,
  type LabOrderAcceptInput,
  type LabOrderDetail,
  type LabOrderStatus,
  type LabQcRun,
  type LabQcRunInput,
  type LabResultCorrectionInput,
  type LabResultInput,
  type LabResultRecord,
  type LabTestDefinition,
  type LabValidationInput,
  type LabWorklistItem,
  type LabWorklistQuery,
  newId,
  type PatientBanner,
  type PermissionScope,
  qcZScore,
  type QcOutcome,
  type SpecimenRejectInput,
  type SupportOrderRef,
  supportError,
  type SupportPriority,
  technicalValidationBlock,
  type WestgardRule,
  westgardEvaluate,
} from '@simrs/shared';
import { IdempotencyService } from '../../common/idempotency';
import { ageYears } from '../../infra/clinical/clinical-context';
import { DomainEvents } from '../../infra/events/domain-events';
import { TenantDb } from '../../infra/tenant-db';
import { CriticalResultsService } from '../critical-results/critical-results.service';
import { DiagnosisService } from '../diagnosis/diagnosis.service';
import { ClinicalPdfService } from '../documents/clinical-pdf.service';
import { NotificationsService } from '../notifications/notifications.service';
import { allergyLabels } from '../summary/summary.service';
import { ResultsQueryService } from './results-query.service';

const ACCEPT_SCOPE = 'lab.order_accept';
const DAY_MS = 86_400_000;
/** Order CPOE yang lebih tua dari ini tidak lagi muncul sebagai "baru" di worklist (dianggap kedaluwarsa). */
const PENDING_WINDOW_DAYS = 14;
/** Order selesai/batal tetap terlihat unit lab selama ini (keputusan fase 4 no. 3). */
const DONE_WINDOW_DAYS = 7;
const LOCKED: ReadonlySet<string> = new Set(['validasi_teknis', 'selesai']);

const FLAG_INTERPRETATION: Record<LabFlag, string> = {
  N: 'normal',
  H: 'tinggi',
  L: 'rendah',
  KRITIS: 'kritis',
};

const SR_SELECT = {
  id: true,
  orderGroupId: true,
  encounterId: true,
  patientId: true,
  code: true,
  name: true,
  priority: true,
  instructions: true,
  createdAt: true,
  orderGroup: { select: { orderedAt: true, orderer: { select: { displayName: true } } } },
} as const;
type SrRow = {
  id: string;
  orderGroupId: string;
  encounterId: string;
  patientId: string;
  code: string | null;
  name: string;
  priority: string;
  instructions: string | null;
  createdAt: Date;
  orderGroup: { orderedAt: Date; orderer: { displayName: string } };
};

const PATIENT_SELECT = {
  id: true,
  name: true,
  mrn: true,
  sex: true,
  birthDate: true,
  unidentified: true,
  confidential: true,
} as const;
type PatientRow = {
  id: string;
  name: string;
  mrn: string;
  sex: string;
  birthDate: Date | null;
  unidentified: boolean;
  confidential: boolean;
};

const D = (v: Prisma.Decimal | null): number | null => (v === null ? null : Number(v));
const priorityOf = (p: string): SupportPriority => (p === 'cito' ? 'cito' : 'rutin');

function banner(p: PatientRow): PatientBanner {
  return {
    id: p.id,
    name: p.name,
    mrn: p.mrn,
    sex: p.sex as PatientBanner['sex'],
    birthDate: p.birthDate ? isoFromDbDate(p.birthDate) : null,
    ageYears: ageYears(p.birthDate, isoDateJakarta()),
    unidentified: p.unidentified,
    confidential: p.confidential,
  };
}

function orderRef(r: SrRow): SupportOrderRef {
  return {
    serviceRequestId: r.id,
    orderGroupId: r.orderGroupId,
    encounterId: r.encounterId,
    code: r.code,
    name: r.name,
    priority: priorityOf(r.priority),
    orderedAt: r.orderGroup.orderedAt.toISOString(),
    orderedBy: r.orderGroup.orderer.displayName,
    indication: r.instructions,
  };
}

/** Teks rentang rujukan untuk observasi/cetak: `3,5–5,1`, `< 200`, `> 40`. */
function rangeText(low: number | null, high: number | null): string | null {
  const f = (n: number) => String(n).replace('.', ',');
  if (low !== null && high !== null) return `${f(low)}–${f(high)}`;
  if (high !== null) return `≤ ${f(high)}`;
  if (low !== null) return `≥ ${f(low)}`;
  return null;
}

type ResultRow = Prisma.LabResultGetPayload<{ include: { author: { select: { displayName: true } } } }>;

/**
 * S01 · Laboratorium inti (rencana fase 4 §4.2). Lingkup `unit` = order yang ditujukan ke unit lab penugasan sesi
 * (keputusan fase 4 no. 3): data pasien minimal (banner, alergi, eGFR). Alur: order CPOE → terima (nomor lab +
 * spesimen berbarcode) → ambil/terima/tolak spesimen → hasil (manual atau analyzer) → validasi teknis → validasi klinis
 * (TTE) = rilis → hasil masuk muara hasil fase 3 (`observations`, panel CPOE/ringkasan/resume) + notifikasi DPJP.
 * Flag/rentang/delta dari inti `@simrs/db` yang sama dengan worker analyzer; nilai kritis memblokir validasi.
 */
@Injectable()
export class LabService {
  constructor(
    private readonly db: TenantDb,
    private readonly events: DomainEvents,
    private readonly critical: CriticalResultsService,
    private readonly idempotency: IdempotencyService,
    private readonly diagnosis: DiagnosisService,
    private readonly results: ResultsQueryService,
    private readonly pdf: ClinicalPdfService,
    private readonly notifications: NotificationsService,
  ) {}

  private tx() {
    return this.db.tx();
  }

  private actorId(): string {
    const id = this.db.actorUserId();
    if (!id) throw new AppError('UNAUTHENTICATED', 'Belum login', 401);
    return id;
  }

  private actorRole(): string {
    return this.db.actor().role ?? 'staf';
  }

  // ------------------------------------------------------------------------------------------------------------
  // Lingkup
  // ------------------------------------------------------------------------------------------------------------

  /** Unit lab dalam lingkup izin endpoint ini: null = semua; [] = tidak ada (lingkup unit tanpa unit penugasan). */
  private units(scope: PermissionScope | null = this.db.permissionScope()): string[] | null {
    if (scope === 'all') return null;
    const unitId = scope === 'unit' ? this.db.actor().unitId : null;
    return unitId ? [unitId] : [];
  }

  private assertUnit(unitId: string, scope: PermissionScope | null = this.db.permissionScope()): void {
    const u = this.units(scope);
    if (u && !u.includes(unitId)) {
      throw new AppError('FORBIDDEN', 'Order ini bukan untuk unit laboratorium penugasan Anda', 403);
    }
  }

  private async order(id: string) {
    const o = await this.tx().labOrder.findUnique({
      where: { id },
      select: {
        id: true,
        labNo: true,
        status: true,
        unitId: true,
        patientId: true,
        encounterId: true,
        priority: true,
        receivedAt: true,
        releasedAt: true,
      },
    });
    if (!o) throw new AppError('NOT_FOUND', 'Order lab tidak ditemukan', 404);
    this.assertUnit(o.unitId);
    return o;
  }

  // ------------------------------------------------------------------------------------------------------------
  // Worklist
  // ------------------------------------------------------------------------------------------------------------

  async worklist(q: LabWorklistQuery): Promise<LabWorklistItem[]> {
    const units = this.units();
    if (units && units.length === 0) return [];
    const tx = this.tx();
    const now = new Date();
    const items: Array<LabWorklistItem & { sortKey: number }> = [];
    const unitFilter = units ? { in: units } : undefined;

    if (q.view === 'aktif') {
      const pending = (await tx.serviceRequest.findMany({
        where: {
          labOrderItem: null,
          createdAt: { gte: new Date(now.getTime() - PENDING_WINDOW_DAYS * DAY_MS) },
          orderable: { kind: 'lab', unitId: unitFilter ?? { not: null } },
          encounter: { status: { not: 'cancelled' } },
        },
        select: SR_SELECT,
        orderBy: { createdAt: 'asc' },
        take: 500,
      })) as SrRow[];
      const active = await this.activeRequests(pending.map((p) => p.id));
      const groups = new Map<string, SrRow[]>();
      for (const r of pending.filter((p) => active.has(p.id))) {
        groups.set(r.orderGroupId, [...(groups.get(r.orderGroupId) ?? []), r]);
      }
      const ctx = await this.contextOf([...groups.values()].map((g) => g[0] as SrRow));
      for (const g of groups.values()) {
        const first = g[0] as SrRow;
        const c = ctx.get(first.encounterId);
        if (!c) continue;
        items.push({
          labOrderId: null,
          labNo: null,
          status: null,
          orders: g.map(orderRef),
          patient: c.patient,
          location: c.location,
          priority: g.some((r) => r.priority === 'cito') ? 'cito' : 'rutin',
          receivedAt: null,
          criticalOpen: false,
          sortKey: first.orderGroup.orderedAt.getTime(),
        });
      }
    }

    const orders = await tx.labOrder.findMany({
      where: {
        unitId: unitFilter,
        ...(q.view === 'aktif'
          ? { status: { notIn: ['selesai', 'batal'] } }
          : {
              status: { in: ['selesai', 'batal'] },
              updatedAt: { gte: new Date(now.getTime() - DONE_WINDOW_DAYS * DAY_MS) },
            }),
      },
      select: {
        id: true,
        labNo: true,
        status: true,
        priority: true,
        receivedAt: true,
        acceptedAt: true,
        encounterId: true,
        items: { where: { voidedAt: null }, select: { serviceRequest: { select: SR_SELECT } } },
      },
      orderBy: { acceptedAt: 'asc' },
      take: q.limit,
    });
    const open = await tx.criticalResult.findMany({
      where: { status: 'terbuka', labResult: { labOrderId: { in: orders.map((o) => o.id) } } },
      select: { labResult: { select: { labOrderId: true } } },
    });
    const openSet = new Set(open.map((c) => c.labResult?.labOrderId));
    const ctx = await this.contextOf(
      orders.flatMap((o) => (o.items[0] ? [o.items[0].serviceRequest as SrRow] : [])),
    );
    for (const o of orders) {
      const refs = o.items.map((i) => orderRef(i.serviceRequest as SrRow));
      const c = ctx.get(o.encounterId);
      if (!c || refs.length === 0) continue;
      items.push({
        labOrderId: o.id,
        labNo: o.labNo,
        status: o.status as LabOrderStatus,
        orders: refs,
        patient: c.patient,
        location: c.location,
        priority: priorityOf(o.priority),
        receivedAt: o.receivedAt?.toISOString() ?? null,
        criticalOpen: openSet.has(o.id),
        sortKey: o.acceptedAt.getTime(),
      });
    }
    // Cito dulu, lalu yang paling lama menunggu.
    items.sort((a, b) =>
      a.priority === b.priority ? a.sortKey - b.sortKey : a.priority === 'cito' ? -1 : 1,
    );
    // ADR-0015: daftar kerja dimuat = pencarian per pasien yang tampil (pembaruan SSE tanpa PHI tidak diaudit).
    for (const pid of new Set(items.map((i) => i.patient.id))) {
      this.db.audit({
        action: 'search',
        resourceType: 'patient',
        resourceId: pid,
        patientId: pid,
        details: { screen: 'lab_worklist', view: q.view },
      });
    }
    return items.slice(0, q.limit).map(({ sortKey: _s, ...rest }) => rest);
  }

  /** Order CPOE yang statusnya (event terakhir) masih aktif. */
  private async activeRequests(ids: string[]): Promise<Set<string>> {
    if (ids.length === 0) return new Set();
    const events = await this.tx().orderStatusEvent.findMany({
      where: { serviceRequestId: { in: ids } },
      orderBy: [{ changedAt: 'asc' }, { id: 'asc' }],
      select: { serviceRequestId: true, status: true },
    });
    const last = new Map<string, string>();
    for (const e of events) if (e.serviceRequestId) last.set(e.serviceRequestId, e.status);
    return new Set(ids.filter((id) => (last.get(id) ?? 'aktif') === 'aktif'));
  }

  /** Banner pasien + lokasi (unit kunjungan) per kunjungan. */
  private async contextOf(rows: SrRow[]) {
    const encIds = [...new Set(rows.map((r) => r.encounterId))];
    const encs = await this.tx().encounter.findMany({
      where: { id: { in: encIds } },
      select: { id: true, unit: { select: { name: true } }, patient: { select: PATIENT_SELECT } },
    });
    return new Map(
      encs.map((e) => [e.id, { patient: banner(e.patient as PatientRow), location: e.unit.name }] as const),
    );
  }

  // ------------------------------------------------------------------------------------------------------------
  // Terima order
  // ------------------------------------------------------------------------------------------------------------

  async accept(input: LabOrderAcceptInput, key: unknown): Promise<LabOrderDetail> {
    const claim = await this.idempotency.claim(ACCEPT_SCOPE, key, input);
    if (claim.existingResourceId) return this.detail(claim.existingResourceId, { audit: false });
    const tx = this.tx();
    const ids = [...new Set(input.serviceRequestIds)];
    const srs = await tx.serviceRequest.findMany({
      where: { id: { in: ids } },
      select: {
        ...SR_SELECT,
        orderableId: true,
        orderable: { select: { kind: true, unitId: true, labPanelCode: true } },
        labOrderItem: { select: { id: true } },
        encounter: { select: { status: true } },
      },
    });
    if (srs.length !== ids.length) throw new AppError('NOT_FOUND', 'Order pemeriksaan tidak ditemukan', 404);
    const first = srs[0];
    if (!first) throw new AppError('NOT_FOUND', 'Order pemeriksaan tidak ditemukan', 404);
    const unitId = first.orderable.unitId;
    if (
      !unitId ||
      srs.some(
        (s) =>
          s.orderable.kind !== 'lab' || s.orderable.unitId !== unitId || s.encounterId !== first.encounterId,
      )
    ) {
      throw new AppError(
        'VALIDATION_FAILED',
        'Pilih order laboratorium untuk satu kunjungan dan satu unit lab yang sama',
        400,
        { fields: ['serviceRequestIds'] },
      );
    }
    this.assertUnit(unitId);
    if (first.encounter.status === 'cancelled') {
      throw new AppError('CONFLICT', 'Kunjungan sudah dibatalkan', 409);
    }
    if (srs.some((s) => s.labOrderItem)) throw new AppError('CONFLICT', 'Order ini sudah diterima lab', 409);
    const active = await this.activeRequests(ids);
    if (active.size !== ids.length) throw new AppError('CONFLICT', 'Order ini sudah dibatalkan/selesai', 409);
    const tests = await testsForOrderables(
      tx,
      srs.map((s) => ({
        serviceRequestId: s.id,
        orderableId: s.orderableId,
        panelCode: s.orderable.labPanelCode,
      })),
    );
    const missing = srs.filter((s) => !tests.some((t) => t.serviceRequestId === s.id));
    if (missing.length > 0) {
      throw new AppError(
        'VALIDATION_FAILED',
        `Pemeriksaan belum punya definisi tes lab: ${missing.map((m) => m.name).join(', ')}`,
        422,
        { serviceRequestIds: missing.map((m) => m.id) },
      );
    }
    const tenantId = this.db.tenantId();
    const actor = this.actorId();
    const labNo = (await allocateNumber(tx, tenantId, 'lab_no')).number;
    const id = newId();
    const priority = srs.some((s) => s.priority === 'cito') ? 'cito' : 'rutin';
    await tx.labOrder.create({
      data: {
        id,
        tenantId,
        labNo,
        encounterId: first.encounterId,
        patientId: first.patientId,
        unitId,
        priority,
        status: 'diterima',
        idempotencyKey: claim.key,
        acceptedBy: actor,
      },
    });
    await tx.labOrderItem.createMany({
      data: ids.map((serviceRequestId) => ({ id: newId(), tenantId, labOrderId: id, serviceRequestId })),
    });
    await tx.labOrderStatusHistory.create({
      data: {
        id: newId(),
        tenantId,
        labOrderId: id,
        fromStatus: null,
        toStatus: 'diterima',
        changedBy: actor,
      },
    });
    // Satu spesimen per jenis spesimen (tabung), barcode = nomor lab + urutan.
    const types = [...new Set(tests.map((t) => t.specimenType))];
    await tx.specimen.createMany({
      data: types.map((specimenType, i) => ({
        id: newId(),
        tenantId,
        labOrderId: id,
        barcode: `${labNo}-${String(i + 1).padStart(2, '0')}`,
        specimenType,
      })),
    });
    await this.events.publish('lab.order_accepted', {
      labOrderId: id,
      serviceRequestIds: ids,
      encounterId: first.encounterId,
      patientId: first.patientId,
      unitId,
      priority,
    });
    await this.idempotency.record(claim, 'lab_order', id);
    this.db.audit({
      action: 'create',
      resourceType: 'lab_order',
      resourceId: id,
      patientId: first.patientId,
      details: { serviceRequests: ids.length, specimens: types.length, priority },
    });
    return this.detail(id, { audit: false });
  }

  // ------------------------------------------------------------------------------------------------------------
  // Spesimen
  // ------------------------------------------------------------------------------------------------------------

  async specimen(
    id: string,
    action: 'collect' | 'receive' | 'reject',
    input: { occurredAt?: string; reject?: SpecimenRejectInput },
  ): Promise<LabOrderDetail> {
    const tx = this.tx();
    const s = await tx.specimen.findUnique({
      where: { id },
      select: { id: true, barcode: true, status: true, specimenType: true, labOrderId: true },
    });
    if (!s) throw new AppError('NOT_FOUND', 'Spesimen tidak ditemukan', 404);
    const order = await this.order(s.labOrderId);
    if (order.status === 'batal' || LOCKED.has(order.status)) {
      throw supportError('SPECIMEN_STATE_INVALID', { status: order.status });
    }
    const tenantId = this.db.tenantId();
    const actor = this.actorId();
    const now = new Date();
    const allowed: Record<typeof action, string[]> = {
      collect: ['menunggu'],
      receive: ['menunggu', 'diambil'],
      reject: ['menunggu', 'diambil', 'diterima'],
    };
    if (!allowed[action].includes(s.status)) {
      throw supportError('SPECIMEN_STATE_INVALID', { status: s.status, action });
    }
    if (action === 'collect') {
      const at = input.occurredAt ? new Date(input.occurredAt) : now;
      if (at.getTime() > now.getTime() + 5 * 60_000) {
        throw new AppError('VALIDATION_FAILED', 'Waktu pengambilan tidak boleh di masa depan', 400, {
          fields: ['occurredAt'],
        });
      }
      await tx.specimen.update({
        where: { id },
        data: { status: 'diambil', collectedAt: at, collectedBy: actor },
      });
    } else if (action === 'receive') {
      await tx.specimen.update({
        where: { id },
        data: {
          status: 'diterima',
          receivedAt: now,
          receivedBy: actor,
          ...(s.status === 'menunggu' ? { collectedAt: now, collectedBy: actor } : {}),
        },
      });
    } else {
      const r = input.reject as SpecimenRejectInput;
      await tx.specimen.update({ where: { id }, data: { status: 'ditolak', rejectedReason: r.reason } });
      // Sampel ulang: tabung baru (barcode baru) menunggu diambil ruangan.
      const n = await tx.specimen.count({ where: { labOrderId: order.id } });
      await tx.specimen.create({
        data: {
          id: newId(),
          tenantId,
          labOrderId: order.id,
          barcode: `${order.labNo}-${String(n + 1).padStart(2, '0')}`,
          specimenType: s.specimenType,
        },
      });
    }
    const kind = action === 'collect' ? 'diambil' : action === 'receive' ? 'diterima' : 'ditolak';
    await tx.specimenEvent.create({
      data: {
        id: newId(),
        tenantId,
        specimenId: id,
        kind,
        reason: action === 'reject' ? (input.reject?.reason ?? null) : null,
        note: action === 'reject' ? (input.reject?.note ?? null) : null,
        userId: actor,
      },
    });
    const payload = {
      specimenId: id,
      labOrderId: order.id,
      encounterId: order.encounterId,
      patientId: order.patientId,
      unitId: order.unitId,
    };
    if (action === 'receive') await this.events.publish('lab.specimen_received', payload);
    if (action === 'reject') {
      await this.events.publish('lab.specimen_rejected', {
        ...payload,
        reason: (input.reject as SpecimenRejectInput).reason,
      });
      // Notifikasi ruangan "sampel ulang" tanpa PHI ke tim perawatan kunjungan.
      await this.notifications.notify(
        await this.careTeam(order.encounterId),
        {
          kind: 'lab.specimen_rejected',
          title: 'Sampel laboratorium perlu diambil ulang',
          body: `Spesimen ${order.labNo} ditolak laboratorium. Ambil sampel ulang dengan label baru.`,
          link: `/klinis/ringkasan?kunjungan=${order.encounterId}`,
        },
        ['in_app'],
      );
    }
    await refreshLabOrderProgress(tx, tenantId, order.id, actor);
    this.db.audit({
      action: 'update',
      resourceType: 'specimen',
      resourceId: id,
      patientId: order.patientId,
      details: { action, barcode: s.barcode },
    });
    return this.detail(order.id, { audit: false });
  }

  /** DPJP utama + perawat penanggung jawab aktif kunjungan. */
  private async careTeam(encounterId: string): Promise<string[]> {
    const team = await this.tx().encounterParticipant.findMany({
      where: { encounterId, endedAt: null, role: { in: ['dpjp_utama', 'perawat_pj'] } },
      select: { userId: true },
    });
    return [...new Set(team.map((t) => t.userId))];
  }

  // ------------------------------------------------------------------------------------------------------------
  // Hasil
  // ------------------------------------------------------------------------------------------------------------

  async enterResults(orderId: string, input: LabResultInput): Promise<LabOrderDetail> {
    const order = await this.order(orderId);
    if (order.status === 'batal') throw new AppError('CONFLICT', 'Order lab sudah dibatalkan', 409);
    if (LOCKED.has(order.status)) {
      throw new AppError('CONFLICT', 'Hasil sudah divalidasi; perubahan lewat koreksi beralasan', 409);
    }
    const tx = this.tx();
    const tenantId = this.db.tenantId();
    const tests = await labOrderTests(tx, order.id);
    const specimens = await tx.specimen.findMany({
      where: { labOrderId: order.id },
      select: { specimenType: true, status: true },
    });
    const now = new Date();
    for (const item of input.items) {
      const def = tests.find((t) => t.id === item.testDefinitionId);
      if (!def) {
        throw new AppError('VALIDATION_FAILED', 'Tes ini bukan bagian dari order lab tersebut', 422, {
          testDefinitionId: item.testDefinitionId,
        });
      }
      if ((def.resultType === 'numeric') !== (item.valueNumeric !== null)) {
        throw new AppError(
          'VALIDATION_FAILED',
          `${def.name}: isi ${def.resultType === 'numeric' ? 'nilai angka' : 'teks hasil'}`,
          422,
          { testDefinitionId: def.id },
        );
      }
      if (!specimens.some((s) => s.specimenType === def.specimenType && s.status === 'diterima')) {
        throw supportError(
          'SPECIMEN_STATE_INVALID',
          { testDefinitionId: def.id },
          `Spesimen ${def.name} belum diterima lab`,
        );
      }
      const current = await this.currentResult(order.id, def.id);
      await this.writeResult(order, def, item.valueNumeric, item.valueText, now, {
        comment: item.comment ?? null,
        correction: current
          ? {
              supersedesId: current.id,
              rootId: current.rootId,
              version: current.version,
              reason: 'Perubahan hasil sebelum validasi teknis',
            }
          : null,
      });
    }
    await refreshLabOrderProgress(tx, tenantId, order.id, this.actorId());
    this.db.audit({
      action: 'create',
      resourceType: 'lab_result',
      resourceId: order.id,
      patientId: order.patientId,
      details: { items: input.items.length, source: 'manual' },
    });
    return this.detail(order.id, { audit: false });
  }

  private currentResult(labOrderId: string, testDefinitionId: string) {
    return this.tx().labResult.findFirst({
      where: { labOrderId, testDefinitionId, status: 'final', supersededBy: { none: {} } },
      orderBy: { recordedAt: 'desc' },
      select: { id: true, rootId: true, version: true },
    });
  }

  /** Simpan satu hasil (inti bersama dengan analyzer) + munculkan nilai kritis bila melewati batas kritis. */
  private async writeResult(
    order: { id: string; patientId: string; encounterId: string },
    def: Pick<LabTestDef, 'id' | 'loinc' | 'name' | 'unit' | 'decimals' | 'deltaLimit'>,
    valueNumeric: number | null,
    valueText: string | null,
    occurredAt: Date,
    extra: {
      comment: string | null;
      correction: { supersedesId: string; rootId: string; version: number; reason: string } | null;
    },
  ): Promise<{ id: string; flag: LabFlag }> {
    const tx = this.tx();
    const fields = await prepareLabResult(tx, { order, def, valueNumeric, valueText, occurredAt });
    const id = await insertLabResult(tx, this.db.tenantId(), {
      ...fields,
      occurredAt,
      authorUserId: this.actorId(),
      authorRole: this.actorRole(),
      source: 'manual',
      comment: extra.comment,
      correction: extra.correction,
    });
    if (fields.flag === 'KRITIS') {
      await this.critical.raise({
        source: 'lab',
        labResultId: id,
        analyte: def.name,
        valueText: labValueText(fields),
      });
    }
    return { id, flag: fields.flag };
  }

  async correct(resultId: string, input: LabResultCorrectionInput): Promise<LabOrderDetail> {
    const tx = this.tx();
    const r = await tx.labResult.findUnique({
      where: { id: resultId },
      select: {
        id: true,
        rootId: true,
        version: true,
        status: true,
        labOrderId: true,
        testDefinitionId: true,
        supersededBy: { select: { id: true } },
      },
    });
    if (!r) throw new AppError('NOT_FOUND', 'Hasil lab tidak ditemukan', 404);
    if (r.supersededBy.length > 0) {
      throw new AppError(
        'CONFLICT',
        'Versi hasil ini sudah dikoreksi; muat ulang lalu koreksi versi terbaru',
        409,
      );
    }
    const order = await this.order(r.labOrderId);
    if (order.status === 'batal') throw new AppError('CONFLICT', 'Order lab sudah dibatalkan', 409);
    const def = (await labOrderTests(tx, order.id)).find((t) => t.id === r.testDefinitionId);
    if (!def) throw new AppError('CONFLICT', 'Tes ini sudah dibatalkan dari order', 409);
    if ((def.resultType === 'numeric') !== (input.valueNumeric !== null)) {
      throw new AppError('VALIDATION_FAILED', `${def.name}: jenis nilai tidak sesuai`, 422);
    }
    const written = await this.writeResult(order, def, input.valueNumeric, input.valueText, new Date(), {
      comment: null,
      correction: { supersedesId: r.id, rootId: r.rootId, version: r.version, reason: input.reason },
    });
    const released = order.releasedAt !== null;
    // Hasil yang sudah divalidasi/dirilis harus divalidasi ulang (putaran baru).
    if (LOCKED.has(order.status)) {
      await setLabOrderStatus(tx, this.db.tenantId(), order, 'hasil', this.actorId(), {
        reason: 'Koreksi hasil; validasi ulang',
      });
    } else {
      await refreshLabOrderProgress(tx, this.db.tenantId(), order.id, this.actorId());
    }
    await this.events.publish('lab.result_corrected', {
      labResultId: written.id,
      supersedesId: r.id,
      labOrderId: order.id,
      encounterId: order.encounterId,
      patientId: order.patientId,
      unitId: order.unitId,
      released,
    });
    if (released) {
      await this.notifications.notify(
        await this.careTeam(order.encounterId),
        {
          kind: 'lab.result_corrected',
          title: 'Hasil laboratorium dikoreksi',
          body: `Hasil ${order.labNo} yang sudah dirilis dikoreksi laboratorium. Buka untuk melihat versi terbaru.`,
          link: `/klinis/ringkasan?kunjungan=${order.encounterId}`,
        },
        ['in_app'],
      );
    }
    this.db.audit({
      action: 'correct',
      resourceType: 'lab_result',
      resourceId: written.id,
      patientId: order.patientId,
      reason: input.reason,
      details: { supersedesId: r.id, released },
    });
    return this.detail(order.id, { audit: false });
  }

  // ------------------------------------------------------------------------------------------------------------
  // Validasi
  // ------------------------------------------------------------------------------------------------------------

  /** Putaran berjalan: naik bila hasil berubah setelah validasi terakhir putaran sebelumnya. */
  private async round(labOrderId: string): Promise<number> {
    const tx = this.tx();
    const last = await tx.labValidation.findFirst({
      where: { labOrderId },
      orderBy: [{ round: 'desc' }, { validatedAt: 'desc' }],
      select: { round: true, validatedAt: true },
    });
    if (!last) return 1;
    const changed = await tx.labResult.count({ where: { labOrderId, recordedAt: { gt: last.validatedAt } } });
    return changed > 0 ? last.round + 1 : last.round;
  }

  /** SHA-256 kanonik hasil versi terkini (id, nilai, flag) yang divalidasi. */
  private async snapshot(labOrderId: string): Promise<{ hash: string; rows: ResultRow[] }> {
    const rows = await this.tx().labResult.findMany({
      where: { labOrderId, supersededBy: { none: {} } },
      orderBy: [{ testDefinitionId: 'asc' }, { id: 'asc' }],
      include: { author: { select: { displayName: true } } },
    });
    const canon = rows.map((r) => [r.id, r.status, D(r.valueNumeric), r.valueText, r.flag]);
    return { hash: createHash('sha256').update(JSON.stringify(canon)).digest('hex'), rows };
  }

  /** QC hari ini ditolak (run terakhir per tes × level) untuk tes order ini. */
  private async qcRejectedToday(testIds: string[]): Promise<boolean> {
    const start = new Date(`${isoDateJakarta()}T00:00:00+07:00`);
    const runs = await this.tx().labQcRun.findMany({
      where: { testDefinitionId: { in: testIds }, runAt: { gte: start } },
      orderBy: [{ runAt: 'asc' }, { id: 'asc' }],
      select: { testDefinitionId: true, controlLevel: true, outcome: true },
    });
    const last = new Map<string, string>();
    for (const r of runs) last.set(`${r.testDefinitionId}:${r.controlLevel}`, r.outcome);
    return [...last.values()].includes('reject');
  }

  async validate(orderId: string, input: LabValidationInput): Promise<LabOrderDetail> {
    const order = await this.order(orderId);
    if (order.status === 'batal') throw new AppError('CONFLICT', 'Order lab sudah dibatalkan', 409);
    const tx = this.tx();
    const tenantId = this.db.tenantId();
    const actor = this.actorId();
    const round = await this.round(order.id);
    const existing = await tx.labValidation.findMany({
      where: { labOrderId: order.id, round },
      select: { level: true },
    });
    if (existing.some((v) => v.level === input.level)) {
      throw new AppError('CONFLICT', `Validasi ${input.level} putaran ini sudah dilakukan`, 409);
    }
    const criticalOpen = await this.critical.hasOpenCritical(order.id);
    const { hash, rows } = await this.snapshot(order.id);
    if (input.level === 'teknis') {
      const tests = await labOrderTests(tx, order.id);
      const block = technicalValidationBlock({
        resultsComplete: await labResultsComplete(tx, order.id),
        criticalOpen,
        qcRejected: await this.qcRejectedToday(tests.map((t) => t.id)),
        qcOverrideReason: input.qcOverrideReason,
      });
      if (block) throw supportError(block);
      await tx.labValidation.create({
        data: {
          id: newId(),
          tenantId,
          labOrderId: order.id,
          level: 'teknis',
          round,
          snapshotHash: hash,
          qcOverrideReason: input.qcOverrideReason?.trim() || null,
          validatedBy: actor,
          validatorRole: this.actorRole(),
        },
      });
      await setLabOrderStatus(tx, tenantId, order, 'validasi_teknis', actor);
      this.db.audit({
        action: 'verify',
        resourceType: 'lab_order',
        resourceId: order.id,
        patientId: order.patientId,
        details: { level: 'teknis', round, qcOverride: Boolean(input.qcOverrideReason) },
      });
      return this.detail(order.id, { audit: false });
    }

    const block = clinicalValidationBlock({
      technicalDone: existing.some((v) => v.level === 'teknis'),
      criticalOpen,
    });
    if (block) throw supportError(block);
    const now = new Date();
    const issued = await this.issueReport(order, rows, now);
    await tx.labValidation.create({
      data: {
        id: newId(),
        tenantId,
        labOrderId: order.id,
        level: 'klinis',
        round,
        snapshotHash: hash,
        documentId: issued.document.id,
        validatedBy: actor,
        validatorRole: this.actorRole(),
      },
    });
    await setLabOrderStatus(tx, tenantId, order, 'selesai', actor, {
      releasedAt: order.releasedAt ? undefined : now,
    });
    await this.publishObservations(order, rows);
    const finals = rows.filter((r) => r.status === 'final');
    await this.events.publish('lab.result_released', {
      labOrderId: order.id,
      encounterId: order.encounterId,
      patientId: order.patientId,
      unitId: order.unitId,
      labResultIds: finals.map((r) => r.id),
    });
    await this.notifications.notify(
      await this.careTeam(order.encounterId),
      {
        kind: 'lab.result_released',
        title: 'Hasil laboratorium sudah dirilis',
        body: `Hasil ${order.labNo} sudah divalidasi dokter laboratorium. Buka untuk melihat.`,
        link: `/klinis/ringkasan?kunjungan=${order.encounterId}`,
      },
      ['in_app'],
    );
    this.db.audit({
      action: 'sign',
      resourceType: 'lab_order',
      resourceId: order.id,
      patientId: order.patientId,
      details: { level: 'klinis', round, documentId: issued.document.id },
    });
    return this.detail(order.id, { audit: false });
  }

  /** Laporan hasil ber-TTE dokter lab (ADR-0029): snapshot hasil versi terkini saat rilis. */
  private async issueReport(
    order: { id: string; labNo: string; patientId: string; encounterId: string },
    rows: ResultRow[],
    issuedAt: Date,
  ) {
    const enc = await this.tx().encounter.findUniqueOrThrow({
      where: { id: order.encounterId },
      select: { number: true, unit: { select: { name: true } } },
    });
    const table = rows
      .filter((r) => r.status === 'final')
      .map((r) => [
        r.name,
        labValueText({
          valueNumeric: D(r.valueNumeric),
          valueText: r.valueText,
          decimals: r.decimals,
          unit: r.unit,
        }),
        rangeText(D(r.refLow), D(r.refHigh)) ?? '-',
        r.flag === 'N' ? '' : r.flag,
      ]);
    return this.pdf.issue({
      patientId: order.patientId,
      kind: 'hasil',
      title: 'Hasil pemeriksaan laboratorium',
      fileName: `hasil lab ${order.labNo}`,
      number: order.labNo,
      issuedAt,
      patientExtra: [
        { label: 'Kunjungan', value: enc.number },
        { label: 'Ruang', value: enc.unit.name },
      ],
      sections: [
        {
          title: 'Hasil',
          blocks: [
            {
              kind: 'table',
              columns: ['Pemeriksaan', 'Hasil', 'Rujukan', 'Flag'],
              widths: [40, 25, 25, 10],
              rows: table.length > 0 ? table : [['-', '-', '-', '-']],
            },
          ],
        },
      ],
      tte: { role: 'Dokter penanggung jawab laboratorium', caption: null },
    });
  }

  /**
   * Muara hasil fase 3 (K08, `observations`): hasil rilis tampil di panel hasil CPOE, ringkasan pasien, dan resume
   * tanpa modul itu membaca tabel lab. Satu observasi per (order CPOE, tes); koreksi setelah rilis = versi observasi
   * baru beralasan. Nilai yang sama tidak ditulis ulang.
   */
  private async publishObservations(order: { id: string; encounterId: string }, rows: ResultRow[]) {
    const tx = this.tx();
    const tenantId = this.db.tenantId();
    const tests = await labOrderTests(tx, order.id);
    for (const r of rows.filter((x) => x.status === 'final')) {
      const def = tests.find((t) => t.id === r.testDefinitionId);
      if (!def) continue;
      const valueNumeric = D(r.valueNumeric);
      const unit = r.unit || null;
      const current = await tx.observation.findFirst({
        where: {
          serviceRequestId: def.serviceRequestId,
          category: 'lab',
          display: r.name,
          supersededBy: { none: {} },
        },
        select: { id: true, rootId: true, version: true, valueNumeric: true, valueText: true },
      });
      if (current && D(current.valueNumeric) === valueNumeric && current.valueText === r.valueText) continue;
      const id = newId();
      await tx.observation.create({
        data: {
          id,
          tenantId,
          patientId: r.patientId,
          encounterId: r.encounterId,
          rootId: current?.rootId ?? id,
          version: current ? current.version + 1 : 1,
          supersedesId: current?.id ?? null,
          correctionReason: current ? 'Koreksi hasil laboratorium setelah rilis' : null,
          occurredAt: r.occurredAt,
          authorUserId: this.actorId(),
          authorRole: this.actorRole(),
          category: 'lab',
          codeSystem: r.loinc ? 'loinc' : null,
          code: r.loinc,
          display: r.name,
          valueNumeric,
          valueUnit: unit,
          valueText: r.valueText,
          interpretation: FLAG_INTERPRETATION[r.flag as LabFlag] ?? null,
          referenceRange: rangeText(D(r.refLow), D(r.refHigh)),
          serviceRequestId: def.serviceRequestId,
        },
      });
    }
  }

  // ------------------------------------------------------------------------------------------------------------
  // Detail
  // ------------------------------------------------------------------------------------------------------------

  async detail(id: string, opts: { audit: boolean } = { audit: true }): Promise<LabOrderDetail> {
    const o = await this.order(id);
    const tx = this.tx();
    const [items, specimens, validations, rows, tests, criticals] = await Promise.all([
      tx.labOrderItem.findMany({
        where: { labOrderId: o.id, voidedAt: null },
        select: { serviceRequest: { select: SR_SELECT } },
        orderBy: { createdAt: 'asc' },
      }),
      tx.specimen.findMany({ where: { labOrderId: o.id }, orderBy: { barcode: 'asc' } }),
      tx.labValidation.findMany({
        where: { labOrderId: o.id },
        orderBy: [{ round: 'asc' }, { validatedAt: 'asc' }],
        select: {
          level: true,
          round: true,
          validatedAt: true,
          documentId: true,
          validator: { select: { displayName: true } },
        },
      }),
      tx.labResult.findMany({
        where: { labOrderId: o.id, supersededBy: { none: {} } },
        include: { author: { select: { displayName: true } } },
        orderBy: [{ recordedAt: 'asc' }, { id: 'asc' }],
      }),
      labOrderTests(tx, o.id),
      tx.criticalResult.findMany({ where: { labResult: { labOrderId: o.id } }, select: { id: true } }),
    ]);
    const docIds = validations.flatMap((v) => (v.documentId ? [v.documentId] : []));
    const sigs = docIds.length
      ? await tx.documentSignature.findMany({
          where: { documentId: { in: docIds } },
          select: { documentId: true, status: true },
        })
      : [];
    const patient = (await tx.patient.findUniqueOrThrow({
      where: { id: o.patientId },
      select: PATIENT_SELECT,
    })) as PatientRow;
    const [allergies, egfr] = await Promise.all([
      this.diagnosis.allergiesOf(o.patientId),
      this.results.egfr(o.patientId),
    ]);
    const klinis = validations.filter((v) => v.level === 'klinis');
    const lastKlinisAt = klinis.at(-1)?.validatedAt ?? null;
    const record = (r: ResultRow): LabResultRecord => ({
      id: r.id,
      rootId: r.rootId,
      version: r.version,
      supersedesId: r.supersedesId,
      addendumOf: r.addendumOf,
      status: r.status as 'final' | 'entered_in_error',
      correctionReason: r.correctionReason,
      occurredAt: r.occurredAt.toISOString(),
      recordedAt: r.recordedAt.toISOString(),
      lateEntry: false,
      author: { userId: r.authorUserId, nama: r.author.displayName, peran: r.authorRole },
      locked: false,
      labOrderId: r.labOrderId,
      testDefinitionId: r.testDefinitionId,
      loinc: r.loinc,
      name: r.name,
      valueNumeric: D(r.valueNumeric),
      valueText: r.valueText,
      unit: r.unit,
      decimals: r.decimals,
      ref: r.refLow === null && r.refHigh === null ? null : { low: D(r.refLow), high: D(r.refHigh) },
      critical:
        r.criticalLow === null && r.criticalHigh === null
          ? null
          : { low: D(r.criticalLow), high: D(r.criticalHigh) },
      flag: r.flag as LabFlag,
      delta: r.delta,
      deltaComparedResultId: r.deltaComparedResultId,
      source: r.source as 'manual' | 'analyzer',
      resultStatus:
        r.status === 'entered_in_error'
          ? 'entered_in_error'
          : lastKlinisAt && lastKlinisAt.getTime() >= r.recordedAt.getTime()
            ? 'final'
            : 'preliminary',
      comment: r.comment,
    });
    if (opts.audit) {
      this.db.audit({
        action: 'read',
        resourceType: 'lab_order',
        resourceId: o.id,
        patientId: o.patientId,
        details: { results: rows.length },
      });
    }
    return {
      serverNow: new Date().toISOString(),
      id: o.id,
      labNo: o.labNo,
      status: o.status as LabOrderStatus,
      priority: priorityOf(o.priority),
      patient: {
        banner: banner(patient),
        allergies: allergyLabels(allergies),
        egfr: egfr?.value ?? null,
        weightKg: null,
      },
      orders: items.map((i) => orderRef(i.serviceRequest as SrRow)),
      specimens: specimens.map((s) => ({
        id: s.id,
        barcode: s.barcode,
        specimenType: s.specimenType,
        status: s.status as LabOrderDetail['specimens'][number]['status'],
        collectedAt: s.collectedAt?.toISOString() ?? null,
        receivedAt: s.receivedAt?.toISOString() ?? null,
        rejectedReason: (s.rejectedReason as LabOrderDetail['specimens'][number]['rejectedReason']) ?? null,
      })),
      results: rows.map(record),
      previous: await this.previous(o, tests),
      validations: validations.map((v) => ({
        level: v.level as 'teknis' | 'klinis',
        by: v.validator.displayName,
        at: v.validatedAt.toISOString(),
        signatureStatus:
          v.level === 'klinis'
            ? ((sigs.find((s) => s.documentId === v.documentId)?.status as 'pending' | 'signed' | 'failed') ??
              'pending')
            : null,
      })),
      criticalResultIds: criticals.map((c) => c.id),
      tests: tests.map((t) => ({
        testDefinitionId: t.id,
        code: t.code,
        loinc: t.loinc,
        name: t.name,
        unit: t.unit,
        decimals: t.decimals,
        resultType: t.resultType === 'text' ? 'text' : 'numeric',
        specimenType: t.specimenType,
      })),
      round: await this.round(o.id),
      receivedAt: o.receivedAt?.toISOString() ?? null,
      releasedAt: o.releasedAt?.toISOString() ?? null,
    };
  }

  /** Hingga 5 hasil final rilis sebelumnya per LOINC dari kelompok rekam medis (lama → baru). */
  private async previous(o: { id: string; patientId: string }, tests: LabTestDef[]) {
    const loincs = [...new Set(tests.flatMap((t) => (t.loinc ? [t.loinc] : [])))];
    if (loincs.length === 0) return {};
    const rows = await this.tx().$queryRaw<Array<{ loinc: string; at: Date; value: Prisma.Decimal }>>`
      SELECT loinc, occurred_at AS at, value_numeric AS value FROM (
        SELECT r.loinc, r.occurred_at, r.value_numeric,
               row_number() OVER (PARTITION BY r.loinc ORDER BY r.occurred_at DESC, r.id DESC) AS n
        FROM lab_results_current r
        JOIN lab_orders lo ON lo.tenant_id = r.tenant_id AND lo.id = r.lab_order_id
        WHERE r.patient_id IN (SELECT app_patient_group(${o.patientId}::uuid))
          AND r.loinc = ANY(${loincs}::text[]) AND r.lab_order_id <> ${o.id}::uuid
          AND r.status = 'final' AND r.value_numeric IS NOT NULL AND lo.released_at IS NOT NULL
      ) x WHERE n <= 5 ORDER BY loinc, at ASC`;
    const out: LabOrderDetail['previous'] = {};
    for (const r of rows) {
      (out[r.loinc] ??= []).push({ at: r.at.toISOString(), valueNumeric: Number(r.value) });
    }
    return out;
  }

  // ------------------------------------------------------------------------------------------------------------
  // QC, master tes, pesan analyzer, cetak
  // ------------------------------------------------------------------------------------------------------------

  async tests(): Promise<LabTestDefinition[]> {
    const rows = await this.tx().labTestDefinition.findMany({
      where: { active: true },
      orderBy: [{ sortOrder: 'asc' }, { code: 'asc' }],
    });
    return rows.map((d) => ({
      id: d.id,
      code: d.code,
      loinc: d.loinc,
      name: d.name,
      specimenType: d.specimenType,
      unit: d.unit,
      decimals: d.decimals,
      resultType: d.resultType === 'text' ? 'text' : 'numeric',
      panelCode: d.panelCode,
      analyzerCode: d.analyzerCode,
      deltaLimit: D(d.deltaLimit),
      active: d.active,
    }));
  }

  async qcList(testDefinitionId: string | undefined): Promise<LabQcRun[]> {
    const rows = await this.tx().labQcRun.findMany({
      where: testDefinitionId ? { testDefinitionId } : {},
      orderBy: [{ runAt: 'desc' }, { id: 'desc' }],
      take: 100,
      include: { runner: { select: { displayName: true } } },
    });
    return rows.map((r) => ({
      id: r.id,
      analyzerId: r.analyzerId,
      testDefinitionId: r.testDefinitionId,
      controlLevel: r.controlLevel,
      value: Number(r.value),
      mean: Number(r.mean),
      sd: Number(r.sd),
      outcome: r.outcome as QcOutcome,
      violations: r.violations as WestgardRule[],
      runAt: r.runAt.toISOString(),
      by: r.runner.displayName,
    }));
  }

  async qcRun(input: LabQcRunInput): Promise<LabQcRun> {
    const tx = this.tx();
    const def = await tx.labTestDefinition.findUnique({
      where: { id: input.testDefinitionId },
      select: { id: true },
    });
    if (!def) throw new AppError('NOT_FOUND', 'Tes lab tidak ditemukan', 404);
    if (input.analyzerId) {
      const a = await tx.labAnalyzer.findUnique({
        where: { id: input.analyzerId },
        select: { unitId: true },
      });
      if (!a) throw new AppError('NOT_FOUND', 'Analyzer tidak ditemukan', 404);
      this.assertUnit(a.unitId);
    }
    const history = await tx.labQcRun.findMany({
      where: { testDefinitionId: input.testDefinitionId, controlLevel: input.controlLevel },
      orderBy: [{ runAt: 'desc' }, { id: 'desc' }],
      take: 10,
      select: { value: true, mean: true, sd: true },
    });
    const previous = history.reverse().map((h) => qcZScore(Number(h.value), Number(h.mean), Number(h.sd)));
    const evaluated = westgardEvaluate(qcZScore(input.value, input.mean, input.sd), previous);
    const id = newId();
    await tx.labQcRun.create({
      data: {
        id,
        tenantId: this.db.tenantId(),
        analyzerId: input.analyzerId,
        testDefinitionId: input.testDefinitionId,
        controlLevel: input.controlLevel,
        value: input.value,
        mean: input.mean,
        sd: input.sd,
        outcome: evaluated.outcome,
        violations: evaluated.violations,
        runBy: this.actorId(),
      },
    });
    this.db.audit({
      action: 'create',
      resourceType: 'lab_qc_run',
      resourceId: id,
      details: { outcome: evaluated.outcome, violations: evaluated.violations },
    });
    const [run] = await this.qcList(input.testDefinitionId);
    if (!run || run.id !== id) throw new Error('QC run tidak terbaca setelah disimpan');
    return run;
  }

  /** Pesan analyzer yang gagal/berhenti diproses untuk analyzer di unit dalam lingkup (tanpa isi pesan). */
  async inboundIssues(): Promise<LabInboundIssue[]> {
    const units = this.units();
    if (units && units.length === 0) return [];
    const rows = await this.tx().inboundEvent.findMany({
      where: {
        source: 'lis-hl7',
        status: { in: ['failed', 'dead'] },
        ...(units ? { device: { unitId: { in: units } } } : {}),
      },
      orderBy: [{ receivedAt: 'desc' }, { id: 'desc' }],
      take: 50,
      select: { id: true, idempotencyKey: true, status: true, attempts: true, error: true, receivedAt: true },
    });
    return rows.map((r) => ({
      id: r.id,
      controlId: r.idempotencyKey,
      status: r.status as 'failed' | 'dead',
      attempts: r.attempts,
      error: r.error,
      receivedAt: r.receivedAt.toISOString(),
    }));
  }

  /** Cetak hasil (HTML, P12 menyusul): watermark pencetak + waktu, status sementara bila belum dirilis. */
  async print(id: string): Promise<string> {
    const d = await this.detail(id, { audit: false });
    const printer = (
      await this.tx().user.findUnique({ where: { id: this.actorId() }, select: { displayName: true } })
    )?.displayName;
    const esc = (s: string) =>
      s.replace(
        /[&<>"']/g,
        (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c] as string,
      );
    const rows = d.results
      .filter((r) => r.status === 'final')
      .map(
        (r) =>
          `<tr><td>${esc(r.name)}</td><td>${esc(
            labValueText({
              valueNumeric: r.valueNumeric,
              valueText: r.valueText,
              decimals: r.decimals,
              unit: r.unit,
            }),
          )}</td><td>${esc(rangeText(r.ref?.low ?? null, r.ref?.high ?? null) ?? '-')}</td><td>${
            r.flag === 'N' ? '' : esc(r.flag)
          }</td></tr>`,
      )
      .join('');
    const status =
      d.releasedAt && d.status === 'selesai' ? 'Hasil final (tervalidasi)' : 'HASIL SEMENTARA, belum dirilis';
    this.db.audit({
      action: 'print',
      resourceType: 'lab_order',
      resourceId: d.id,
      patientId: d.patient.banner.id,
      details: { released: Boolean(d.releasedAt) },
    });
    return `<!doctype html><html lang="id"><head><meta charset="utf-8"><title>Hasil lab ${esc(d.labNo)}</title>
<style>body{font-family:system-ui,sans-serif;margin:24px;color:#111}table{border-collapse:collapse;width:100%}
td,th{border:1px solid #999;padding:6px 8px;text-align:left}.wm{position:fixed;inset:40% 0 auto;text-align:center;
font-size:28px;color:rgba(0,0,0,.08);transform:rotate(-20deg);pointer-events:none}</style></head><body>
<div class="wm">Dicetak ${esc(printer ?? '-')} · ${esc(new Date().toISOString())}</div>
<h1>Hasil pemeriksaan laboratorium</h1>
<p>No. lab ${esc(d.labNo)} · ${esc(status)}</p>
<p>${esc(d.patient.banner.name)} · RM ${esc(d.patient.banner.mrn)}</p>
<table><thead><tr><th>Pemeriksaan</th><th>Hasil</th><th>Rujukan</th><th>Flag</th></tr></thead><tbody>${rows}</tbody></table>
</body></html>`;
  }
}
