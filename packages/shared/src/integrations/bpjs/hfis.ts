import { z } from 'zod';
import { type BpjsEndpoint, bpjsJamSchema } from './common';

/**
 * I03 → F01 · Jadwal dokter HFIS lewat layanan Antrean RS (path relatif terhadap `BPJS_SERVICE_PREFIX.antrean`).
 *
 * Batas web service (rangkuman, cocokkan dengan katalog resmi): `updatejadwaldokter` hanya mengganti templat
 * mingguan jam buka–tutup per hari. Libur/cuti per tanggal dan kapasitas pasien dicatat petugas RS langsung di
 * aplikasi HFIS; mock menirunya lewat panel (`POST /_panel/api/bpjs/hfis`).
 */
export const HFIS_ENDPOINTS = {
  /** Jadwal dokter satu poli pada satu tanggal → `hfisJadwalDokterResponseSchema` (terenkripsi). */
  jadwalDokter: { method: 'GET', path: '/jadwaldokter/kodepoli/:kodepoli/tanggal/:tanggal' },
  /** Ganti templat mingguan satu dokter di satu poli → `metadata` saja. */
  updateJadwalDokter: { method: 'POST', path: '/jadwaldokter/updatejadwaldokter' },
} as const satisfies Record<string, BpjsEndpoint>;

/** Hari HFIS: 1 = Senin … 7 = Minggu, 8 = hari libur nasional. */
export const HFIS_HARI = {
  1: 'SENIN',
  2: 'SELASA',
  3: 'RABU',
  4: 'KAMIS',
  5: 'JUMAT',
  6: 'SABTU',
  7: 'MINGGU',
  8: 'HARI LIBUR NASIONAL',
} as const;
export type HfisHari = keyof typeof HFIS_HARI;

/** Hari HFIS (1–7) untuk tanggal kalender `YYYY-MM-DD`. */
export function hfisHariOf(isoDate: string): Exclude<HfisHari, 8> {
  const [y, m, d] = isoDate.split('-').map(Number) as [number, number, number];
  const weekday = new Date(Date.UTC(y, m - 1, d)).getUTCDay(); // 0 = Minggu
  return (weekday === 0 ? 7 : weekday) as Exclude<HfisHari, 8>;
}

/** `jadwal` HFIS memakai `HH:mm - HH:mm` (dengan spasi). */
export const HFIS_JADWAL_PATTERN = /^([01]\d|2[0-3]):[0-5]\d - ([01]\d|2[0-3]):[0-5]\d$/;

export function formatHfisJadwal(buka: string, tutup: string): string {
  return `${buka} - ${tutup}`;
}

/** `08:00 - 12:00` (HFIS) atau `08:00-12:00` (Antrean) → jam buka/tutup; null bila tidak sah. */
export function parseHfisJadwal(jadwal: string): { buka: string; tutup: string } | null {
  const m = /^(\d{2}:\d{2}) ?- ?(\d{2}:\d{2})$/.exec(jadwal.trim());
  if (!m || !bpjsJamSchema.safeParse(m[1]).success || !bpjsJamSchema.safeParse(m[2]).success) return null;
  return { buka: m[1] as string, tutup: m[2] as string };
}

/** Jadwal HFIS → `jampraktek` tambah antrean (`HH:mm-HH:mm`). */
export function hfisJamPraktek(jadwal: string): string | null {
  const j = parseHfisJadwal(jadwal);
  return j ? `${j.buka}-${j.tutup}` : null;
}

export const hfisJadwalDokterSchema = z.object({
  kodedokter: z.number().int(),
  namadokter: z.string(),
  kodepoli: z.string(),
  namapoli: z.string(),
  kodesubspesialis: z.string(),
  namasubspesialis: z.string(),
  hari: z.number().int().min(1).max(8),
  namahari: z.string(),
  jadwal: z.string().regex(HFIS_JADWAL_PATTERN),
  kapasitaspasien: z.number().int().min(0),
  /** 1 = dokter libur/cuti pada tanggal yang diminta. */
  libur: z.literal([0, 1]),
});
export type HfisJadwalDokter = z.infer<typeof hfisJadwalDokterSchema>;
export const hfisJadwalDokterResponseSchema = z.array(hfisJadwalDokterSchema);

export const hfisJadwalHariSchema = z
  .object({
    hari: z.enum(['1', '2', '3', '4', '5', '6', '7', '8']),
    buka: bpjsJamSchema,
    tutup: bpjsJamSchema,
  })
  .refine((j) => j.buka < j.tutup, { message: 'Jam buka harus sebelum jam tutup', path: ['tutup'] });

export const hfisUpdateJadwalRequestSchema = z.object({
  kodepoli: z.string().min(1).max(10),
  kodesubspesialis: z.string().min(1).max(10),
  kodedokter: z.number().int().positive(),
  /** Templat pengganti untuk dokter di poli ini: hari yang tidak dikirim berarti tidak praktik. */
  jadwal: z.array(hfisJadwalHariSchema).min(1).max(16),
});
export type HfisUpdateJadwalRequest = z.infer<typeof hfisUpdateJadwalRequestSchema>;
