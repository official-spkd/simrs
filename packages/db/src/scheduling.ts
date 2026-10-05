import { BPJS_HFIS_PULL_OPERATION, newId, outboxKey } from '@simrs/shared';
import type { TenantTx } from './client';
import { enqueueOutbox } from './outbox';

/**
 * F01 · Pembangkit sesi praktik bertanggal dari templat mingguan (`practitioner_schedules` → `schedule_sessions`).
 * Dipakai job harian worker `scheduling.generate-sessions` dan API (`POST /scheduling/sessions/generate`, setelah
 * templat dibuat). Idempoten: sesi yang sudah ada (kunci praktisi × tanggal × jam mulai) tidak disentuh, sehingga
 * kuota yang sudah diubah petugas, cuti, dan booking tetap utuh. Templat yang berubah tidak mengubah sesi lama.
 */

/** `YYYY-MM-DD` → nilai kolom `date` (tengah malam UTC; sesi DB UTC, ADR-0014). */
export const dbDateFromIso = (iso: string) => new Date(`${iso}T00:00:00.000Z`);
/** Nilai kolom `date` → `YYYY-MM-DD`. */
export const isoFromDbDate = (d: Date) => d.toISOString().slice(0, 10);
/** `HH:MM` → nilai kolom `time`. */
export const dbTimeFromHhmm = (hhmm: string) => new Date(`1970-01-01T${hhmm}:00.000Z`);
/** Nilai kolom `time` → `HH:MM`. */
export const hhmmFromDbTime = (d: Date) => d.toISOString().slice(11, 16);

/** Hari ISO (1 = Senin … 7 = Minggu) untuk `YYYY-MM-DD`. */
export function isoWeekday(iso: string): number {
  const day = dbDateFromIso(iso).getUTCDay();
  return day === 0 ? 7 : day;
}

export function addIsoDays(iso: string, days: number): string {
  return isoFromDbDate(new Date(dbDateFromIso(iso).getTime() + days * 86_400_000));
}

export interface GenerateSessionsResult {
  from: string;
  to: string;
  created: number;
}

export async function generateScheduleSessions(
  tx: TenantTx,
  tenantId: string,
  opts: { from: string; days: number; actorUserId?: string | null },
): Promise<GenerateSessionsResult> {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(opts.from)) throw new Error(`Tanggal awal tidak valid: ${opts.from}`);
  if (!Number.isInteger(opts.days) || opts.days < 1 || opts.days > 366) throw new Error('Rentang hari 1–366');
  const to = addIsoDays(opts.from, opts.days - 1);
  const templates = await tx.practitionerSchedule.findMany({
    where: {
      active: true,
      validFrom: { lte: dbDateFromIso(to) },
      OR: [{ validUntil: null }, { validUntil: { gte: dbDateFromIso(opts.from) } }],
      practitioner: { active: true },
      service: { active: true },
    },
  });
  const actor = opts.actorUserId ?? null;
  const rows = [];
  for (let i = 0; i < opts.days; i++) {
    const date = addIsoDays(opts.from, i);
    const weekday = isoWeekday(date);
    for (const t of templates) {
      if (t.weekday !== weekday) continue;
      if (isoFromDbDate(t.validFrom) > date) continue;
      if (t.validUntil && isoFromDbDate(t.validUntil) < date) continue;
      rows.push({
        id: newId(),
        tenantId,
        scheduleId: t.id,
        practitionerId: t.practitionerId,
        serviceId: t.serviceId,
        sessionDate: dbDateFromIso(date),
        startTime: t.startTime,
        endTime: t.endTime,
        quotaJkn: t.quotaJkn,
        quotaNonJkn: t.quotaNonJkn,
        createdBy: actor,
        updatedBy: actor,
      });
    }
  }
  if (rows.length === 0) return { from: opts.from, to, created: 0 };
  const res = await tx.scheduleSession.createMany({ data: rows, skipDuplicates: true });
  return { from: opts.from, to, created: res.count };
}

/**
 * Antrekan tarik jadwal HFIS (`bpjs.hfis.pull`) per poli ber-kode BPJS × tanggal. Satu penanda `run` (menit epoch)
 * per tarikan: tarikan ulang di menit yang sama tidak menggandakan pesan. Dipakai API (`POST /scheduling/hfis/pull`)
 * dan job worker `scheduling.hfis-pull`.
 */
export async function enqueueHfisPull(
  tx: TenantTx,
  tenantId: string,
  opts: { from: string; days: number; serviceId?: string; now?: Date },
): Promise<number> {
  const services = await tx.queueService.findMany({
    where: { kind: 'poli', active: true, ...(opts.serviceId ? { id: opts.serviceId } : {}) },
    select: { id: true },
  });
  const mapped = new Set(
    (
      await tx.externalId.findMany({
        where: { entity: 'queue_service', system: 'bpjs:poli', active: true },
        select: { entityId: true },
      })
    ).map((r) => r.entityId),
  );
  const run = Math.floor((opts.now ?? new Date()).getTime() / 60_000);
  let queued = 0;
  for (const s of services.filter((x) => mapped.has(x.id))) {
    for (let i = 0; i < opts.days; i++) {
      const date = addIsoDays(opts.from, i);
      await enqueueOutbox(tx, tenantId, {
        target: 'bpjs',
        operation: BPJS_HFIS_PULL_OPERATION,
        idempotencyKey: outboxKey(BPJS_HFIS_PULL_OPERATION, `${s.id}:${date}`, run),
        payload: { serviceId: s.id, date, run },
      });
      queued++;
    }
  }
  return queued;
}
