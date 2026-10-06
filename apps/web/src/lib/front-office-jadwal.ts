import { type ScheduleSlot, type SlotQuota, wallClockSchema, type WeeklySchedule } from '@simrs/shared';
import { z } from 'zod';
import { defineDomain } from './demo/store/define';

/**
 * F01 · Domain toko demo `jadwal` (ADR-0085): perubahan kuota, cuti/pengganti, pengalihan pasien cuti, dan kiriman
 * ke HFIS dari layar Jadwal dokter (mode presentasi). Jadwal yang sudah diterapkan (`applyScheduleStore`) dipakai
 * semua layar yang membaca kuota: meja pendaftaran, anjungan, info publik. Cuti hari ini = dokter hilang dari kuota
 * hari ini (tidak bisa didaftarkan/dibooking).
 */

export const SCHEDULE_DOMAIN = 'jadwal';

const slotId = z.string().min(1).max(80);
const quota = z.number().int().min(0).max(500);

export const scheduleEventSchema = z.discriminatedUnion('type', [
  z.strictObject({
    /** Kuota slot praktik diubah (tidak di bawah booking: diperiksa Server Action dengan data server). */
    type: z.literal('kuota.diubah'),
    slotId,
    jkn: quota,
    nonJkn: quota,
    jam: wallClockSchema,
  }),
  z.strictObject({
    /** Cuti pada slot praktik, opsional dengan dokter pengganti dari poli yang sama; alasan wajib. */
    type: z.literal('cuti.dicatat'),
    slotId,
    substituteId: z.string().min(1).max(60).nullable(),
    reason: z.string().trim().min(5).max(300),
    jam: wallClockSchema,
  }),
  z.strictObject({
    /** Pasien booking slot cuti dialihkan ke dokter pengganti + notifikasi WhatsApp. */
    type: z.literal('cuti.dialihkan'),
    slotId,
    patients: z.number().int().min(0).max(500),
    substituteName: z.string().min(1).max(120),
    jam: wallClockSchema,
  }),
  z.strictObject({
    /** Jadwal RS (cuti + kuota) dikirim ke HFIS. */
    type: z.literal('hfis.dikirim'),
    quotaChanges: z.number().int().min(0).max(200),
    jam: wallClockSchema,
  }),
]);
export type ScheduleEvent = z.infer<typeof scheduleEventSchema>;

export type QuotaTotals = Pick<SlotQuota, 'jkn' | 'nonJkn'>;

export interface StoredLeave {
  substituteId: string | null;
  reason: string;
  /** Sudah dikirim ke HFIS. */
  synced: boolean;
  jam: string;
  by: string;
}

export interface ScheduleStoreState {
  /** Kuota jadwal RS yang diubah, per slot. */
  quotas: Readonly<Record<string, QuotaTotals>>;
  /** Kuota terakhir yang sudah dikirim ke HFIS, per slot. */
  sent: Readonly<Record<string, QuotaTotals>>;
  /** Cuti yang dicatat di layar Jadwal, per slot. */
  leaves: Readonly<Record<string, StoredLeave>>;
  /** Perbedaan HFIS bawaan fixture sudah diselesaikan lewat kiriman. */
  fixtureSynced: boolean;
  /** Jam kiriman HFIS terakhir (`HH.MM`), null bila belum pernah dari layar ini. */
  syncJam: string | null;
  /** Pengalihan pasien cuti yang sudah disetujui, per slot cuti. */
  transfers: Readonly<Record<string, { jam: string; by: string; patients: number; substituteName: string }>>;
}

function gate(s: ScheduleStoreState, ev: ScheduleEvent): string | null {
  switch (ev.type) {
    case 'cuti.dicatat':
      return s.leaves[ev.slotId] ? 'Cuti sudah dicatat untuk slot ini.' : null;
    case 'cuti.dialihkan':
      return s.transfers[ev.slotId] ? 'Pengalihan pasien slot ini sudah disetujui.' : null;
    case 'kuota.diubah':
      return s.leaves[ev.slotId] ? 'Slot ini sudah dicatat cuti; kuota tidak bisa diubah.' : null;
    case 'hfis.dikirim':
      return null;
  }
}

export const scheduleDomain = defineDomain<ScheduleStoreState, ScheduleEvent>(SCHEDULE_DOMAIN, {
  initial: () => ({ quotas: {}, sent: {}, leaves: {}, fixtureSynced: false, syncJam: null, transfers: {} }),
  eventSchema: scheduleEventSchema,
  screens: ['jadwal', 'daftar', 'kiosk', 'info-publik'],
  validate: (s, ev) => gate(s, ev),
  reduce: (s, ev) => {
    const d = ev.data;
    const err = gate(s, d);
    if (err) throw new Error(err);
    switch (d.type) {
      case 'kuota.diubah':
        return { ...s, quotas: { ...s.quotas, [d.slotId]: { jkn: d.jkn, nonJkn: d.nonJkn } } };
      case 'cuti.dicatat':
        return {
          ...s,
          leaves: {
            ...s.leaves,
            [d.slotId]: {
              substituteId: d.substituteId,
              reason: d.reason,
              synced: false,
              jam: d.jam,
              by: ev.actor.name,
            },
          },
        };
      case 'cuti.dialihkan':
        return {
          ...s,
          transfers: {
            ...s.transfers,
            [d.slotId]: {
              jam: d.jam,
              by: ev.actor.name,
              patients: d.patients,
              substituteName: d.substituteName,
            },
          },
        };
      case 'hfis.dikirim':
        return {
          ...s,
          sent: { ...s.sent, ...s.quotas },
          leaves: Object.fromEntries(Object.entries(s.leaves).map(([k, l]) => [k, { ...l, synced: true }])),
          fixtureSynced: true,
          syncJam: d.jam,
        };
    }
  },
});

const sameQuota = (a: QuotaTotals, b: QuotaTotals) => a.jkn === b.jkn && a.nonJkn === b.nonJkn;

/**
 * Jadwal mingguan setelah keadaan toko: (1) booking tambahan dari kunjungan terdaftar per sesi, (2) kuota jadwal RS
 * yang diubah, (3) cuti yang dicatat (slot praktik → cuti, pasien booking menjadi terdampak). Perbedaan HFIS bawaan
 * hilang setelah kiriman pertama; status `hfisSynced` per slot mengikuti kiriman terakhir.
 */
export function applyScheduleStore(
  base: WeeklySchedule,
  s: ScheduleStoreState,
  booked: ReadonlyMap<string, { jkn: number; nonJkn: number }> = new Map(),
): WeeklySchedule {
  return {
    ...base,
    hfis: { ...base.hfis, differences: s.fixtureSynced ? [] : base.hfis.differences },
    doctors: base.doctors.map((d) => ({
      ...d,
      slots: d.slots.map((slot): ScheduleSlot => {
        if (!slot.quota)
          return slot.kind === 'cuti' && s.fixtureSynced ? { ...slot, hfisSynced: true } : slot;
        const extra = slot.sessionId ? booked.get(slot.sessionId) : undefined;
        const q = s.quotas[slot.id];
        const quota: SlotQuota = {
          jkn: q?.jkn ?? slot.quota.jkn,
          nonJkn: q?.nonJkn ?? slot.quota.nonJkn,
          bookedJkn: slot.quota.bookedJkn + (extra?.jkn ?? 0),
          bookedNonJkn: slot.quota.bookedNonJkn + (extra?.nonJkn ?? 0),
        };
        const leave = s.leaves[slot.id];
        if (leave) {
          return {
            ...slot,
            kind: 'cuti',
            start: null,
            end: null,
            quota: null,
            relatedDoctorId: leave.substituteId,
            affectedPatients: quota.bookedJkn + quota.bookedNonJkn,
            hfisSynced: leave.synced,
          };
        }
        const sent = s.sent[slot.id];
        const hfisSynced = q ? !!sent && sameQuota(sent, q) : slot.hfisSynced;
        return { ...slot, quota, hfisSynced };
      }),
    })),
  };
}

/** Slot yang kuotanya berbeda dari HFIS (kuota diubah, belum dikirim). */
export function dirtyQuotaSlots(base: WeeklySchedule, s: ScheduleStoreState): string[] {
  const slots = new Map(base.doctors.flatMap((d) => d.slots.map((x) => [x.id, x] as const)));
  return Object.entries(s.quotas)
    .filter(([id, q]) => {
      if (s.leaves[id]) return false;
      const ref = s.sent[id] ?? slots.get(id)?.quota;
      return !!ref && !sameQuota(ref, q);
    })
    .map(([id]) => id);
}

/** Cuti yang belum dikirim ke HFIS. */
export function unsyncedLeaves(s: ScheduleStoreState): string[] {
  return Object.entries(s.leaves)
    .filter(([, l]) => !l.synced)
    .map(([id]) => id);
}
