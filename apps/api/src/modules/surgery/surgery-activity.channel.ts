import {
  isoDateJakarta,
  SURGERY_ACTIVITY_NOTIFY_CHANNEL,
  SURGERY_ACTIVITY_SSE_EVENT,
  type SurgeryActivitySource,
  type SurgeryActivitySseEvent,
} from '@simrs/shared';
import type { TenantTx } from '@simrs/db';
import type { SseChannel, SseEvent } from '../../infra/realtime/sse.service';

/**
 * S06 · Kanal SSE aktivitas papan OK (4.7b, ADR-0106). Trigger `app_notify_row('support_surgery_activity')` di tabel
 * append-only kasus operasi + isian formulir anestesi mengirim `{ tenant_id, id }`; kanal ini mencari baris itu (RLS
 * tenant pelanggan) untuk mendapatkan kasus, kunjungan, unit kamar, dan tanggal. Tanpa `replay`: sambung ulang dengan
 * `Last-Event-ID` menerima `reset` dan layar memuat ulang papan (riwayat tersebar di 10 tabel).
 */
interface SourceRow {
  source: SurgeryActivitySource;
  surgery_case_id: string | null;
  encounter_id: string | null;
}

async function findSource(tx: TenantTx, id: string): Promise<SourceRow | null> {
  const rows = await tx.$queryRaw<SourceRow[]>`
    SELECT 'status' AS source, surgery_case_id, NULL::uuid AS encounter_id
      FROM surgery_case_status_history WHERE id = ${id}::uuid
    UNION ALL SELECT 'check', surgery_case_id, NULL FROM surgical_safety_checks WHERE id = ${id}::uuid
    UNION ALL SELECT 'confirmation', surgery_case_id, NULL FROM surgical_safety_confirmations WHERE id = ${id}::uuid
    UNION ALL SELECT 'event', surgery_case_id, NULL FROM surgery_events WHERE id = ${id}::uuid
    UNION ALL SELECT 'count', surgery_case_id, NULL FROM surgical_counts WHERE id = ${id}::uuid
    UNION ALL SELECT 'discrepancy', surgery_case_id, NULL FROM surgery_count_discrepancies WHERE id = ${id}::uuid
    UNION ALL SELECT 'supply', surgery_case_id, NULL FROM surgery_supply_usages WHERE id = ${id}::uuid
    UNION ALL SELECT 'report', surgery_case_id, NULL FROM operative_reports WHERE id = ${id}::uuid
    UNION ALL SELECT 'specimen', surgery_case_id, NULL FROM surgery_specimens WHERE id = ${id}::uuid
    UNION ALL SELECT 'anesthesia_form', NULL, encounter_id FROM form_responses WHERE id = ${id}::uuid
    LIMIT 1`;
  return rows[0] ?? null;
}

export const surgeryActivityChannel: SseChannel<SurgeryActivitySseEvent> = {
  name: SURGERY_ACTIVITY_NOTIFY_CHANNEL,
  async load(tx: TenantTx, id: string): Promise<SseEvent<SurgeryActivitySseEvent> | null> {
    const src = await findSource(tx, id);
    if (!src) return null;
    const select = {
      id: true,
      encounterId: true,
      startsAt: true,
      room: { select: { unitId: true } },
    } as const;
    // Formulir anestesi menunjuk kunjungan: kasus terdekat yang belum batal di kunjungan itu.
    const c = src.surgery_case_id
      ? await tx.surgeryCase.findUnique({ where: { id: src.surgery_case_id }, select })
      : src.encounter_id
        ? await tx.surgeryCase.findFirst({
            where: { encounterId: src.encounter_id, status: { not: 'batal' } },
            orderBy: { startsAt: 'desc' },
            select,
          })
        : null;
    if (!c) return null;
    return {
      id,
      event: SURGERY_ACTIVITY_SSE_EVENT,
      data: {
        eventId: id,
        source: src.source,
        surgeryCaseId: c.id,
        encounterId: c.encounterId,
        unitId: c.room.unitId,
        date: isoDateJakarta(c.startsAt),
      },
    };
  },
};
