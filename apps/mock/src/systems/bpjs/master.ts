import type { HfisHari } from '@simrs/shared';

/**
 * Data induk fiktif mock BPJS: poli, dokter HFIS, templat jadwal, FKTP, nama diagnosa.
 *
 * - Kode poli BPJS mengikuti mockup Registrasi (INT/JAN/SAR/PAR) dan dipetakan ke poli RS PD/JT/SR/PR.
 * - Dokter dan jam praktik mengikuti jadwal minggu demo (`apps/web/src/lib/demo/fixtures/front-office.ts`);
 *   kode dokter HFIS 99001–99006 FIKTIF (seed `external_ids` fase 2 harus memakai kode yang sama).
 * - Kapasitas HFIS = kuota JKN + non-JKN slot RS.
 * - Perbedaan HFIS yang disemai (seperti mockup Jadwal): templat HFIS dr. Bagus (99003) tetap praktik setiap Rabu
 *   09:00–12:00 tanpa catatan cuti, sedangkan jadwal RS mencatat cuti Rabu 7 Okt 2026.
 */

export interface MockPoli {
  kode: string;
  nama: string;
  /** Kode poli RS (awalan nomor antrean). */
  rsPoli: string;
}

export const MOCK_POLI: readonly MockPoli[] = [
  { kode: 'INT', nama: 'PENYAKIT DALAM', rsPoli: 'PD' },
  { kode: 'JAN', nama: 'JANTUNG', rsPoli: 'JT' },
  { kode: 'SAR', nama: 'SARAF', rsPoli: 'SR' },
  { kode: 'PAR', nama: 'PARU', rsPoli: 'PR' },
];

export interface MockDokter {
  kode: number;
  nama: string;
  kodepoli: string;
}

export const MOCK_DOKTER: readonly MockDokter[] = [
  { kode: 99001, nama: 'dr. Andini Prameswari, Sp.PD', kodepoli: 'INT' },
  { kode: 99002, nama: 'dr. Rahmat Hidayat, Sp.PD', kodepoli: 'INT' },
  { kode: 99003, nama: 'dr. Bagus Santoso, Sp.JP', kodepoli: 'JAN' },
  { kode: 99004, nama: 'dr. Melati Kusumawardani, Sp.JP', kodepoli: 'JAN' },
  { kode: 99005, nama: 'dr. Yudha Pratama, Sp.N', kodepoli: 'SAR' },
  { kode: 99006, nama: 'dr. Kartika Sari, Sp.P', kodepoli: 'PAR' },
];

export interface MockSesi {
  hari: HfisHari;
  buka: string;
  tutup: string;
  kapasitas: number;
}

const sesi = (hari: HfisHari[], buka: string, tutup: string, kapasitas: number): MockSesi[] =>
  hari.map((h) => ({ hari: h, buka, tutup, kapasitas }));

/** Templat mingguan awal HFIS per dokter (di poli dokter itu). */
export const MOCK_HFIS_TEMPLAT: ReadonlyMap<number, readonly MockSesi[]> = new Map([
  [99001, [...sesi([1, 2, 3, 4], '08:00', '12:00', 30), ...sesi([6], '08:00', '11:00', 20)]],
  [99002, sesi([1, 3, 4, 5], '13:00', '16:00', 25)],
  // Perbedaan yang disemai: Rabu tetap praktik di HFIS (RS: cuti Rabu 7 Okt 2026).
  [99003, sesi([1, 2, 3, 4, 5], '09:00', '12:00', 20)],
  [99004, [...sesi([2, 4], '13:00', '15:00', 15), ...sesi([6], '08:00', '10:00', 10)]],
  [99005, sesi([1, 2, 3, 5], '09:30', '12:00', 20)],
  [99006, [...sesi([1, 2, 3, 4, 5], '08:00', '11:00', 20), ...sesi([6], '08:00', '10:00', 10)]],
]);

/** FKTP fiktif (kode wilayah 9999 tidak ada). */
export const MOCK_FKTP = [
  { kode: '9999P001', nama: 'PUSKESMAS FIKTIF SATU' },
  { kode: '9999P002', nama: 'KLINIK PRATAMA FIKTIF' },
] as const;

/** RS perujuk fiktif untuk rujukan antar-RS (kode PPK RS seed kedua). */
export const MOCK_RS_PERUJUK = { kode: '0301R002', nama: 'RS FIKTIF PERUJUK' } as const;

/** Nama diagnosa untuk kode ICD-10 yang sudah ada di seed `ref` (contoh-mockup). Kode lain tampil tanpa nama. */
export const MOCK_DIAGNOSA: Readonly<Record<string, string>> = {
  I10: 'Hipertensi esensial (primer)',
  'E11.9': 'Diabetes melitus tipe 2 tanpa komplikasi',
  'I20.0': 'Angina tidak stabil',
  'I63.9': 'Infark serebral',
  'J18.9': 'Pneumonia, tidak spesifik',
  K30: 'Dispepsia',
};

export function poliByKode(kode: string): MockPoli | undefined {
  return MOCK_POLI.find((p) => p.kode === kode);
}

export function dokterByKode(kode: number | string): MockDokter | undefined {
  const n = typeof kode === 'number' ? kode : /^\d+$/.test(kode) ? Number(kode) : NaN;
  return MOCK_DOKTER.find((d) => d.kode === n);
}

export function diagnosaNama(kode: string): string {
  return MOCK_DIAGNOSA[kode] ?? kode;
}

/** `<kode> - <nama>` seperti field `diagnosa` SEP. */
export function diagnosaLabel(kode: string): string {
  const nama = MOCK_DIAGNOSA[kode];
  return nama ? `${kode} - ${nama}` : kode;
}
