/**
 * Struktur RS fiktif bersama untuk semua layar mode presentasi (ADR-0023). Kode unit mengikuti `SEED_UNITS`
 * (`@simrs/db`, dijaga tes); poli, bangsal, dan loket di sini adalah satu-satunya sumber nama ruang di layar dummy.
 */

export interface DemoPoli {
  /** Kode poli; juga awalan nomor antrean poli (`PD-027`, format docs/04 §5). */
  code: string;
  name: string;
  room: string;
  lantai: number;
  /** Unit seed bila ada (`SEED_UNITS`). */
  unitCode: string | null;
}

export const POLI: readonly DemoPoli[] = [
  { code: 'PD', name: 'Penyakit Dalam', room: 'Ruang 2', lantai: 2, unitCode: 'POLI-DALAM' },
  { code: 'JT', name: 'Jantung', room: 'Ruang 4', lantai: 2, unitCode: null },
  { code: 'SR', name: 'Saraf', room: 'Ruang 5', lantai: 2, unitCode: null },
  { code: 'PR', name: 'Paru', room: 'Ruang 6', lantai: 2, unitCode: null },
  { code: 'AN', name: 'Anak', room: 'Ruang 1', lantai: 1, unitCode: 'POLI-ANAK' },
  { code: 'BD', name: 'Bedah', room: 'Ruang 3', lantai: 1, unitCode: 'POLI-BEDAH' },
  { code: 'OG', name: 'Kebidanan', room: 'Ruang 7', lantai: 1, unitCode: null },
];

export function poliByCode(code: string): DemoPoli | undefined {
  return POLI.find((p) => p.code === code);
}

/** Nomor antrean: `<kode>-<3 digit>` (docs/04 §5). Loket admisi memakai kode `A`, farmasi `F`, kasir `K`. */
export function queueNo(code: string, n: number): string {
  return `${code}-${String(n).padStart(3, '0')}`;
}

/** Unit seed (sama dengan `SEED_UNITS`). */
export const UNIT = {
  IGD: 'Instalasi Gawat Darurat',
  'POLI-DALAM': 'Poli Penyakit Dalam',
  'POLI-ANAK': 'Poli Anak',
  'POLI-BEDAH': 'Poli Bedah',
  MELATI: 'Bangsal Melati',
  MAWAR: 'Bangsal Mawar',
  LAB: 'Laboratorium Patologi Klinik',
  RAD: 'Radiologi',
  FARMASI: 'Instalasi Farmasi',
  OK: 'Kamar Operasi',
  'REKAM-MEDIS': 'Unit Rekam Medis',
  KASIR: 'Kasir',
} as const;

/**
 * Ruang rawat untuk papan tempat tidur dan rawat inap. Total kelas (tanpa ICU/HCU/isolasi) = 260 bed, selaras
 * kapasitas Dasbor direksi (214/260 terisi; ICU 11/12; isolasi 3/6). Bed skenario: ICU 3/5, HCU 2/4,
 * Anggrek A-07/A-09/A-12, Paviliun VIP 3, Melati M-210 (naskah Simulasi).
 */
export interface DemoWard {
  code: string;
  name: string;
  kelas: 'VIP' | 'Kelas 1' | 'Kelas 2' | 'Kelas 3' | 'ICU' | 'HCU' | 'Isolasi';
  beds: number;
  /** Bed terisi saat ini (hari demo). */
  occupied: number;
}

export const BANGSAL: readonly DemoWard[] = [
  { code: 'VIP', name: 'Paviliun VIP', kelas: 'VIP', beds: 20, occupied: 15 },
  { code: 'ANGGREK', name: 'Bangsal Anggrek', kelas: 'Kelas 1', beds: 40, occupied: 33 },
  { code: 'MELATI', name: 'Bangsal Melati', kelas: 'Kelas 2', beds: 60, occupied: 50 },
  { code: 'MAWAR', name: 'Bangsal Mawar', kelas: 'Kelas 2', beds: 50, occupied: 41 },
  { code: 'KENANGA', name: 'Bangsal Kenanga', kelas: 'Kelas 3', beds: 90, occupied: 75 },
  { code: 'ICU', name: 'ICU/ICCU', kelas: 'ICU', beds: 12, occupied: 11 },
  { code: 'HCU', name: 'HCU', kelas: 'HCU', beds: 8, occupied: 6 },
  { code: 'ISOLASI', name: 'Ruang Isolasi', kelas: 'Isolasi', beds: 6, occupied: 3 },
];

/** Rekening RS fiktif (skenario TPDI × BTN): operasional dan penampungan klaim. */
export const REKENING = { operasional: '••••4417', penampungan: '••••9021' } as const;
