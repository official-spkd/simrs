import {
  type PractitionerQuota,
  type PublicBookingStatus,
  type PublicQueue,
  publicQueueSchema,
  type PublicSchedule,
  publicScheduleSchema,
  type QueueBoard,
} from '@simrs/shared';

/**
 * F08 · Portal informasi publik (mode presentasi, ADR-0023): jadwal + sisa kuota, antrean berjalan, cek status
 * booking dengan kode + tanggal lahir. Bentuk data = kontrak gateway publik (`schemas/public-info.ts`): TANPA PHI
 * (tidak ada nama pasien), kode tidak cocok dan tanggal lahir salah dijawab sama, dan percobaan dibatasi.
 */

const hhmm = (wall: string) => wall.replace('.', ':');

/** Jadwal publik dari kuota dokter hari ini (sumber yang sama dengan meja pendaftaran). */
export function publicScheduleFrom(
  quotas: readonly PractitionerQuota[],
  date: string,
  asOf: string,
): PublicSchedule {
  return publicScheduleSchema.parse({
    date,
    asOf,
    sessions: quotas.map((q) => ({
      poliName: q.poliName,
      practitionerName: q.doctorName,
      start: hhmm(q.start),
      end: hhmm(q.end),
      status: 'praktik',
      substituteName: null,
      remaining: {
        jkn: Math.max(0, q.jkn.total - q.jkn.booked),
        nonJkn: Math.max(0, q.nonJkn.total - q.nonJkn.booked),
      },
    })),
  });
}

/** Antrean publik: loket + poli dari papan antrean (nomor saja) dan perkiraan tunggu. */
export function publicQueueFrom(
  board: QueueBoard,
  extra: PublicQueue['services'],
  avgServiceMinutes: number,
): PublicQueue {
  return publicQueueSchema.parse({
    asOf: board.asOf,
    services: [
      ...extra,
      ...board.clinics.map((c) => ({
        code: c.poliCode,
        name: `Poli ${c.poliName}`,
        current: c.current,
        waiting: c.waiting.length,
        estimatedWaitMinutes: c.waiting.length * avgServiceMinutes,
      })),
    ],
  });
}

/** Booking yang bisa dicek (data uji gateway): tanggal lahir hanya dipakai untuk mencocokkan, tidak ditampilkan. */
export interface PublicBookingRecord {
  birthDate: string;
  status: PublicBookingStatus;
}

export const MAX_ATTEMPTS = 5;

export type LookupResult =
  | { kind: 'found'; booking: PublicBookingStatus }
  | { kind: 'not-found'; attemptsLeft: number }
  | { kind: 'blocked' }
  | { kind: 'invalid'; message: string };

/**
 * Cek status booking. Format salah ditolak tanpa menghitung percobaan; tidak cocok (kode tidak ada ATAU tanggal
 * lahir salah) dijawab sama dan menambah hitungan; 5 kali gagal dalam semenit → diblok.
 */
export function lookupBooking(
  records: readonly PublicBookingRecord[],
  code: string,
  birthDate: string,
  failures: number,
): LookupResult {
  if (failures >= MAX_ATTEMPTS) return { kind: 'blocked' };
  const c = code.replace(/\s/g, '');
  if (!/^\d{10}$/.test(c)) return { kind: 'invalid', message: 'Kode booking 10 digit angka.' };
  if (!/^\d{4}-\d{2}-\d{2}$/.test(birthDate)) return { kind: 'invalid', message: 'Isi tanggal lahir.' };
  const hit = records.find((r) => r.status.bookingCode === c && r.birthDate === birthDate);
  if (hit) return { kind: 'found', booking: hit.status };
  return { kind: 'not-found', attemptsLeft: Math.max(0, MAX_ATTEMPTS - failures - 1) };
}

export function quotaTone(remaining: number): 'success' | 'warning' | 'danger' {
  return remaining === 0 ? 'danger' : remaining <= 5 ? 'warning' : 'success';
}
