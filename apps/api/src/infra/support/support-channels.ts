import type { TenantTx } from '@simrs/db';
import {
  type CriticalResultSseEvent,
  type CriticalStatus,
  isoDateJakarta,
  isUuid,
  type LabOrderStatus,
  type LabWorklistSseEvent,
  type PharmacyQueueSseEvent,
  type PrescriptionStatus,
  SUPPORT_NOTIFY_CHANNELS,
  SUPPORT_SSE_EVENTS,
  type SurgeryBoardSseEvent,
  type SurgeryCaseStatus,
} from '@simrs/shared';
import type { SseChannel, SseEvent } from '../realtime/sse.service';

/**
 * Fase 4 §4.1a · Kanal SSE penunjang (ADR-0026). `pg_notify` membawa tenant + id baris riwayat status; isinya dibaca
 * di transaksi pendek tenant pelanggan (RLS). Muatan hanya ID + kode status + waktu. Replay `Last-Event-ID` berurutan
 * menurut waktu ubah + id (riwayat status append-only, waktu dari server).
 */

type Hist = { id: string; changedAt: Date };

/** Baris riwayat setelah `afterId` (waktu ubah, lalu id), atau [] bila `afterId` bukan baris kanal ini. */
async function replayAfter<R extends Hist>(
  afterId: string,
  limit: number,
  find: (id: string) => Promise<{ changedAt: Date } | null>,
  page: (after: { id: string; changedAt: Date }, limit: number) => Promise<R[]>,
): Promise<R[]> {
  if (!isUuid(afterId)) return [];
  const after = await find(afterId);
  return after ? page({ id: afterId, changedAt: after.changedAt }, limit) : [];
}

const afterWhere = (a: { id: string; changedAt: Date }) => ({
  OR: [{ changedAt: { gt: a.changedAt } }, { changedAt: a.changedAt, id: { gt: a.id } }],
});
const histOrder = [{ changedAt: 'asc' as const }, { id: 'asc' as const }];

// ---------------------------------------------------------------------------------------------------------------
// Worklist lab per unit
// ---------------------------------------------------------------------------------------------------------------

const labSelect = {
  id: true,
  toStatus: true,
  changedAt: true,
  labOrder: { select: { id: true, unitId: true } },
} as const;
type LabHist = { id: string; toStatus: string; changedAt: Date; labOrder: { id: string; unitId: string } };

const labEvent = (r: LabHist): SseEvent<LabWorklistSseEvent> => ({
  id: r.id,
  event: SUPPORT_SSE_EVENTS.labWorklist,
  data: {
    eventId: r.id,
    labOrderId: r.labOrder.id,
    unitId: r.labOrder.unitId,
    status: r.toStatus as LabOrderStatus,
    at: r.changedAt.toISOString(),
  },
});

export const labWorklistChannel: SseChannel<LabWorklistSseEvent> = {
  name: SUPPORT_NOTIFY_CHANNELS.labWorklist,
  async load(tx: TenantTx, id: string) {
    const r = await tx.labOrderStatusHistory.findUnique({ where: { id }, select: labSelect });
    return r ? labEvent(r) : null;
  },
  async replay(tx: TenantTx, afterId: string, limit: number) {
    const rows = await replayAfter(
      afterId,
      limit,
      (id) => tx.labOrderStatusHistory.findUnique({ where: { id }, select: { changedAt: true } }),
      (a, take) =>
        tx.labOrderStatusHistory.findMany({
          where: afterWhere(a),
          orderBy: histOrder,
          take,
          select: labSelect,
        }),
    );
    return rows.map(labEvent);
  },
};

// ---------------------------------------------------------------------------------------------------------------
// Antrean depo farmasi per unit depo
// ---------------------------------------------------------------------------------------------------------------

const rxSelect = {
  id: true,
  toStatus: true,
  changedAt: true,
  prescription: { select: { id: true, stockLocationId: true, stockLocation: { select: { unitId: true } } } },
} as const;
type RxHist = {
  id: string;
  toStatus: string;
  changedAt: Date;
  prescription: { id: string; stockLocationId: string; stockLocation: { unitId: string } };
};

const rxEvent = (r: RxHist): SseEvent<PharmacyQueueSseEvent> => ({
  id: r.id,
  event: SUPPORT_SSE_EVENTS.pharmacyQueue,
  data: {
    eventId: r.id,
    prescriptionId: r.prescription.id,
    stockLocationId: r.prescription.stockLocationId,
    unitId: r.prescription.stockLocation.unitId,
    status: r.toStatus as PrescriptionStatus,
    at: r.changedAt.toISOString(),
  },
});

export const pharmacyQueueChannel: SseChannel<PharmacyQueueSseEvent> = {
  name: SUPPORT_NOTIFY_CHANNELS.pharmacyQueue,
  async load(tx: TenantTx, id: string) {
    const r = await tx.pharmacyPrescriptionStatusHistory.findUnique({ where: { id }, select: rxSelect });
    return r ? rxEvent(r) : null;
  },
  async replay(tx: TenantTx, afterId: string, limit: number) {
    const rows = await replayAfter(
      afterId,
      limit,
      (id) => tx.pharmacyPrescriptionStatusHistory.findUnique({ where: { id }, select: { changedAt: true } }),
      (a, take) =>
        tx.pharmacyPrescriptionStatusHistory.findMany({
          where: afterWhere(a),
          orderBy: histOrder,
          take,
          select: rxSelect,
        }),
    );
    return rows.map(rxEvent);
  },
};

// ---------------------------------------------------------------------------------------------------------------
// Papan kamar operasi per tanggal
// ---------------------------------------------------------------------------------------------------------------

const okSelect = {
  id: true,
  toStatus: true,
  changedAt: true,
  surgeryCase: {
    select: { id: true, encounterId: true, roomId: true, startsAt: true, room: { select: { unitId: true } } },
  },
} as const;
type OkHist = {
  id: string;
  toStatus: string;
  changedAt: Date;
  surgeryCase: { id: string; encounterId: string; roomId: string; startsAt: Date; room: { unitId: string } };
};

const okEvent = (r: OkHist): SseEvent<SurgeryBoardSseEvent> => ({
  id: r.id,
  event: SUPPORT_SSE_EVENTS.surgeryBoard,
  data: {
    eventId: r.id,
    surgeryCaseId: r.surgeryCase.id,
    encounterId: r.surgeryCase.encounterId,
    roomId: r.surgeryCase.roomId,
    unitId: r.surgeryCase.room.unitId,
    date: isoDateJakarta(r.surgeryCase.startsAt),
    status: r.toStatus as SurgeryCaseStatus,
    at: r.changedAt.toISOString(),
  },
});

export const surgeryBoardChannel: SseChannel<SurgeryBoardSseEvent> = {
  name: SUPPORT_NOTIFY_CHANNELS.surgeryBoard,
  async load(tx: TenantTx, id: string) {
    const r = await tx.surgeryCaseStatusHistory.findUnique({ where: { id }, select: okSelect });
    return r ? okEvent(r) : null;
  },
  async replay(tx: TenantTx, afterId: string, limit: number) {
    const rows = await replayAfter(
      afterId,
      limit,
      (id) => tx.surgeryCaseStatusHistory.findUnique({ where: { id }, select: { changedAt: true } }),
      (a, take) =>
        tx.surgeryCaseStatusHistory.findMany({
          where: afterWhere(a),
          orderBy: histOrder,
          take,
          select: okSelect,
        }),
    );
    return rows.map(okEvent);
  },
};

// ---------------------------------------------------------------------------------------------------------------
// Nilai kritis: muncul, dilaporkan, dieskalasi (tanpa replay; layar memuat ulang daftar saat sambung ulang)
// ---------------------------------------------------------------------------------------------------------------

const crSelect = { id: true, encounterId: true, unitId: true, status: true, raisedAt: true } as const;
type CrRow = { id: string; encounterId: string; unitId: string; status: string; raisedAt: Date };

function crEvent(
  eventId: string,
  kind: CriticalResultSseEvent['kind'],
  c: CrRow,
  at: Date,
  extra: { level?: number; notifiedUserIds?: string[] } = {},
): SseEvent<CriticalResultSseEvent> {
  return {
    id: eventId,
    event: SUPPORT_SSE_EVENTS.critical,
    data: {
      eventId,
      kind,
      criticalResultId: c.id,
      encounterId: c.encounterId,
      unitId: c.unitId,
      status: c.status as CriticalStatus,
      level: extra.level ?? 0,
      notifiedUserIds: extra.notifiedUserIds ?? [],
      at: at.toISOString(),
    },
  };
}

export const criticalChannel: SseChannel<CriticalResultSseEvent> = {
  name: SUPPORT_NOTIFY_CHANNELS.critical,
  async load(tx: TenantTx, id: string) {
    const c = await tx.criticalResult.findUnique({ where: { id }, select: crSelect });
    if (c) return crEvent(id, 'raised', c, c.raisedAt);
    const rep = await tx.criticalResultReport.findUnique({
      where: { id },
      select: { reportedAt: true, criticalResult: { select: crSelect } },
    });
    if (rep) return crEvent(id, 'reported', rep.criticalResult, rep.reportedAt);
    const esc = await tx.criticalResultEscalation.findUnique({
      where: { id },
      select: { level: true, notifiedUserIds: true, escalatedAt: true, criticalResult: { select: crSelect } },
    });
    return esc
      ? crEvent(id, 'escalated', esc.criticalResult, esc.escalatedAt, {
          level: esc.level,
          notifiedUserIds: esc.notifiedUserIds,
        })
      : null;
  },
};
