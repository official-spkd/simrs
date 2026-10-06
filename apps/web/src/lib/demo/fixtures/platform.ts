import type { CareClass, ComponentCode, UnitKind } from '@simrs/shared';
import type { PrintTemplate, SettingDraft } from '../../platform-pengaturan';
import type { StructNode } from '../../platform-struktur';

/**
 * FE1 · Fixture fiktif layar platform fase 1 (ADR-0023): struktur RS (P01). Kode unit mengikuti `SEED_UNITS`
 * (`@simrs/db`, dijaga tes) dan nama ruang mengikuti `rs.ts`; bed hanya contoh sebagian bangsal (bukan seluruh
 * kapasitas Dasbor). Id = jalur kode (tanpa nama orang).
 */

const F_UTAMA = 'f-utama';
const F_SATELIT = 'f-satelit';

function unit(code: string, name: string, unitKind: UnitKind, parent = F_UTAMA, active = true): StructNode {
  return { id: `u-${code.toLowerCase()}`, kind: 'unit', parentId: parent, code, name, unitKind, active };
}

function ruang(unitCode: string, code: string, name: string): StructNode {
  return {
    id: `u-${unitCode.toLowerCase()}/${code.toLowerCase()}`,
    kind: 'ruang',
    parentId: `u-${unitCode.toLowerCase()}`,
    code,
    name,
    active: true,
  };
}

/** Kamar + bed-nya. `occupied` = jumlah bed terisi (dari bed pertama). */
function kamar(
  ruangId: string,
  code: string,
  careClass: CareClass,
  beds: number,
  occupied: number,
  active = true,
): StructNode[] {
  const id = `${ruangId}/${code.toLowerCase()}`;
  const room: StructNode = {
    id,
    kind: 'kamar',
    parentId: ruangId,
    code,
    name: `Kamar ${code}`,
    careClass,
    active,
  };
  const letters = 'ABCDEFGH';
  return [
    room,
    ...Array.from({ length: beds }, (_, i): StructNode => {
      const bed = letters[i] ?? String(i + 1);
      return {
        id: `${id}/${bed.toLowerCase()}`,
        kind: 'bed',
        parentId: id,
        code: bed,
        name: `Bed ${code}-${bed}`,
        careClass,
        active,
        occupied: active && i < occupied,
      };
    }),
  ];
}

const MELATI = ruang('MELATI', 'MLT-LT3', 'Melati lantai 3');
const ANGGREK = ruang('ANGGREK', 'AGR-LT4', 'Anggrek lantai 4');
const ICU = ruang('ICU', 'ICU-LT2', 'ICU/ICCU lantai 2');
const ISOLASI = ruang('ISOLASI', 'ISO-LT2', 'Isolasi tekanan negatif');
const IGD_OBS = ruang('IGD', 'IGD-OBS', 'Observasi IGD');

export const DEMO_STRUCTURE: readonly StructNode[] = [
  {
    id: F_UTAMA,
    kind: 'faskes',
    parentId: null,
    code: 'RS-UTAMA',
    name: 'Gedung utama',
    active: true,
  },
  {
    id: F_SATELIT,
    kind: 'faskes',
    parentId: null,
    code: 'KLINIK-CEMPAKA',
    name: 'Klinik satelit Cempaka',
    active: true,
  },
  unit('IGD', 'Instalasi Gawat Darurat', 'igd'),
  unit('POLI-DALAM', 'Poli Penyakit Dalam', 'poli'),
  unit('POLI-ANAK', 'Poli Anak', 'poli'),
  unit('POLI-BEDAH', 'Poli Bedah', 'poli'),
  unit('POLI-JANTUNG', 'Poli Jantung', 'poli'),
  unit('POLI-SARAF', 'Poli Saraf', 'poli'),
  unit('POLI-PARU', 'Poli Paru', 'poli'),
  unit('MELATI', 'Bangsal Melati', 'rawat_inap'),
  unit('MAWAR', 'Bangsal Mawar', 'rawat_inap'),
  unit('ANGGREK', 'Bangsal Anggrek', 'rawat_inap'),
  unit('ISOLASI', 'Ruang Isolasi', 'rawat_inap'),
  unit('ICU', 'ICU/ICCU', 'rawat_inap'),
  unit('LAB', 'Laboratorium Patologi Klinik', 'penunjang'),
  unit('RAD', 'Radiologi', 'penunjang'),
  unit('FARMASI', 'Instalasi Farmasi', 'farmasi'),
  unit('OK', 'Kamar Operasi', 'kamar_operasi'),
  unit('REKAM-MEDIS', 'Unit Rekam Medis', 'administrasi'),
  unit('KASIR', 'Kasir', 'administrasi'),
  unit('POLI-UMUM-CPK', 'Poli Umum Cempaka', 'poli', F_SATELIT),
  unit('POLI-GIGI-CPK', 'Poli Gigi Cempaka', 'poli', F_SATELIT, false),
  IGD_OBS,
  ...kamar(IGD_OBS.id, 'OBS', 'tanpa_kelas', 6, 4),
  MELATI,
  ...kamar(MELATI.id, 'M-201', 'kelas_2', 4, 3),
  ...kamar(MELATI.id, 'M-202', 'kelas_2', 4, 4),
  ...kamar(MELATI.id, 'M-203', 'kelas_2', 4, 2),
  ...kamar(MELATI.id, 'M-210', 'kelas_2', 2, 1),
  ...kamar(MELATI.id, 'M-212', 'kelas_2', 4, 0),
  ANGGREK,
  ...kamar(ANGGREK.id, 'A-07', 'kelas_1', 2, 1),
  ...kamar(ANGGREK.id, 'A-09', 'kelas_1', 2, 2),
  ...kamar(ANGGREK.id, 'A-12', 'kelas_1', 2, 1),
  ...kamar(ANGGREK.id, 'A-14', 'kelas_1', 2, 0, false),
  ICU,
  ...kamar(ICU.id, 'ICU-A', 'icu', 6, 5),
  ISOLASI,
  ...kamar(ISOLASI.id, 'ISO-1', 'isolasi', 1, 1),
  ...kamar(ISOLASI.id, 'ISO-2', 'isolasi', 1, 0),
];

/** Riwayat perubahan struktur sebelum hari demo (terbaru di atas). */
export const DEMO_STRUCTURE_LOG: ReadonlyArray<{ t: string; text: string }> = [
  { t: '08.12', text: 'Kamar A-14 dinonaktifkan · renovasi kamar mandi (Admin SIM RS)' },
  { t: '07.40', text: 'Kelas rawat Kamar M-210 dikonfirmasi Kelas 2 · sinkron Aplicare' },
];

// ---------------------------------------------------------------------------------------------------------
// P10/P12 · Modul aktif, pengaturan umum, template cetak
// ---------------------------------------------------------------------------------------------------------

/** Pilihan RS di atas bawaan (MVP aktif, Lanjut mati): layar Lanjut yang sudah dipakai RS + modul yang belum perlu. */
export const DEMO_MODULE_OVERRIDES: Partial<Record<ComponentCode, boolean>> = {
  B06: true,
  I07: true,
  I08: true,
  I09: true,
  I11: true,
  S08: false,
  K15: false,
};

/** Nilai pengaturan tersimpan (selain itu bawaan registri). */
export const DEMO_SETTINGS: SettingDraft = {
  'session.idle_minutes': 15,
  'login.max_failed_attempts': 5,
  'break_glass.duration_minutes': 60,
  'service.hours': { open: '07:00', close: '21:00' },
  'queue.avg_service_minutes': 8,
  'booking.max_days_ahead': 30,
  'resume.deadline_hours': 24,
  'emar.late_minutes': 60,
  'bed.boarding_alert_hours': 4,
};

const KOP = 'RS Fiktif Andalas';
const ALAMAT = 'Jl. Contoh Raya No. 1, Jakarta · Telp. (021) 0000-0000';

export const DEMO_TEMPLATES: readonly PrintTemplate[] = [
  {
    id: 'kop',
    name: 'Kop surat dan resume',
    size: 'A4 tegak',
    version: 3,
    publishedAt: '2026-09-14T09:20:00+07:00',
    publishedBy: 'Admin SIM RS (presentasi)',
    header: KOP,
    subheader: ALAMAT,
    showQr: true,
    showBarcode: false,
    showAllergy: false,
    footer: 'Dokumen ini ditandatangani secara elektronik; pindai QR untuk verifikasi.',
  },
  {
    id: 'label',
    name: 'Label pasien',
    size: '50 × 25 mm',
    version: 2,
    publishedAt: '2026-08-02T13:05:00+07:00',
    publishedBy: 'Admin SIM RS (presentasi)',
    header: KOP,
    subheader: '',
    showQr: false,
    showBarcode: true,
    showAllergy: true,
    footer: '',
  },
  {
    id: 'gelang',
    name: 'Gelang pasien dewasa',
    size: '25 × 250 mm',
    version: 4,
    publishedAt: '2026-09-28T08:00:00+07:00',
    publishedBy: 'Admin SIM RS (presentasi)',
    header: KOP,
    subheader: '',
    showQr: false,
    showBarcode: true,
    showAllergy: true,
    footer: '',
  },
  {
    id: 'etiket',
    name: 'Etiket obat',
    size: '60 × 40 mm',
    version: 1,
    publishedAt: '2026-07-20T10:10:00+07:00',
    publishedBy: 'Admin SIM RS (presentasi)',
    header: `Instalasi Farmasi · ${KOP}`,
    subheader: 'Apoteker penanggung jawab tercetak otomatis',
    showQr: false,
    showBarcode: true,
    showAllergy: true,
    footer: 'Simpan di tempat sejuk, jauh dari jangkauan anak.',
  },
  {
    id: 'kuitansi',
    name: 'Kuitansi pembayaran',
    size: 'A5 mendatar',
    version: 2,
    publishedAt: '2026-09-01T07:30:00+07:00',
    publishedBy: 'Admin SIM RS (presentasi)',
    header: KOP,
    subheader: ALAMAT,
    showQr: true,
    showBarcode: false,
    showAllergy: false,
    footer: 'Pembayaran diterima di rekening RS. Simpan kuitansi ini sebagai bukti.',
  },
];
