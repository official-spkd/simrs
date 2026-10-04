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

/** RS sesuai tenant seed (`SEED_TENANTS` + `SEED_LOCAL_TENANTS`, kode PPK fiktif). */
export const MOCK_RS = [
  { kode: '0301R001', nama: 'RS FIKTIF ANDALAS' },
  { kode: '0301R002', nama: 'RS FIKTIF BAHARI' },
  { kode: '0301R003', nama: 'RSUPN DR. CIPTO MANGUNKUSUMO' },
] as const;

/** RS perujuk untuk rujukan antar-RS (RS seed kedua). */
export const MOCK_RS_PERUJUK = MOCK_RS[1];

/** Referensi faskes: FKTP (jenis 1) dan RS (jenis 2), hanya kode yang ada di seed/fixture. */
export const MOCK_FASKES = { fktp: MOCK_FKTP, rs: MOCK_RS } as const;

export function faskesByKode(kode: string): { kode: string; nama: string; jenis: 'fktp' | 'rs' } | undefined {
  const fktp = MOCK_FKTP.find((f) => f.kode === kode);
  if (fktp) return { ...fktp, jenis: 'fktp' };
  const rs = MOCK_RS.find((f) => f.kode === kode);
  return rs ? { ...rs, jenis: 'rs' } : undefined;
}

/**
 * Referensi diagnosa = salinan persis contoh ICD-10 seed `ref` (`SEED_REF_SAMPLES.icd10` di
 * `packages/db/src/seed-ref.ts`, dijaga tes). Tidak ada kode lain: mock tidak mengarang kode ICD.
 */
export const MOCK_DIAGNOSA: Readonly<Record<string, string>> = {
  'A41.9': 'Sepsis, tidak spesifik',
  A91: 'Demam berdarah dengue',
  'C18.9': 'Neoplasma ganas kolon',
  'E11.9': 'Diabetes melitus tipe 2 tanpa komplikasi',
  'E78.5': 'Hiperlipidemia, tidak spesifik',
  'E87.2': 'Asidosis',
  'E87.5': 'Hiperkalemia',
  I10: 'Hipertensi esensial (primer)',
  'I20.0': 'Angina tidak stabil',
  'I21.4': 'Infark miokard akut non-ST elevasi',
  'I63.9': 'Infark serebral',
  'J06.9': 'Infeksi saluran napas atas akut',
  J13: 'Pneumonia akibat S. pneumoniae',
  'J18.9': 'Pneumonia, tidak spesifik',
  'J96.0': 'Gagal napas akut',
  K30: 'Dispepsia',
  'K80.2': 'Batu kandung empedu tanpa kolesistitis',
  'M10.9': 'Gout, tidak spesifik',
  'N17.9': 'Gagal ginjal akut',
  'N18.3': 'Penyakit ginjal kronik stadium 3',
  'N18.5': 'Penyakit ginjal kronik stadium 5',
  'O82.0': 'Persalinan dengan seksio sesarea elektif',
  'R50.9': 'Demam, tidak spesifik',
  'R57.2': 'Syok septik',
  'R57.9': 'Syok, tidak spesifik',
  'S72.3': 'Fraktur batang femur',
  'Z37.0': 'Lahir hidup tunggal',
  'Z51.1': 'Sesi kemoterapi',
  'Z99.2': 'Ketergantungan dialisis',
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
