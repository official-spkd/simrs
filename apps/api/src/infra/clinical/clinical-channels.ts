import type { TenantTx } from '@simrs/db';
import {
  type BedRequestSseEvent,
  type BedRequestStatus,
  type BedStatus,
  type BedStatusSseEvent,
  CLINICAL_NOTIFY_CHANNELS,
  CLINICAL_SSE_EVENTS,
  type EdChangedSseEvent,
  type EdStatus,
  type EdStatusSseEvent,
  type EdZone,
  ewsNeedsEscalation,
  type EwsEscalationSseEvent,
  ewsRisk,
  isUuid,
} from '@simrs/shared';
import { readTenantSetting } from '@simrs/db';
import type { SseChannel, SseEvent } from '../realtime/sse.service';

/**
 * ADR-0026 · Kanal SSE klinis (potongan 3.1). Notifikasi `pg_notify` membawa tenant + id baris; isi dibaca di
 * transaksi pendek tenant pelanggan (RLS). Muatan tanpa nama/diagnosis: ID, kode status, angka.
 */

type EdRow = {
  id: string;
  encounterId: string;
  status: string;
  zone: string | null;
  changedAt: Date;
  encounter: { unitId: string };
};

const edSelect = {
  id: true,
  encounterId: true,
  status: true,
  zone: true,
  changedAt: true,
  encounter: { select: { unitId: true } },
} as const;

function edEvent(r: EdRow): SseEvent<EdStatusSseEvent> {
  return {
    id: r.id,
    event: CLINICAL_SSE_EVENTS.edStatus,
    data: {
      eventId: r.id,
      encounterId: r.encounterId,
      unitId: r.encounter.unitId,
      status: r.status as EdStatus,
      zone: (r.zone as EdZone | null) ?? null,
      at: r.changedAt.toISOString(),
    },
  };
}

function edChanged(
  id: string,
  source: EdChangedSseEvent['source'],
  encounterId: string,
  unitId: string,
  at: Date,
): SseEvent<EdChangedSseEvent> {
  return {
    id,
    event: CLINICAL_SSE_EVENTS.edChanged,
    data: { sourceId: id, source, encounterId, unitId, at: at.toISOString() },
  };
}

/**
 * Sinyal isi papan IGD selain status alur (ADR-0104): trigger `encounters` (kelas EMER), `triage_assessments`, dan
 * `bed_requests` mengirim id barisnya ke kanal yang sama. Id dicari berurutan di ketiga tabel (kunci primer, RLS);
 * permintaan bed kunjungan non-IGD diabaikan.
 */
async function loadEdChange(tx: TenantTx, id: string): Promise<SseEvent<EdChangedSseEvent> | null> {
  const triage = await tx.triageAssessment.findUnique({
    where: { id },
    select: { encounterId: true, recordedAt: true, encounter: { select: { unitId: true } } },
  });
  if (triage) return edChanged(id, 'triage', triage.encounterId, triage.encounter.unitId, triage.recordedAt);
  const enc = await tx.encounter.findUnique({
    where: { id },
    select: { encounterClass: true, unitId: true, updatedAt: true },
  });
  if (enc)
    return enc.encounterClass === 'EMER' ? edChanged(id, 'encounter', id, enc.unitId, enc.updatedAt) : null;
  const req = await tx.bedRequest.findUnique({
    where: { id },
    select: {
      encounterId: true,
      requestedAt: true,
      allocatedAt: true,
      closedAt: true,
      encounter: { select: { encounterClass: true, unitId: true } },
    },
  });
  if (!req || req.encounter.encounterClass !== 'EMER') return null;
  const at = req.closedAt ?? req.allocatedAt ?? req.requestedAt;
  return edChanged(id, 'bed_request', req.encounterId, req.encounter.unitId, at);
}

/**
 * Papan IGD: `ed_status_events` (id UUID v7 dari aplikasi, terurut → replay `id > Last-Event-ID`) + sinyal `ed.changed`
 * (tanpa replay; potret awal yang dikirim setiap sambung ulang adalah kebenarannya).
 */
export const edBoardChannel: SseChannel<EdStatusSseEvent | EdChangedSseEvent> = {
  name: CLINICAL_NOTIFY_CHANNELS.edBoard,
  async load(tx: TenantTx, id: string) {
    const row = await tx.edStatusEvent.findUnique({ where: { id }, select: edSelect });
    return row ? edEvent(row) : loadEdChange(tx, id);
  },
  async replay(tx: TenantTx, afterId: string, limit: number) {
    if (!isUuid(afterId)) return [];
    const rows = await tx.edStatusEvent.findMany({
      where: { id: { gt: afterId } },
      orderBy: { id: 'asc' },
      take: limit,
      select: edSelect,
    });
    return rows.map(edEvent);
  },
};

type BedRow = {
  id: string;
  toStatus: string;
  version: number;
  changedAt: Date;
  bedStatus: { locationId: string; unitId: string };
};

const bedSelect = {
  id: true,
  toStatus: true,
  version: true,
  changedAt: true,
  bedStatus: { select: { locationId: true, unitId: true } },
} as const;

function bedEvent(r: BedRow): SseEvent<BedStatusSseEvent> {
  return {
    id: r.id,
    event: CLINICAL_SSE_EVENTS.bedStatus,
    data: {
      eventId: r.id,
      bedId: r.bedStatus.locationId,
      unitId: r.bedStatus.unitId,
      status: r.toStatus as BedStatus,
      version: r.version,
      at: r.changedAt.toISOString(),
    },
  };
}

/** Permintaan bed (ADR-0104): unit tujuan = unit bed yang dialokasikan, atau unit yang diminta (null = mana pun). */
async function loadBedRequest(tx: TenantTx, id: string): Promise<SseEvent<BedRequestSseEvent> | null> {
  const r = await tx.bedRequest.findUnique({
    where: { id },
    select: {
      status: true,
      unitId: true,
      requestedAt: true,
      allocatedAt: true,
      closedAt: true,
      allocatedLocation: { select: { unitId: true } },
    },
  });
  if (!r) return null;
  return {
    id,
    event: CLINICAL_SSE_EVENTS.bedRequest,
    data: {
      requestId: id,
      unitId: r.allocatedLocation?.unitId ?? r.unitId,
      status: r.status as BedRequestStatus,
      at: (r.closedAt ?? r.allocatedAt ?? r.requestedAt).toISOString(),
    },
  };
}

/**
 * Papan bed: `bed_status_events` (ditulis trigger; id acak, jadi replay berurutan menurut waktu ubah + id setelah
 * event `Last-Event-ID`) + sinyal `bed.request` dari `bed_requests` (tanpa replay; potret awal tiap sambung ulang).
 */
export const bedBoardChannel: SseChannel<BedStatusSseEvent | BedRequestSseEvent> = {
  name: CLINICAL_NOTIFY_CHANNELS.bedBoard,
  async load(tx: TenantTx, id: string) {
    const row = await tx.bedStatusEvent.findUnique({ where: { id }, select: bedSelect });
    return row ? bedEvent(row) : loadBedRequest(tx, id);
  },
  async replay(tx: TenantTx, afterId: string, limit: number) {
    if (!isUuid(afterId)) return [];
    const after = await tx.bedStatusEvent.findUnique({ where: { id: afterId }, select: { changedAt: true } });
    if (!after) return [];
    const rows = await tx.bedStatusEvent.findMany({
      where: {
        OR: [{ changedAt: { gt: after.changedAt } }, { changedAt: after.changedAt, id: { gt: afterId } }],
      },
      orderBy: [{ changedAt: 'asc' }, { id: 'asc' }],
      take: limit,
      select: bedSelect,
    });
    return rows.map(bedEvent);
  },
};

/**
 * Eskalasi EWS: tanda vital ber-NEWS2 (trigger `observations_vitals_notify`); hanya yang melewati ambang RS
 * (`ews.escalation_score`) atau satu parameter bernilai 3 yang dikirim. Unit = bed yang ditempati kunjungan itu, atau
 * unit kunjungan.
 */
export const ewsChannel: SseChannel<EwsEscalationSseEvent> = {
  name: CLINICAL_NOTIFY_CHANNELS.vitals,
  async load(tx: TenantTx, id: string) {
    const o = await tx.observation.findUnique({
      where: { id },
      select: {
        id: true,
        encounterId: true,
        ewsScore: true,
        ewsMaxParam: true,
        recordedAt: true,
        category: true,
      },
    });
    if (!o || o.category !== 'vital' || o.ewsScore === null || o.ewsMaxParam === null) return null;
    const threshold = await readTenantSetting(tx, 'ews.escalation_score');
    if (!ewsNeedsEscalation(o.ewsScore, o.ewsMaxParam, threshold)) return null;
    const [loc] = await tx.$queryRaw<Array<{ unit_id: string | null }>>`
      SELECT coalesce(l.unit_id, e.unit_id)::text AS unit_id
      FROM encounters e
      LEFT JOIN bed_assignments ba ON ba.tenant_id = e.tenant_id AND ba.encounter_id = e.id AND ba.ended_at IS NULL
      LEFT JOIN locations l ON l.tenant_id = ba.tenant_id AND l.id = ba.location_id
      WHERE e.id = ${o.encounterId}::uuid`;
    return {
      id: o.id,
      event: CLINICAL_SSE_EVENTS.ewsEscalation,
      data: {
        observationId: o.id,
        encounterId: o.encounterId,
        unitId: loc?.unit_id ?? null,
        score: o.ewsScore,
        maxParam: o.ewsMaxParam,
        risk: ewsRisk(o.ewsScore, o.ewsMaxParam).level,
        at: o.recordedAt.toISOString(),
      },
    };
  },
};
