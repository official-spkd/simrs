import {
  deltaCheck,
  type LabFlag,
  type LabOrderStatus,
  labFlag,
  newId,
  pickReferenceRange,
} from '@simrs/shared';
import type { Prisma, TenantTx } from './client';
import { readTenantSetting } from './platform';

/**
 * S01 · Inti laboratorium yang dipakai API (input manual, koreksi) DAN worker (hasil analyzer), agar flag, rentang
 * rujukan, delta check, status order, dan nilai kritis dihitung sama persis dari mana pun hasil datang (rencana fase 4
 * §4.2). Semua fungsi dijalankan di transaksi tenant pemanggil (RLS).
 */

const D = (v: Prisma.Decimal | null | undefined): number | null =>
  v === null || v === undefined ? null : Number(v);
const MS_PER_DAY = 86_400_000;

export interface LabTestDef {
  id: string;
  code: string;
  loinc: string | null;
  name: string;
  specimenType: string;
  unit: string;
  decimals: number;
  resultType: string;
  panelCode: string | null;
  analyzerCode: string | null;
  deltaLimit: number | null;
  sortOrder: number;
  /** Order fase 3 asal tes ini. */
  serviceRequestId: string;
}

/**
 * Tes lab yang diharapkan dari item order aktif (tidak dibatalkan): tes tunggal lewat `orderable_id`, order panel lewat
 * `orderables.lab_panel_code` → `lab_test_definitions.panel_code`. Urut `sort_order`, tanpa duplikat tes.
 */
export async function labOrderTests(tx: TenantTx, labOrderId: string): Promise<LabTestDef[]> {
  const items = await tx.labOrderItem.findMany({
    where: { labOrderId, voidedAt: null },
    select: {
      serviceRequestId: true,
      serviceRequest: { select: { orderableId: true, orderable: { select: { labPanelCode: true } } } },
    },
  });
  return testsForOrderables(
    tx,
    items.map((i) => ({
      serviceRequestId: i.serviceRequestId,
      orderableId: i.serviceRequest.orderableId,
      panelCode: i.serviceRequest.orderable.labPanelCode,
    })),
  );
}

/** Tes untuk sekumpulan order (dipakai juga saat menerima order, sebelum item tersimpan). */
export async function testsForOrderables(
  tx: TenantTx,
  orders: ReadonlyArray<{ serviceRequestId: string; orderableId: string; panelCode: string | null }>,
): Promise<LabTestDef[]> {
  if (orders.length === 0) return [];
  const panels = [...new Set(orders.map((o) => o.panelCode).filter((p): p is string => p !== null))];
  const defs = await tx.labTestDefinition.findMany({
    where: {
      active: true,
      OR: [
        { orderableId: { in: orders.map((o) => o.orderableId) } },
        ...(panels.length > 0 ? [{ panelCode: { in: panels } }] : []),
      ],
    },
    orderBy: [{ sortOrder: 'asc' }, { code: 'asc' }],
  });
  const out: LabTestDef[] = [];
  const seen = new Set<string>();
  for (const d of defs) {
    if (seen.has(d.id)) continue;
    const src =
      orders.find((o) => o.panelCode === null && o.orderableId === d.orderableId) ??
      orders.find((o) => o.panelCode !== null && o.panelCode === d.panelCode);
    if (!src) continue;
    seen.add(d.id);
    out.push({
      id: d.id,
      code: d.code,
      loinc: d.loinc,
      name: d.name,
      specimenType: d.specimenType,
      unit: d.unit,
      decimals: d.decimals,
      resultType: d.resultType,
      panelCode: d.panelCode,
      analyzerCode: d.analyzerCode,
      deltaLimit: D(d.deltaLimit),
      sortOrder: d.sortOrder,
      serviceRequestId: src.serviceRequestId,
    });
  }
  return out;
}

export interface LabResultFields {
  patientId: string;
  encounterId: string;
  labOrderId: string;
  testDefinitionId: string;
  loinc: string | null;
  name: string;
  valueNumeric: number | null;
  valueText: string | null;
  unit: string;
  decimals: number;
  refLow: number | null;
  refHigh: number | null;
  criticalLow: number | null;
  criticalHigh: number | null;
  flag: LabFlag;
  delta: boolean;
  deltaComparedResultId: string | null;
}

/**
 * Hitung kolom hasil dari definisi tes + pasien SAAT sampel: rentang rujukan/batas kritis per jenis kelamin × umur
 * (hari), flag, dan delta check terhadap hasil final terakhir tes yang sama di kelompok rekam medis (order lain yang
 * sudah dirilis). Nilai teks: flag N tanpa rentang.
 */
export async function prepareLabResult(
  tx: TenantTx,
  input: {
    order: { id: string; patientId: string; encounterId: string };
    def: Pick<LabTestDef, 'id' | 'loinc' | 'name' | 'unit' | 'decimals' | 'deltaLimit'>;
    valueNumeric: number | null;
    valueText: string | null;
    occurredAt: Date;
  },
): Promise<LabResultFields> {
  const base = {
    patientId: input.order.patientId,
    encounterId: input.order.encounterId,
    labOrderId: input.order.id,
    testDefinitionId: input.def.id,
    loinc: input.def.loinc,
    name: input.def.name,
    valueNumeric: input.valueNumeric,
    valueText: input.valueText,
    unit: input.def.unit,
    decimals: input.def.decimals,
  };
  if (input.valueNumeric === null) {
    return {
      ...base,
      refLow: null,
      refHigh: null,
      criticalLow: null,
      criticalHigh: null,
      flag: 'N',
      delta: false,
      deltaComparedResultId: null,
    };
  }
  const patient = await tx.patient.findUniqueOrThrow({
    where: { id: input.order.patientId },
    select: { sex: true, birthDate: true },
  });
  const ageDays = patient.birthDate
    ? Math.max(0, Math.floor((input.occurredAt.getTime() - patient.birthDate.getTime()) / MS_PER_DAY))
    : 365 * 30; // tanpa tanggal lahir: anggap dewasa (rentang `any`/dewasa)
  const ranges = await tx.labReferenceRange.findMany({ where: { testDefinitionId: input.def.id } });
  const sex = patient.sex === 'male' || patient.sex === 'female' ? patient.sex : 'unknown';
  const range = pickReferenceRange(
    ranges.map((r) => ({ ...r, sex: r.sex as 'male' | 'female' | 'any' })),
    sex,
    ageDays,
  );
  const ref = range ? { low: D(range.refLow), high: D(range.refHigh) } : null;
  const critical = range ? { low: D(range.criticalLow), high: D(range.criticalHigh) } : null;
  const previous = await tx.$queryRaw<Array<{ id: string; value: Prisma.Decimal }>>`
    SELECT r.id::text AS id, r.value_numeric AS value
    FROM lab_results_current r
    JOIN lab_orders o ON o.tenant_id = r.tenant_id AND o.id = r.lab_order_id
    WHERE r.patient_id IN (SELECT app_patient_group(${input.order.patientId}::uuid))
      AND r.test_definition_id = ${input.def.id}::uuid
      AND r.lab_order_id <> ${input.order.id}::uuid
      AND r.status = 'final' AND r.value_numeric IS NOT NULL
      AND o.released_at IS NOT NULL AND r.occurred_at < ${input.occurredAt}
    ORDER BY r.occurred_at DESC, r.id DESC
    LIMIT 5`;
  const prevValues = previous.map((p) => Number(p.value)).reverse();
  const delta = deltaCheck(input.valueNumeric, prevValues, input.def.deltaLimit);
  return {
    ...base,
    refLow: ref?.low ?? null,
    refHigh: ref?.high ?? null,
    criticalLow: critical?.low ?? null,
    criticalHigh: critical?.high ?? null,
    flag: labFlag(input.valueNumeric, ref, critical),
    delta,
    deltaComparedResultId: delta ? (previous[0]?.id ?? null) : null,
  };
}

/** Simpan satu versi hasil (versi 1, atau koreksi `supersedes` dengan alasan). Mengembalikan id baris. */
export async function insertLabResult(
  tx: TenantTx,
  tenantId: string,
  f: LabResultFields & {
    occurredAt: Date;
    authorUserId: string;
    authorRole: string;
    source: 'manual' | 'analyzer';
    inboundEventId?: string | null;
    comment?: string | null;
    correction?: { supersedesId: string; rootId: string; version: number; reason: string } | null;
  },
): Promise<string> {
  const id = newId();
  await tx.labResult.create({
    data: {
      id,
      tenantId,
      rootId: f.correction?.rootId ?? id,
      version: f.correction ? f.correction.version + 1 : 1,
      supersedesId: f.correction?.supersedesId ?? null,
      correctionReason: f.correction?.reason ?? null,
      patientId: f.patientId,
      encounterId: f.encounterId,
      occurredAt: f.occurredAt,
      authorUserId: f.authorUserId,
      authorRole: f.authorRole,
      labOrderId: f.labOrderId,
      testDefinitionId: f.testDefinitionId,
      loinc: f.loinc,
      name: f.name,
      valueNumeric: f.valueNumeric,
      valueText: f.valueText,
      unit: f.unit,
      decimals: f.decimals,
      refLow: f.refLow,
      refHigh: f.refHigh,
      criticalLow: f.criticalLow,
      criticalHigh: f.criticalHigh,
      flag: f.flag,
      delta: f.delta,
      deltaComparedResultId: f.deltaComparedResultId,
      source: f.source,
      inboundEventId: f.inboundEventId ?? null,
      comment: f.comment ?? null,
    },
  });
  return id;
}

/** Teks nilai untuk layar berizin (bukan notifikasi): angka dengan desimal tes + satuan. */
export function labValueText(
  f: Pick<LabResultFields, 'valueNumeric' | 'valueText' | 'decimals' | 'unit'>,
): string {
  const v =
    f.valueNumeric === null ? (f.valueText ?? '') : f.valueNumeric.toFixed(f.decimals).replace('.', ',');
  return f.unit ? `${v} ${f.unit}` : v;
}

export interface RaisedCriticalRow {
  id: string;
  created: boolean;
  limitMinutes: number;
  encounterId: string;
  patientId: string;
  unitId: string;
}

/**
 * S09 · Nilai kritis sekali per versi hasil lab / ekspertise (indeks unik), batas lapor dari pengaturan RS. Waktu
 * muncul + status dari trigger (jam server). Event `critical_result.raised` diterbitkan PEMANGGIL (API lewat
 * `DomainEvents`, worker lewat `recordDomainEvent`; event ini di `WORKER_EMITTED_EVENTS`).
 */
export async function raiseCriticalResult(
  tx: TenantTx,
  tenantId: string,
  input: { analyte: string; valueText: string; raisedBy: string | null } & (
    | { source: 'lab'; labResultId: string }
    | { source: 'radiology'; imagingReportId: string }
    /** 4.9b (ADR-0108): reaksi transfusi berat. */
    | { source: 'transfusion'; transfusionReactionId: string }
  ),
): Promise<RaisedCriticalRow> {
  const existing = await tx.criticalResult.findFirst({
    where:
      input.source === 'lab'
        ? { labResultId: input.labResultId }
        : input.source === 'radiology'
          ? { imagingReportId: input.imagingReportId }
          : { transfusionReactionId: input.transfusionReactionId },
    select: { id: true, limitMinutes: true, encounterId: true, patientId: true, unitId: true },
  });
  if (existing) return { ...existing, created: false };
  let src: { encounterId: string; patientId: string; unitId: string } | null = null;
  if (input.source === 'lab') {
    const r = await tx.labResult.findUnique({
      where: { id: input.labResultId },
      select: { encounterId: true, patientId: true, labOrder: { select: { unitId: true } } },
    });
    if (r) src = { encounterId: r.encounterId, patientId: r.patientId, unitId: r.labOrder.unitId };
  } else if (input.source === 'transfusion') {
    const x = await tx.transfusionReaction.findUnique({
      where: { id: input.transfusionReactionId },
      select: {
        bloodIssue: {
          select: { encounterId: true, patientId: true, encounter: { select: { unitId: true } } },
        },
      },
    });
    if (x) {
      src = {
        encounterId: x.bloodIssue.encounterId,
        patientId: x.bloodIssue.patientId,
        unitId: x.bloodIssue.encounter.unitId,
      };
    }
  } else {
    const r = await tx.imagingReport.findUnique({
      where: { id: input.imagingReportId },
      select: { encounterId: true, patientId: true, imagingStudy: { select: { unitId: true } } },
    });
    if (r) src = { encounterId: r.encounterId, patientId: r.patientId, unitId: r.imagingStudy.unitId };
  }
  if (!src) throw new Error(`Sumber nilai kritis tidak ditemukan (${input.source})`);
  const limitMinutes = await readTenantSetting(tx, 'critical.report_limit_minutes');
  const id = newId();
  await tx.criticalResult.create({
    data: {
      id,
      tenantId,
      source: input.source,
      labResultId: input.source === 'lab' ? input.labResultId : null,
      imagingReportId: input.source === 'radiology' ? input.imagingReportId : null,
      transfusionReactionId: input.source === 'transfusion' ? input.transfusionReactionId : null,
      ...src,
      analyte: input.analyte.slice(0, 120),
      valueText: input.valueText.slice(0, 200),
      limitMinutes,
      raisedBy: input.raisedBy,
    },
  });
  return { id, created: true, limitMinutes, ...src };
}

/** Ubah status order lab + catat riwayat (append-only; memicu SSE worklist). Tanpa perubahan → tidak menulis. */
export async function setLabOrderStatus(
  tx: TenantTx,
  tenantId: string,
  order: { id: string; status: string },
  to: LabOrderStatus,
  changedBy: string | null,
  extra: { receivedAt?: Date; releasedAt?: Date; reason?: string | null } = {},
): Promise<boolean> {
  if (order.status === to && !extra.receivedAt && !extra.releasedAt) return false;
  await tx.labOrder.update({
    where: { id: order.id },
    data: {
      status: to,
      ...(extra.receivedAt ? { receivedAt: extra.receivedAt } : {}),
      ...(extra.releasedAt ? { releasedAt: extra.releasedAt } : {}),
    },
  });
  if (order.status !== to) {
    await tx.labOrderStatusHistory.create({
      data: {
        id: newId(),
        tenantId,
        labOrderId: order.id,
        fromStatus: order.status,
        toStatus: to,
        changedBy,
        reason: extra.reason ?? null,
      },
    });
  }
  return order.status !== to;
}

/** Semua tes yang diharapkan punya hasil versi terkini berstatus final. */
export async function labResultsComplete(tx: TenantTx, labOrderId: string): Promise<boolean> {
  const tests = await labOrderTests(tx, labOrderId);
  if (tests.length === 0) return false;
  const rows = await tx.$queryRaw<Array<{ test_definition_id: string }>>`
    SELECT DISTINCT test_definition_id::text AS test_definition_id FROM lab_results_current
    WHERE lab_order_id = ${labOrderId}::uuid AND status = 'final'`;
  const have = new Set(rows.map((r) => r.test_definition_id));
  return tests.every((t) => have.has(t.id));
}

/**
 * Status alur order sebelum validasi dari keadaan spesimen + hasil: semua spesimen (selain ditolak) diterima →
 * `proses`; ada yang diambil/diterima → `sampel`; hasil lengkap → `hasil`. Status validasi/selesai/batal tidak
 * diturunkan di sini (diubah langsung oleh validasi/koreksi/pembatalan).
 */
export async function refreshLabOrderProgress(
  tx: TenantTx,
  tenantId: string,
  labOrderId: string,
  changedBy: string | null,
): Promise<LabOrderStatus> {
  const order = await tx.labOrder.findUniqueOrThrow({
    where: { id: labOrderId },
    select: { id: true, status: true, receivedAt: true },
  });
  if (['validasi_teknis', 'selesai', 'batal'].includes(order.status)) return order.status as LabOrderStatus;
  const specimens = await tx.specimen.findMany({
    where: { labOrderId },
    select: { status: true, receivedAt: true },
  });
  const live = specimens.filter((s) => s.status !== 'ditolak');
  let to: LabOrderStatus = 'diterima';
  if (live.some((s) => s.status === 'diambil' || s.status === 'diterima')) to = 'sampel';
  if (live.length > 0 && live.every((s) => s.status === 'diterima')) to = 'proses';
  if (await labResultsComplete(tx, labOrderId)) to = 'hasil';
  const firstReceived = live
    .map((s) => s.receivedAt)
    .filter((d): d is Date => d !== null)
    .sort((a, b) => a.getTime() - b.getTime())[0];
  await setLabOrderStatus(tx, tenantId, order, to, changedBy, {
    receivedAt: !order.receivedAt && firstReceived ? firstReceived : undefined,
  });
  return to;
}
