import {
  formatJam,
  type ScheduleDoctor,
  type ScheduleSlot,
  type SlotQuota,
  type WeeklySchedule,
} from '@simrs/shared';

/**
 * F01 · Logika tampilan layar Jadwal mode api (tanpa React, diuji unit): minggu tampil, ringkasan HFIS, dan cuti yang
 * pasiennya belum dialihkan. Perbedaan HFIS dihitung API dari tarikan HFIS terakhir; teks per perbedaan sudah siap.
 */

const isoOk = (v: string) => /^\d{4}-\d{2}-\d{2}$/.test(v) && !Number.isNaN(Date.parse(`${v}T00:00:00Z`));

export function addDaysIso(iso: string, days: number): string {
  return new Date(Date.parse(`${iso}T00:00:00Z`) + days * 86_400_000).toISOString().slice(0, 10);
}

/** Senin minggu yang memuat tanggal ini. */
export function mondayOf(iso: string): string {
  const day = new Date(`${iso}T00:00:00Z`).getUTCDay();
  return addDaysIso(iso, day === 0 ? -6 : 1 - day);
}

/** Minggu yang diminta (`?minggu=YYYY-MM-DD`, tanggal apa pun di minggu itu) atau minggu hari ini. */
export function requestedWeek(param: string | null | undefined, today: string): string {
  return mondayOf(param && isoOk(param) ? param : today);
}

export interface HfisSummary {
  pending: boolean;
  /** Label chip header. */
  label: string;
  /** Teks panel perbedaan. */
  text: string;
  /** Ada perbedaan yang hanya bisa diselesaikan di aplikasi HFIS. */
  needsHfisApp: boolean;
  /** Ada perbedaan yang selesai dengan kirim jadwal. */
  needsPush: boolean;
}

/** `HH.MM` WIB dari ISO, atau null. */
const jam = (iso: string | null) => (iso ? formatJam(iso) : null);

export function hfisSummary(schedule: WeeklySchedule): HfisSummary {
  const diffs = schedule.hfis.differences;
  const at = jam(schedule.hfis.lastSyncAt);
  if (!at) {
    return {
      pending: true,
      label: 'HFIS belum ditarik',
      text: 'Jadwal HFIS minggu ini belum ditarik, sehingga perbedaan belum bisa diperiksa. Tarik dari HFIS dulu.',
      needsHfisApp: false,
      needsPush: false,
    };
  }
  if (diffs.length === 0) {
    return {
      pending: false,
      label: `Tersinkron HFIS ${at}`,
      text: '',
      needsHfisApp: false,
      needsPush: false,
    };
  }
  return {
    pending: true,
    label: `Sinkron HFIS ${at} · ${diffs.length} perbedaan`,
    text: diffs.map((d) => d.text).join(' '),
    needsHfisApp: diffs.some((d) => d.resolution === 'aplikasi-hfis'),
    needsPush: diffs.some((d) => d.resolution !== 'aplikasi-hfis'),
  };
}

export interface PendingLeave {
  slot: ScheduleSlot;
  doctor: ScheduleDoctor;
  substitute: ScheduleDoctor | null;
}

/** Sesi cuti berpengganti dengan pasien booking di minggu ini (perlu dialihkan + diberi tahu). */
export function leavesWithPatients(schedule: WeeklySchedule): PendingLeave[] {
  return schedule.doctors.flatMap((doctor) =>
    doctor.slots
      .filter((s) => s.kind === 'cuti' && (s.affectedPatients ?? 0) > 0)
      .map((slot) => ({
        slot,
        doctor,
        substitute: schedule.doctors.find((d) => d.id === slot.relatedDoctorId) ?? null,
      })),
  );
}

export const quotaEquals = (a: SlotQuota | null, b: SlotQuota | null) =>
  !!a && !!b && a.jkn === b.jkn && a.nonJkn === b.nonJkn;
