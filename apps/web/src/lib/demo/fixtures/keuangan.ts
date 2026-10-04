import {
  type ChargeCategory,
  type ChargeItem,
  type Claim,
  formatDocumentNumber,
  type AccountingBoard,
  type Invoice,
  type JournalEntry,
  type JournalLine,
  type PayerSplit,
  type Payment,
} from '@simrs/shared';
import { invoiceTotal, patientDue, recomputeSplit } from '../../keuangan';
import type { ScenarioId } from '../engine/types';
import { patientById } from './pasien';
import { queueNo, REKENING } from './rs';
import { doctorById } from './staf';
import { DEMO_TODAY } from './waktu';

/**
 * Data dummy keuangan (Kasir, Klaim, Akuntansi; mockup `Kasir`, `Klaim`, `Akuntansi`; ADR-0023). Semua angka
 * fiktif dan ilustratif untuk RS rujukan di Jakarta; tarif INA-CBG berlabel simulasi. Total tagihan, pembagian
 * penjamin, dan saldo jurnal dihitung (bigint), tidak diketik. Pasien skenario diproyeksikan di
 * `lib/keuangan-skenario.ts` dari mesin skenario (baris tagihan = `R.charges`).
 */

/** Waktu WIB ISO pada tanggal tertentu: `at('2026-10-05', '09.58')`. */
export function at(date: string, hm: string): string {
  return `${date}T${hm.replace('.', ':')}:00+07:00`;
}
export const TODAY = DEMO_TODAY;

/** Baris charge capture; jumlah = kuantitas × harga satuan, atau `total` untuk rekap (harga satuan null). */
export function line(
  id: string,
  category: ChargeCategory,
  source: string,
  when: string,
  name: string,
  qty: number,
  unit: bigint | null,
  total = 0n,
): ChargeItem {
  const amount = unit === null ? total : unit * BigInt(qty);
  return {
    id,
    name,
    category,
    source,
    when,
    qty,
    unitPrice: unit === null ? null : unit.toString(),
    amount: amount.toString(),
    manual: false,
  };
}

export interface SplitInput {
  scheme: PayerSplit['scheme'];
  payerLabel: string;
  inacbg?: { code: string; name: string; classLabel: string; tariff: bigint; estimate: boolean } | null;
  upgrade?: { label: string; amount: bigint; rule: string } | null;
  /** Jaminan asuransi yang disetujui (plafon). */
  insurerPays?: bigint;
}

export function buildSplit(total: bigint, s: SplitInput): PayerSplit {
  const pays = s.scheme === 'bpjs' ? (s.inacbg?.tariff ?? 0n) : (s.insurerPays ?? 0n);
  const base: PayerSplit = {
    scheme: s.scheme,
    payerLabel: s.payerLabel,
    hospitalTotal: '0',
    inacbg: s.inacbg ? { ...s.inacbg, tariff: s.inacbg.tariff.toString() } : null,
    payerPays: pays.toString(),
    classUpgrade: s.upgrade ? { ...s.upgrade, amount: s.upgrade.amount.toString() } : null,
    patientShare: '0',
    hospitalAbsorbs: '0',
  };
  return recomputeSplit(base, total);
}

export interface InvoiceInput {
  id: string;
  /** Nomor urut invoice bulan Oktober (INV-2610-xxxxx). */
  seq: number;
  /** Nomor antrean loket kasir, null untuk pasien rawat inap. */
  queue: number | null;
  patientId: string;
  scenario?: ScenarioId | null;
  encounter: Invoice['encounter'];
  status: Invoice['status'];
  lines: ChargeItem[];
  split: SplitInput;
  payments?: Payment[];
  finalizedAt?: string | null;
  note?: string;
}

export function guarantorLabel(patientId: string): string {
  const p = patientById(patientId);
  if (!p) return 'Umum';
  if (p.penjamin === 'BPJS') return `BPJS · hak ${(p.kelas ?? 'kelas 3').toLowerCase()}`;
  return p.penjamin === 'Asuransi' ? 'Asuransi swasta' : 'Umum';
}

export function buildInvoice(i: InvoiceInput): Invoice {
  const p = patientById(i.patientId);
  if (!p) throw new Error(`Pasien ${i.patientId} tidak ada di fixture`);
  const split = buildSplit(invoiceTotal(i.lines), i.split);
  const payments = i.payments ?? [];
  const number = formatDocumentNumber('invoice', BigInt(i.seq), '2610');
  return {
    id: i.id,
    number,
    queueNo: i.queue === null ? null : queueNo('K', i.queue),
    scenario: i.scenario ?? null,
    patient: {
      id: p.id,
      rm: p.rm,
      name: p.nama,
      sex: p.jk,
      ageYears: p.umur,
      birthDate: p.tanggalLahir,
      allergies: [...p.alergi],
      guarantor: guarantorLabel(p.id),
    },
    encounter: i.encounter,
    status: i.status,
    lines: i.lines,
    split,
    payments,
    patientDue: patientDue(
      split,
      payments.map((x) => BigInt(x.amount)),
    ).toString(),
    finalizedAt: i.finalizedAt ?? null,
    receiptNo: i.status === 'lunas' ? number.replace('INV', 'KW') : null,
    ...(i.note ? { note: i.note } : {}),
  };
}

/** Tarif INA-CBG simulasi (regional, RS kelas B) yang dipakai lintas layar agar Kasir dan Klaim konsisten. */
export const CBG = {
  rjKronis: {
    code: 'Q-5-44-0',
    name: 'Penyakit kronis kecil lain-lain',
    classLabel: 'rawat jalan',
    tariff: 412_300n,
  },
  pneumoniaSedangK2: {
    code: 'J-4-15-II',
    name: 'Pneumonia sedang',
    classLabel: 'kelas 2',
    tariff: 6_612_800n,
  },
  pneumoniaSedangK1: {
    code: 'J-4-15-II',
    name: 'Pneumonia sedang',
    classLabel: 'kelas 1',
    tariff: 7_863_200n,
  },
  pneumoniaBeratK2: {
    code: 'J-4-15-III',
    name: 'Pneumonia berat',
    classLabel: 'kelas 2',
    tariff: 9_104_300n,
  },
  imaK1: {
    code: 'I-4-12-II',
    name: 'Infark miokard akut sedang',
    classLabel: 'kelas 1',
    tariff: 11_212_300n,
  },
  empeduK2: {
    code: 'K-1-14-I',
    name: 'Prosedur kandung empedu ringan',
    classLabel: 'kelas 2',
    tariff: 7_140_000n,
  },
  dbdK2: { code: 'A-4-14-I', name: 'Infeksi virus ringan', classLabel: 'kelas 2', tariff: 3_712_600n },
} as const;

export function dokter(id: string): string {
  const d = doctorById(id);
  if (!d) throw new Error(`Dokter ${id} tidak ada di fixture`);
  return d.nama;
}

const RJ_ADMIN = 30_000n;
const RI_ADMIN = 75_000n;
const SPESIALIS = 150_000n;

/**
 * Ny. Endang Wijaya: rawat inap pneumonia 1–5 Okt, pulang hari ini (roster hari demo). Dua malam pertama naik kelas 1
 * atas permintaan keluarga (Anggrek A-11), lalu kembali ke kelas 2 sesuai hak (Melati M-203); selisih naik kelas
 * JKN dihitung per episode (mockup Kasir).
 */
const ENDANG_LINES: ChargeItem[] = [
  line('en-1', 'igd', 'IGD', '1 Okt', 'Paket layanan IGD triase kuning', 1, 1_580_000n),
  line('en-2', 'akomodasi', 'ADT', '1 – 3 Okt', 'Kamar kelas 1 Anggrek A-11 (naik kelas)', 2, 750_000n),
  line('en-2b', 'akomodasi', 'ADT', '3 – 5 Okt', 'Kamar kelas 2 Melati M-203', 3, 450_000n),
  line('en-3', 'visite', 'CPPT', 'harian', 'Visite DPJP Sp.PD', 5, 180_000n),
  line('en-4', 'visite', 'CPPT', '2 Okt, 4 Okt', 'Konsultasi Sp.P', 2, 200_000n),
  line('en-5', 'visite', 'CPPT', '2 Okt', 'Konsultasi gizi klinik', 1, 140_000n),
  line('en-6', 'tindakan', 'eMAR', 'eMAR', 'Pemberian obat injeksi', 18, 25_000n),
  line('en-7', 'tindakan', 'eMAR', 'eMAR', 'Nebulisasi', 12, 35_000n),
  line('en-8', 'tindakan', 'Askep', '1 Okt', 'Pemasangan kateter urin', 2, 72_500n),
  line('en-9', 'tindakan', 'Askep', '1 Okt, 3 Okt', 'Pemasangan infus', 2, 45_000n),
  line('en-10', 'laboratorium', 'LIS', '1 Okt', 'Kultur sputum + uji kepekaan', 1, 450_000n),
  line('en-11', 'laboratorium', 'LIS', 'serial', 'Ureum dan kreatinin', 4, 110_000n),
  line('en-12', 'laboratorium', 'LIS', 'serial', 'Darah lengkap', 4, 95_000n),
  line('en-13', 'laboratorium', 'LIS', 'LIS', '18 pemeriksaan lain', 18, null, 1_148_500n),
  line('en-14', 'radiologi', 'RIS', '1 Okt', 'Foto toraks PA (awal)', 1, 240_000n),
  line('en-15', 'radiologi', 'RIS', '5 Okt', 'Foto toraks PA (evaluasi)', 1, 240_000n),
  line('en-16', 'obat', 'eMAR', 'eMAR', 'Seftriakson 1 g injeksi', 12, 85_000n),
  line('en-17', 'obat', 'eMAR', 'eMAR', 'Insulin aspart pen', 2, 185_000n),
  line('en-18', 'obat', 'eMAR', 'eMAR', 'Azitromisin 500 mg', 5, 32_000n),
  line('en-19', 'obat', 'eMAR', '1 – 3 Okt', 'Oksigen sungkup dan nasal kanul', 3, null, 357_000n),
  line('en-20', 'obat', 'eMAR', 'eMAR', '42 item obat dan alkes lain', 42, null, 5_362_000n),
  line('en-21', 'administrasi', 'Sistem', '1 Okt', 'Administrasi rawat inap', 1, RI_ADMIN),
];

/** Baris dasar rawat jalan: administrasi saat daftar dan konsultasi saat dipanggil poli (jam roster). */
const rjLines = (
  p: string,
  src: string,
  at: [daftar: string, poli: string],
  extra: ChargeItem[],
): ChargeItem[] => [
  line(`${p}-a`, 'administrasi', 'Pendaftaran', at[0], 'Administrasi rawat jalan', 1, RJ_ADMIN),
  line(`${p}-k`, 'visite', src, at[1], 'Konsultasi dokter spesialis', 1, SPESIALIS),
  ...extra,
];

const rjBpjs = (patientId: string): SplitInput => ({
  scheme: 'bpjs',
  payerLabel: `BPJS ${guarantorLabel(patientId).replace('BPJS · ', '')}`,
  inacbg: { ...CBG.rjKronis, estimate: true },
});

/** Tagihan non-skenario hari demo (antrean kasir). Pasien skenario ditambahkan dari mesin skenario. */
export const STATIC_INVOICES: readonly Invoice[] = [
  buildInvoice({
    id: 'inv-endang',
    seq: 2217,
    queue: 7,
    patientId: 'ps-endang',
    encounter: {
      kind: 'rawat-inap',
      label: 'Rawat inap 5 hari · pneumonia · pulang hari ini',
      location: 'Melati M-203 · naik kelas 1 di Anggrek A-11 (1–3 Okt)',
      period: '1 – 5 Okt 2026',
      sep: '0301R0011026V004417',
      dpjp: dokter('dr-andini'),
      discharged: true,
    },
    status: 'final',
    lines: ENDANG_LINES,
    split: {
      scheme: 'bpjs',
      payerLabel: 'BPJS hak kelas 2',
      inacbg: { ...CBG.pneumoniaSedangK2, estimate: true },
      upgrade: {
        label: 'Naik kelas 1 (atas permintaan)',
        amount: CBG.pneumoniaSedangK1.tariff - CBG.pneumoniaSedangK2.tariff,
        rule: 'Selisih naik kelas 1 = tarif INA-CBG kelas 1 − kelas 2, berlaku per episode walau naik kelas hanya sebagian masa rawat (master aturan selisih biaya JKN)',
      },
    },
    payments: [
      {
        id: 'pay-endang-dp',
        kind: 'deposit',
        method: 'va',
        amount: '1000000',
        at: at('2026-10-01', '14.20'),
        reference: 'VA BTN 8808 0127 4127 8802',
      },
    ],
    finalizedAt: at(TODAY, '09.58'),
  }),
  buildInvoice({
    id: 'inv-ayu',
    seq: 2226,
    queue: 11,
    patientId: 'ps-ayu',
    encounter: {
      kind: 'rawat-jalan',
      label: 'Rawat jalan Poli Penyakit Dalam',
      location: 'Ruang tunggu kasir',
      period: 'Sen, 5 Okt 2026',
      sep: null,
      dpjp: dokter('dr-andini'),
      discharged: true,
    },
    status: 'berjalan',
    lines: rjLines(
      'ay',
      'Poli PD',
      ['08.40', '09.04'],
      [
        line('ay-l1', 'laboratorium', 'LIS', '09.20', 'Darah lengkap', 1, 95_000n),
        line('ay-l2', 'laboratorium', 'LIS', '09.20', 'CRP', 1, 120_000n),
        line('ay-o', 'obat', 'Farmasi', '09.40', 'Obat 5 hari · 3 item', 1, 68_500n),
      ],
    ),
    split: { scheme: 'umum', payerLabel: 'Umum (bayar sendiri)' },
  }),
  buildInvoice({
    id: 'inv-fransiska',
    seq: 2221,
    queue: 9,
    patientId: 'ps-fransiska',
    encounter: {
      kind: 'rawat-jalan',
      label: 'Rawat jalan Poli Penyakit Dalam',
      location: 'Ruang tunggu kasir',
      period: 'Sen, 5 Okt 2026',
      sep: null,
      dpjp: dokter('dr-andini'),
      discharged: true,
    },
    status: 'final',
    lines: rjLines(
      'fl',
      'Poli PD',
      ['08.20', '08.52'],
      [
        line('fl-l1', 'laboratorium', 'LIS', '09.05', 'Asam urat', 1, 55_000n),
        line('fl-l2', 'laboratorium', 'LIS', '09.05', 'Kreatinin', 1, 45_000n),
        line('fl-l3', 'laboratorium', 'LIS', '09.05', 'Darah lengkap', 1, 95_000n),
        line('fl-o', 'obat', 'Farmasi', '09.55', 'Obat 14 hari · 3 item', 1, 237_000n),
      ],
    ),
    split: {
      scheme: 'asuransi',
      payerLabel: 'Asuransi swasta · plafon RJ Rp 500.000',
      insurerPays: 500_000n,
    },
    finalizedAt: at(TODAY, '10.12'),
    note: 'Surat jaminan asuransi diterima 08.25',
  }),
  buildInvoice({
    id: 'inv-lukman',
    seq: 2224,
    queue: 10,
    patientId: 'ps-lukman',
    encounter: {
      kind: 'rawat-jalan',
      label: 'Rawat jalan Poli Penyakit Dalam',
      location: 'Ruang tunggu kasir',
      period: 'Sen, 5 Okt 2026',
      sep: '0301R0011026V005096',
      dpjp: dokter('dr-andini'),
      discharged: true,
    },
    status: 'final',
    lines: rjLines(
      'lh',
      'Poli PD',
      ['08.25', '08.40'],
      [line('lh-o', 'obat', 'Farmasi', '10.05', 'Obat 7 hari · 2 item', 1, 58_000n)],
    ),
    split: rjBpjs('ps-lukman'),
    finalizedAt: at(TODAY, '10.21'),
  }),
  buildInvoice({
    id: 'inv-raka',
    seq: 2158,
    queue: null,
    patientId: 'ps-raka',
    encounter: {
      kind: 'rawat-inap',
      label: 'Rawat inap hari ke-2 · DBD',
      location: 'Mawar W-308 · kelas 2',
      period: '4 Okt 2026 – sekarang',
      sep: '0301R0011026V004871',
      dpjp: dokter('dr-nadia'),
      discharged: false,
    },
    status: 'berjalan',
    lines: [
      line('rk-1', 'igd', 'IGD', '4 Okt', 'Pelayanan IGD anak', 1, 650_000n),
      line('rk-2', 'akomodasi', 'ADT', '4 – 5 Okt', 'Kamar kelas 2 Mawar W-308', 2, 450_000n),
      line('rk-3', 'visite', 'CPPT', 'harian', 'Visite DPJP Sp.A', 2, 180_000n),
      line('rk-4', 'tindakan', 'Askep', '4 Okt', 'Pemasangan infus anak', 1, 55_000n),
      line('rk-5', 'laboratorium', 'LIS', 'serial', 'Darah lengkap (hematokrit, trombosit)', 4, 95_000n),
      line('rk-6', 'obat', 'eMAR', 'eMAR', 'Cairan infus kristaloid dan alkes', 1, null, 385_000n),
      line('rk-7', 'administrasi', 'Sistem', '4 Okt', 'Administrasi rawat inap', 1, RI_ADMIN),
    ],
    split: {
      scheme: 'bpjs',
      payerLabel: 'BPJS hak kelas 2',
      inacbg: { ...CBG.dbdK2, estimate: true },
    },
    note: 'Pasien masih dirawat; charge capture berjalan',
  }),
  buildInvoice({
    id: 'inv-wahyuni',
    seq: 2203,
    queue: 6,
    patientId: 'ps-wahyuni',
    encounter: {
      kind: 'rawat-jalan',
      label: 'Rawat jalan Poli Penyakit Dalam · kontrol',
      location: 'Farmasi rawat jalan (menunggu obat PRB)',
      period: 'Sen, 5 Okt 2026',
      sep: '0301R0011026V005087',
      dpjp: dokter('dr-andini'),
      discharged: true,
    },
    status: 'lunas',
    lines: rjLines(
      'sw',
      'Poli PD',
      ['08.55', '09.26'],
      [
        line('sw-e', 'radiologi', 'Poli PD', '09.30', 'EKG 12 sadapan', 1, 85_000n),
        line('sw-l1', 'laboratorium', 'LIS', '09.45', 'Profil lipid', 1, 160_000n),
        line('sw-l2', 'laboratorium', 'LIS', '09.45', 'Kreatinin', 1, 45_000n),
        line('sw-o', 'obat', 'Farmasi', '09.50', 'Obat 30 hari (PRB) · 2 item', 1, 186_000n),
      ],
    ),
    split: rjBpjs('ps-wahyuni'),
    finalizedAt: at(TODAY, '09.55'),
    note: 'Tagihan ditutup 09.55 · pasien bayar Rp 0',
  }),
  buildInvoice({
    id: 'inv-bonifasius',
    seq: 2208,
    queue: 5,
    patientId: 'ps-bonifasius',
    encounter: {
      kind: 'rawat-jalan',
      label: 'Rawat jalan Poli Jantung · kontrol pasca rawat',
      location: 'Farmasi rawat jalan (menunggu obat PRB)',
      period: 'Sen, 5 Okt 2026',
      sep: '0301R0011026V005034',
      dpjp: dokter('dr-bagus'),
      discharged: true,
    },
    status: 'lunas',
    lines: rjLines(
      'bt',
      'Poli JT',
      ['08.40', '09.05'],
      [
        line('bt-e', 'radiologi', 'Poli JT', '09.10', 'EKG 12 sadapan', 1, 85_000n),
        line('bt-o', 'obat', 'Farmasi', '09.40', 'Obat 30 hari (PRB) · 4 item', 1, 246_000n),
      ],
    ),
    split: rjBpjs('ps-bonifasius'),
    finalizedAt: at(TODAY, '09.48'),
    note: 'Tagihan ditutup 09.48 · pasien bayar Rp 0',
  }),
  buildInvoice({
    id: 'inv-sugeng',
    seq: 2219,
    queue: 8,
    patientId: 'ps-sugeng',
    encounter: {
      kind: 'rawat-jalan',
      label: 'Rawat jalan Poli Saraf · kontrol',
      location: 'Farmasi rawat jalan (resep PRB ditelaah)',
      period: 'Sen, 5 Okt 2026',
      sep: '0301R0011026V005058',
      dpjp: dokter('dr-yudha'),
      discharged: true,
    },
    status: 'lunas',
    lines: rjLines(
      'sr',
      'Poli SR',
      ['09.10', '09.35'],
      [
        line('sr-l1', 'laboratorium', 'LIS', '09.20', 'Profil lipid', 1, 160_000n),
        line('sr-l2', 'laboratorium', 'LIS', '09.20', 'Glukosa sewaktu', 1, 35_000n),
        line('sr-o', 'obat', 'Farmasi', '09.48', 'Obat 30 hari (PRB) · 3 item', 1, 214_000n),
      ],
    ),
    split: rjBpjs('ps-sugeng'),
    finalizedAt: at(TODAY, '10.02'),
    note: 'Tagihan ditutup 10.02 · pasien bayar Rp 0 (sitikolin non-Fornas dibayar terpisah)',
  }),
];

// ---------------------------------------------------------------------------------------------------------------
// Klaim INA-CBG (U05/U06). Kode hanya dari contoh seed (`SEED_REF_SAMPLES`, dijaga tes).
// ---------------------------------------------------------------------------------------------------------------

export const ICD10_NAME: Readonly<Record<string, string>> = {
  'A41.9': 'Sepsis, tidak spesifik',
  A91: 'Demam berdarah dengue',
  'C18.9': 'Neoplasma ganas kolon',
  'E11.9': 'Diabetes melitus tipe 2 tanpa komplikasi',
  'E78.5': 'Hiperlipidemia, tidak spesifik',
  'E87.5': 'Hiperkalemia',
  I10: 'Hipertensi esensial (primer)',
  'I20.0': 'Angina tidak stabil',
  'I21.4': 'Infark miokard akut non-ST elevasi',
  'I63.9': 'Infark serebral',
  J13: 'Pneumonia akibat S. pneumoniae',
  'J18.9': 'Pneumonia, tidak spesifik',
  'J96.0': 'Gagal napas akut',
  K30: 'Dispepsia',
  'K80.2': 'Batu kandung empedu tanpa kolesistitis',
  'N17.9': 'Gagal ginjal akut',
  'N18.3': 'Penyakit ginjal kronik stadium 3',
  'N18.5': 'Penyakit ginjal kronik stadium 5',
  'R57.2': 'Syok septik',
  'S72.3': 'Fraktur batang femur',
  'Z51.1': 'Sesi kemoterapi',
  'Z99.2': 'Ketergantungan dialisis',
};

export const ICD9_NAME: Readonly<Record<string, string>> = {
  '00.17': 'Infus agen vasopresor',
  '39.95': 'Hemodialisis',
  '51.23': 'Kolesistektomi laparoskopik',
  '79.35': 'Reduksi terbuka dengan fiksasi internal femur',
  '87.03': 'CT scan kepala',
  '88.56': 'Angiografi koroner',
  '88.72': 'Ekokardiografi',
  '88.76': 'USG abdomen',
  '89.03': 'Pemeriksaan dan evaluasi',
  '89.52': 'EKG',
  '89.65': 'Analisis gas darah arteri',
  '93.90': 'Ventilasi non-invasif',
  '96.71': 'Ventilasi mekanik < 96 jam',
  '99.18': 'Infus cairan elektrolit',
  '99.25': 'Injeksi kemoterapi',
};

type DxRole = Claim['diagnoses'][number]['role'];

export function dx(code: string, role: DxRole): Claim['diagnoses'][number] {
  const name = ICD10_NAME[code];
  if (!name) throw new Error(`ICD-10 ${code} bukan contoh seed`);
  return { code, name, role };
}

export function px(code: string): Claim['procedures'][number] {
  const name = ICD9_NAME[code];
  if (!name) throw new Error(`ICD-9-CM ${code} bukan contoh seed`);
  return { code, name };
}

/** Daftar kelengkapan berkas; indeks di `missing` belum ada. */
function docs(list: ReadonlyArray<[string, string]>, missing: readonly number[] = []): Claim['documents'] {
  return list.map(([id, label], i) => ({ id, label, ok: !missing.includes(i) }));
}

export const DOCS_RI: ReadonlyArray<[string, string]> = [
  ['sep', 'SEP dan identitas peserta'],
  ['resume', 'Resume medis final ber-TTE'],
  ['penunjang', 'Hasil lab dan radiologi pendukung'],
  ['billing', 'Billing final (tarif RS)'],
  ['spri', 'Surat perintah rawat inap'],
];
export const DOCS_RJ: ReadonlyArray<[string, string]> = [
  ['sep', 'SEP dan identitas peserta'],
  ['resume', 'Catatan poli / resume RJ ber-TTE'],
  ['penunjang', 'Hasil penunjang'],
  ['billing', 'Billing final (tarif RS)'],
  ['rujukan', 'Surat rujukan atau rujuk balik (PRB)'],
];
const docsPending = (extra: string): ReadonlyArray<[string, string]> => [
  ['awal', 'Berkas klaim awal (sudah terkirim)'],
  ['jawaban', 'Jawaban tertulis atas pertanyaan verifikator'],
  ['tambahan', extra],
  ['koordinator', 'Persetujuan koordinator casemix'],
];
const DOCS_DISPUTE: ReadonlyArray<[string, string]> = [
  ['ba', 'Berita acara dispute dari verifikator'],
  ['telaah', 'Telaah DPJP dan komite medik'],
  ['bukti', 'Bukti klinis pendukung (CPPT, lab, radiologi)'],
  ['rekomendasi', 'Rekomendasi dewan pertimbangan klinis'],
];

export interface ClaimInput extends Omit<Claim, 'patient' | 'scenario' | 'documents' | 'submittedAt'> {
  patientId: string;
  scenario?: ScenarioId | null;
  documents: ReadonlyArray<[string, string]>;
  missing?: readonly number[];
  submittedAt?: string | null;
}

export function buildClaim(c: ClaimInput): Claim {
  const p = patientById(c.patientId);
  if (!p) throw new Error(`Pasien ${c.patientId} tidak ada di fixture`);
  const { patientId: _p, documents, missing, ...rest } = c;
  return {
    ...rest,
    scenario: c.scenario ?? null,
    patient: { id: p.id, rm: p.rm, name: p.nama },
    documents: docs(documents, missing),
    submittedAt: c.submittedAt ?? null,
  };
}

const cbg = (
  code: string,
  name: string,
  classLabel: string,
  tariff: bigint,
  final = true,
): NonNullable<Claim['grouper']> => ({
  cbg: code,
  name,
  classLabel,
  tariff: tariff.toString(),
  specialCmg: null,
  final,
});
const rj = CBG.rjKronis;
const totalOf = (invoiceId: string): string =>
  STATIC_INVOICES.find((i) => i.id === invoiceId)?.split.hospitalTotal ?? '0';

/** Klaim non-skenario (contoh daftar per status; jumlah total periode ada di `CLAIM_TOTALS`). */
export const STATIC_CLAIMS: readonly Claim[] = [
  buildClaim({
    id: 'kl-endang',
    patientId: 'ps-endang',
    encounter: {
      kind: 'rawat-inap',
      summary: 'RI · pneumonia · 5 hari',
      title: 'rawat inap 5 hari (pulang hari ini)',
      sep: '0301R0011026V004417',
      classLabel: 'hak kelas 2 · naik kelas 1',
      dpjp: dokter('dr-andini'),
      resume: 'resume draf · TTE DPJP sebelum pulang 13.00',
      discharged: true,
    },
    status: 'draft',
    tag: { label: 'Ada saran', level: 'warn' },
    ageLabel: 'pulang hari ini',
    diagnoses: [dx('J18.9', 'utama'), dx('E11.9', 'sekunder'), dx('N17.9', 'perlu-bukti')],
    procedures: [px('89.65'), px('99.18')],
    grouper: cbg(
      CBG.pneumoniaSedangK2.code,
      CBG.pneumoniaSedangK2.name,
      'kelas 2',
      CBG.pneumoniaSedangK2.tariff,
      false,
    ),
    hospitalCost: invoiceTotal(ENDANG_LINES).toString(),
    documents: [
      ...DOCS_RI,
      ['bukti-n17', 'Bukti klinis N17.9 di CPPT'],
      ['naik-kelas', 'Persetujuan naik kelas bertanda tangan'],
    ],
    missing: [5],
    note: {
      level: 'warn',
      title: 'Saran koding:',
      text: 'kultur sputum positif S. pneumoniae; J18.9 → J13 lebih spesifik dan didukung bukti. Perlu konfirmasi DPJP (query koder).',
    },
    suggestion: {
      from: 'J18.9',
      to: 'J13',
      toName: 'Pneumonia akibat S. pneumoniae',
      reason: 'Kultur sputum 1 Okt: S. pneumoniae tumbuh',
      evidenceDocId: 'bukti-n17',
      upgraded: {
        cbg: CBG.pneumoniaBeratK2.code,
        name: CBG.pneumoniaBeratK2.name,
        tariff: CBG.pneumoniaBeratK2.tariff.toString(),
      },
    },
  }),
  buildClaim({
    id: 'kl-bonifasius-ri',
    patientId: 'ps-bonifasius',
    encounter: {
      kind: 'rawat-inap',
      summary: 'RI · angina tidak stabil · 4 hari',
      title: 'rawat inap 4 hari (pulang 3 Okt)',
      sep: '0301R0011026V004702',
      classLabel: 'hak kelas 1',
      dpjp: dokter('dr-melati'),
      resume: 'resume belum ber-TTE',
      discharged: true,
    },
    status: 'draft',
    tag: { label: 'Resume belum final', level: 'bad' },
    ageLabel: 'H+2',
    diagnoses: [dx('I20.0', 'utama'), dx('I10', 'sekunder')],
    procedures: [px('88.56'), px('89.52')],
    grouper: null,
    hospitalCost: '14385000',
    documents: DOCS_RI,
    missing: [1],
    note: {
      level: 'bad',
      title: 'Resume belum final:',
      text: 'DPJP belum menandatangani resume (TTE). Grouping final ditahan; pengingat otomatis terkirim ke DPJP 08.00.',
    },
    suggestion: null,
  }),
  buildClaim({
    id: 'kl-raka',
    patientId: 'ps-raka',
    encounter: {
      kind: 'rawat-inap',
      summary: 'RI · DBD · hari ke-2',
      title: 'rawat inap hari ke-2 (masih dirawat)',
      sep: '0301R0011026V004871',
      classLabel: 'hak kelas 2',
      dpjp: dokter('dr-nadia'),
      resume: 'pasien masih dirawat',
      discharged: false,
    },
    status: 'draft',
    tag: { label: 'Belum pulang', level: 'info' },
    ageLabel: 'dirawat',
    diagnoses: [dx('A91', 'sementara')],
    procedures: [px('99.18')],
    grouper: null,
    hospitalCost: null,
    documents: DOCS_RI,
    missing: [1, 3],
    note: {
      level: 'info',
      title: 'Pasien masih dirawat.',
      text: 'Berkas klaim dibuka setelah pasien pulang dan resume final; koding sementara hanya untuk estimasi.',
    },
    suggestion: null,
  }),
  buildClaim({
    id: 'kl-lukman',
    patientId: 'ps-lukman',
    encounter: {
      kind: 'rawat-jalan',
      summary: 'RJ · kontrol DM',
      title: 'rawat jalan Poli Penyakit Dalam',
      sep: '0301R0011026V005096',
      classLabel: 'rawat jalan',
      dpjp: dokter('dr-andini'),
      resume: 'catatan poli ber-TTE 08.50',
      discharged: true,
    },
    status: 'draft',
    tag: { label: 'Siap', level: 'ok' },
    ageLabel: 'H+0',
    diagnoses: [dx('E11.9', 'utama')],
    procedures: [px('89.03')],
    grouper: cbg(rj.code, rj.name, rj.classLabel, rj.tariff, false),
    hospitalCost: totalOf('inv-lukman'),
    documents: DOCS_RJ,
    note: { level: 'ok', title: 'Tidak ada saran koding.', text: 'Kode sesuai catatan poli dan order.' },
    suggestion: null,
  }),
  buildClaim({
    id: 'kl-bonifasius',
    patientId: 'ps-bonifasius',
    encounter: {
      kind: 'rawat-jalan',
      summary: 'RJ · kontrol jantung 14 Sep',
      title: 'rawat jalan Poli Jantung 14 Sep',
      sep: '0301R0011026V003377',
      classLabel: 'rawat jalan',
      dpjp: dokter('dr-melati'),
      resume: 'catatan poli ber-TTE 14 Sep',
      discharged: true,
    },
    status: 'sent',
    tag: { label: 'Terkirim', level: 'info' },
    ageLabel: '3 hr',
    diagnoses: [dx('I10', 'utama')],
    procedures: [px('89.52')],
    grouper: cbg(rj.code, rj.name, rj.classLabel, rj.tariff),
    hospitalCost: '498000',
    documents: DOCS_RJ,
    note: {
      level: 'info',
      title: 'Menunggu verifikasi BPJS.',
      text: 'Terkirim 2 Okt dalam batch RJ September.',
    },
    suggestion: null,
    submittedAt: at('2026-10-02', '15.10'),
  }),
  buildClaim({
    id: 'kl-aminah',
    patientId: 'ps-aminah',
    encounter: {
      kind: 'rawat-inap',
      summary: 'RI · ICU · syok sepsis',
      title: 'rawat inap 12 hari (ICU 6 hari)',
      sep: '0301R0011026V002914',
      classLabel: 'hak kelas 3',
      dpjp: dokter('dr-ferry'),
      resume: 'resume final 2 Sep 10.15',
      discharged: true,
    },
    status: 'pending',
    tag: { label: 'Konfirmasi koding', level: 'warn' },
    ageLabel: '31 hr',
    diagnoses: [dx('A41.9', 'utama'), dx('R57.2', 'sekunder')],
    procedures: [px('00.17'), px('96.71')],
    grouper: cbg('A-4-10-III', 'Septikemia berat', 'kelas 3', 17_371_800n),
    hospitalCost: '29950000',
    documents: docsPending('Catatan pemberian norepinefrin (eMAR)'),
    missing: [1, 2, 3],
    note: {
      level: 'warn',
      title: 'Pertanyaan verifikator:',
      text: 'R57.2 sebagai diagnosis sekunder perlu bukti pemakaian vasopresor.',
    },
    suggestion: null,
    submittedAt: at('2026-09-04', '09.30'),
  }),
  buildClaim({
    id: 'kl-lestiani',
    patientId: 'ps-lestiani',
    encounter: {
      kind: 'rawat-inap',
      summary: 'RI · stroke iskemik',
      title: 'rawat inap 5 hari',
      sep: '0301R0011026V003120',
      classLabel: 'hak kelas 3',
      dpjp: dokter('dr-yudha'),
      resume: 'resume final 11 Sep 14.05',
      discharged: true,
    },
    status: 'pending',
    tag: { label: 'Lampiran CT', level: 'warn' },
    ageLabel: '22 hr',
    diagnoses: [dx('I63.9', 'utama'), dx('I10', 'sekunder')],
    procedures: [px('87.03')],
    grouper: cbg('G-4-14-II', 'Gangguan pembuluh darah otak sedang', 'kelas 3', 7_483_400n),
    hospitalCost: '11240000',
    documents: docsPending('Ekspertise CT kepala'),
    missing: [1, 2, 3],
    note: {
      level: 'warn',
      title: 'Pertanyaan verifikator:',
      text: 'ekspertise CT kepala belum terlampir di berkas.',
    },
    suggestion: null,
    submittedAt: at('2026-09-13', '10.20'),
  }),
  buildClaim({
    id: 'kl-maria',
    patientId: 'ps-maria',
    encounter: {
      kind: 'rawat-jalan',
      summary: 'RJ · kemoterapi siklus 3',
      title: 'rawat jalan kemoterapi siklus 3',
      sep: '0301R0011026V003902',
      classLabel: 'rawat jalan',
      dpjp: dokter('dr-rahmat'),
      resume: 'catatan poli ber-TTE 24 Sep',
      discharged: true,
    },
    status: 'pending',
    tag: { label: 'Protokol kemo', level: 'warn' },
    ageLabel: '9 hr',
    diagnoses: [dx('C18.9', 'utama'), dx('Z51.1', 'sekunder')],
    procedures: [px('99.25')],
    grouper: cbg('Q-5-29-0', 'Kemoterapi rawat jalan', 'rawat jalan', 3_102_700n),
    hospitalCost: '3380000',
    documents: docsPending('Protokol kemoterapi bertanda tangan DPJP'),
    missing: [1, 2, 3],
    note: {
      level: 'warn',
      title: 'Pertanyaan verifikator:',
      text: 'protokol kemoterapi siklus 3 belum dilampirkan.',
    },
    suggestion: null,
    submittedAt: at('2026-09-26', '11.00'),
  }),
  buildClaim({
    id: 'kl-hendro',
    patientId: 'ps-hendro',
    encounter: {
      kind: 'rawat-inap',
      summary: 'RI · ICU · pneumonia',
      title: 'rawat inap 9 hari (ICU 4 hari)',
      sep: '0301R0011026V002655',
      classLabel: 'hak kelas 2',
      dpjp: dokter('dr-kartika'),
      resume: 'resume final 15 Agu 09.40',
      discharged: true,
    },
    status: 'dispute',
    tag: { label: 'Dispute medis', level: 'bad' },
    ageLabel: '48 hr',
    diagnoses: [dx('J18.9', 'utama'), dx('J96.0', 'sekunder')],
    procedures: [px('93.90'), px('89.65')],
    grouper: cbg(
      CBG.pneumoniaBeratK2.code,
      CBG.pneumoniaBeratK2.name,
      'kelas 2',
      CBG.pneumoniaBeratK2.tariff,
    ),
    hospitalCost: '19870000',
    documents: DOCS_DISPUTE,
    missing: [1, 2, 3],
    note: {
      level: 'bad',
      title: 'Alasan dispute:',
      text: 'verifikator menilai indikasi rawat ICU tidak terpenuhi (CURB-65 = 2).',
    },
    suggestion: null,
    submittedAt: at('2026-08-18', '13.30'),
  }),
  buildClaim({
    id: 'kl-joko',
    patientId: 'ps-joko',
    encounter: {
      kind: 'rawat-inap',
      summary: 'RI · fraktur femur ORIF',
      title: 'rawat inap 6 hari',
      sep: '0301R0011026V003305',
      classLabel: 'hak kelas 1 · naik kelas VIP',
      dpjp: dokter('dr-yohanes'),
      resume: 'resume final 14 Sep 16.20',
      discharged: true,
    },
    status: 'dispute',
    tag: { label: 'Dispute tarif', level: 'bad' },
    ageLabel: '19 hr',
    diagnoses: [dx('S72.3', 'utama')],
    procedures: [px('79.35')],
    grouper: cbg('M-1-30-II', 'Prosedur tungkai bawah sedang', 'kelas 1', 12_840_000n),
    hospitalCost: '24150000',
    documents: DOCS_DISPUTE,
    missing: [2, 3],
    note: {
      level: 'bad',
      title: 'Alasan dispute:',
      text: 'implan ORIF ditagihkan terpisah; verifikator menilai sudah termasuk tarif INA-CBG.',
    },
    suggestion: null,
    submittedAt: at('2026-09-16', '08.45'),
  }),
  buildClaim({
    id: 'kl-yusuf',
    patientId: 'ps-yusuf',
    encounter: {
      kind: 'rawat-jalan',
      summary: 'RJ · hemodialisis',
      title: 'hemodialisis rutin 29 Sep',
      sep: '0301R0011026V004205',
      classLabel: 'rawat jalan',
      dpjp: dokter('dr-sinta'),
      resume: 'catatan HD ber-TTE 29 Sep',
      discharged: true,
    },
    status: 'payable',
    tag: { label: 'Layak bayar', level: 'ok' },
    ageLabel: '6 hr',
    diagnoses: [dx('N18.5', 'utama'), dx('Z99.2', 'sekunder')],
    procedures: [px('39.95')],
    grouper: cbg('N-3-15-0', 'Prosedur dialisis', 'rawat jalan', 1_006_500n),
    hospitalCost: '950000',
    documents: DOCS_RJ,
    note: {
      level: 'ok',
      title: 'Layak bayar.',
      text: `Verifikator menyetujui 2 Okt; menunggu pembayaran BPJS ke rekening penampungan ${REKENING.penampungan}.`,
    },
    suggestion: null,
    submittedAt: at('2026-09-29', '15.40'),
  }),
  buildClaim({
    id: 'kl-siti',
    patientId: 'ps-siti',
    encounter: {
      kind: 'rawat-jalan',
      summary: 'RJ · kontrol hipertensi 17 Agu',
      title: 'rawat jalan Poli Penyakit Dalam 17 Agu',
      sep: '0301R0011026V002580',
      classLabel: 'rawat jalan',
      dpjp: dokter('dr-andini'),
      resume: 'catatan poli ber-TTE 17 Agu',
      discharged: true,
    },
    status: 'paid',
    tag: { label: 'Dibayar', level: 'ok' },
    ageLabel: 'dibayar 1 Okt',
    diagnoses: [dx('I10', 'utama')],
    procedures: [px('89.03')],
    grouper: cbg(rj.code, rj.name, rj.classLabel, rj.tariff),
    hospitalCost: '512000',
    documents: DOCS_RJ,
    note: {
      level: 'ok',
      title: 'Dibayar BPJS.',
      text: `Dana masuk rekening penampungan klaim ${REKENING.penampungan} 1 Okt; piutang ditutup otomatis.`,
    },
    suggestion: null,
    submittedAt: at('2026-09-03', '10.00'),
  }),
];

export const CLAIM_KPIS = {
  claimsMonth: { total: 1284, rj: 1031, ri: 253 },
  submittedValue: '6900000000',
  avgCodingDays: 1.8,
  pending: { count: 12, value: '184000000' },
  dispute: { count: 3, value: '41000000' },
} as const;

/** Jumlah klaim periode berjalan per status (Σ = klaim bulan ini). */
export const CLAIM_TOTALS = {
  draft: 46,
  sent: 1108,
  pending: 12,
  payable: 94,
  dispute: 3,
  paid: 21,
} as const;

export const KASIR_SHIFT = {
  label: 'Shift pagi · dibuka 07.00',
  counter: 'Loket kasir 1 · RJ dan RI',
  openingCash: '500000',
} as const;

// ---------------------------------------------------------------------------------------------------------------
// Akuntansi (U04/U07/U09): bagan akun, jurnal otomatis, umur piutang, rekonsiliasi bank.
// ---------------------------------------------------------------------------------------------------------------

export interface Akun {
  code: string;
  name: string;
}

export const AKUN = {
  bankOps: { code: '1-1120', name: `Bank BTN ${REKENING.operasional} — operasional` },
  bankKlaim: { code: '1-1130', name: `Bank BTN ${REKENING.penampungan} — penampungan klaim BPJS` },
  piutangBpjsRj: { code: '1-1310', name: 'Piutang BPJS — RJ' },
  piutangBpjsRi: { code: '1-1320', name: 'Piutang BPJS — RI' },
  piutangPasien: { code: '1-1330', name: 'Piutang pasien' },
  ckpn: { code: '1-1390', name: 'Cadangan kerugian penurunan nilai — piutang BPJS' },
  persediaan: { code: '1-1410', name: 'Persediaan obat dan BHP' },
  utangUsaha: { code: '2-1110', name: 'Utang usaha — pemasok' },
  uangMuka: { code: '2-1210', name: 'Uang muka pasien' },
  utangPembiayaan: { code: '2-1310', name: 'Utang pembiayaan piutang — BTN' },
  pendapatanRj: { code: '4-1100', name: 'Pendapatan RJ — JKN' },
  pendapatanRi: { code: '4-1200', name: 'Pendapatan RI — JKN' },
  selisihCbg: { code: '4-1900', name: 'Selisih tarif INA-CBG (pengurang pendapatan)' },
  bebanMargin: { code: '6-2100', name: 'Beban margin pembiayaan' },
  bebanCkpn: { code: '6-3100', name: 'Beban penurunan nilai piutang' },
} as const satisfies Record<string, Akun>;

export const debit = (account: Akun | null, v: bigint): JournalLine => ({
  account,
  debit: v.toString(),
  credit: '0',
});
export const credit = (account: Akun | null, v: bigint): JournalLine => ({
  account,
  debit: '0',
  credit: v.toString(),
});

export interface JournalInput {
  id: string;
  seq: number;
  /** Periode penomoran `YYMM` (bawaan Oktober 2026). */
  period?: string;
  date: string;
  source: JournalEntry['source'];
  reference: string;
  description: string;
  status?: JournalEntry['status'];
  scenario?: ScenarioId | null;
  lines: JournalLine[];
}

export function buildJournal(j: JournalInput): JournalEntry {
  return {
    id: j.id,
    number: formatDocumentNumber('journal', BigInt(j.seq), j.period ?? '2610'),
    date: j.date,
    source: j.source,
    reference: j.reference,
    description: j.description,
    status: j.status ?? 'terposting',
    scenario: j.scenario ?? null,
    lines: j.lines.filter((l) => l.debit !== '0' || l.credit !== '0'),
  };
}

/**
 * Pengakuan pendapatan saat kunjungan BPJS ditutup: piutang BPJS sebesar tarif INA-CBG, tanggungan pasien dari
 * uang muka/piutang pasien, selisih tarif RS vs INA-CBG sebagai pengurang (atau penambah) pendapatan.
 */
export function recognitionLines(inv: Invoice, inpatient: boolean, patientAccount: Akun): JournalLine[] {
  const s = inv.split;
  const absorbs = BigInt(s.hospitalAbsorbs);
  return [
    debit(inpatient ? AKUN.piutangBpjsRi : AKUN.piutangBpjsRj, BigInt(s.payerPays)),
    debit(patientAccount, BigInt(s.patientShare)),
    absorbs > 0n ? debit(AKUN.selisihCbg, absorbs) : credit(AKUN.selisihCbg, -absorbs),
    credit(inpatient ? AKUN.pendapatanRi : AKUN.pendapatanRj, BigInt(s.hospitalTotal)),
  ];
}

const invoiceById = (id: string): Invoice => {
  const inv = STATIC_INVOICES.find((i) => i.id === id);
  if (!inv) throw new Error(`Invoice ${id} tidak ada`);
  return inv;
};
const HENDRO_TARIFF = CBG.pneumoniaBeratK2.tariff;
export const DISPUTE_JOURNAL_ID = 'ju-dispute-hendro';
export const BPJS_TRANSFER_JOURNAL_ID = 'ju-bpjs-agt';

/** Contoh jurnal otomatis hari demo (seluruh periode: `JOURNAL_COUNT`). */
export const STATIC_JOURNALS: readonly JournalEntry[] = [
  buildJournal({
    id: 'ju-qris-umum',
    seq: 388,
    date: at(TODAY, '09.12'),
    source: 'tpdi-btn',
    reference: 'TPDI · QRIS INV-2610-02191',
    description: `Pelunasan pasien umum via QRIS · dana langsung ke BTN ${REKENING.operasional}`,
    lines: [debit(AKUN.bankOps, 1_284_000n), credit(AKUN.piutangPasien, 1_284_000n)],
  }),
  buildJournal({
    id: 'ju-wahyuni',
    seq: 393,
    date: at(TODAY, '09.55'),
    source: 'kasir',
    reference: `Kasir · ${invoiceById('inv-wahyuni').number}`,
    description: 'Tutup kunjungan RJ BPJS · tarif RS vs estimasi INA-CBG',
    lines: recognitionLines(invoiceById('inv-wahyuni'), false, AKUN.piutangPasien),
  }),
  buildJournal({
    id: 'ju-sugeng',
    seq: 398,
    date: at(TODAY, '10.02'),
    source: 'kasir',
    reference: `Kasir · ${invoiceById('inv-sugeng').number}`,
    description: 'Tutup kunjungan RJ BPJS · tarif RS vs estimasi INA-CBG',
    lines: recognitionLines(invoiceById('inv-sugeng'), false, AKUN.piutangPasien),
  }),
  buildJournal({
    id: 'ju-retur',
    seq: 402,
    date: at(TODAY, '10.05'),
    source: 'logistik',
    reference: 'Logistik · retur RT-2610-0031',
    description: 'Retur obat mendekati kedaluwarsa ke pemasok PBF-014',
    lines: [debit(AKUN.utangUsaha, 4_120_000n), credit(AKUN.persediaan, 4_120_000n)],
  }),
  buildJournal({
    id: 'ju-grn',
    seq: 409,
    date: at(TODAY, '10.18'),
    source: 'logistik',
    reference: 'Logistik · GRN-2610-0233',
    description: 'Penerimaan BHP bedah dari pemasok PBF-022',
    lines: [debit(AKUN.persediaan, 18_750_000n), credit(AKUN.utangUsaha, 18_750_000n)],
  }),
  buildJournal({
    id: BPJS_TRANSFER_JOURNAL_ID,
    seq: 413,
    date: at(TODAY, '10.26'),
    source: 'klaim',
    reference: 'Klaim · transfer BPJS batch Agustus 2026',
    description: `Pembayaran klaim BPJS ke ${REKENING.penampungan}; diposting setelah dipadankan ke batch klaim`,
    status: 'menunggu-rekonsiliasi',
    lines: [
      debit(AKUN.bankKlaim, 1_820_000_000n),
      credit(AKUN.piutangBpjsRi, 1_284_600_000n),
      credit(AKUN.piutangBpjsRj, 535_400_000n),
    ],
  }),
  buildJournal({
    id: DISPUTE_JOURNAL_ID,
    seq: 417,
    date: at(TODAY, '10.30'),
    source: 'klaim',
    reference: 'Klaim · dispute verifikator',
    description: 'Penurunan nilai piutang klaim dispute Tn. Hendro Gunawan (pneumonia, ICU)',
    status: 'perlu-pemetaan',
    lines: [debit(AKUN.bebanCkpn, HENDRO_TARIFF), credit(null, HENDRO_TARIFF)],
  }),
];

/** Jumlah jurnal otomatis periode berjalan (tabel menampilkan contoh terbaru). */
export const JOURNAL_COUNT = 2416;

export const MAPPING_OPTIONS: AccountingBoard['mappingOptions'] = [
  AKUN.ckpn,
  { code: '1-1320', name: 'Piutang BPJS — RI (pengurang langsung)' },
  { code: '4-1210', name: 'Pendapatan RI — JKN (koreksi)' },
];

const JUTA = 1_000_000n;
/** Saldo piutang per kelompok umur (Rp juta × porsi) — total BPJS sama dengan KPI piutang BPJS. */
export const AGING: AccountingBoard['aging'] = [
  {
    payer: 'bpjs',
    label: 'BPJS Kesehatan',
    buckets: ['12418960000', '5781240000', '2355320000', '856480000'],
  },
  {
    payer: 'asuransi',
    label: 'Asuransi swasta (12 penjamin)',
    buckets: ['1702800000', '1161000000', '619200000', '387000000'],
  },
  {
    payer: 'kerja-sama',
    label: 'Perusahaan kerja sama',
    buckets: ['421400000', '301000000', '240800000', '240800000'],
  },
  { payer: 'umum', label: 'Pasien umum', buckets: ['239320000', '69480000', '30880000', '46320000'] },
];

export const BANK_RECON: AccountingBoard['bankRecon'] = [
  {
    id: 'btn-ops',
    label: 'BTN operasional (VA/QRIS via TPDI)',
    account: REKENING.operasional,
    mutations: 412,
    unmatched: [],
    syncedAt: at(TODAY, '10.30'),
    note: 'Mutasi H2H dicocokkan 3 arah dengan transaksi kasir dan laporan TPDI',
  },
  {
    id: 'btn-klaim',
    label: 'BTN penampungan klaim BPJS',
    account: REKENING.penampungan,
    mutations: 18,
    unmatched: [
      {
        id: 'mt-9021-1',
        date: at(TODAY, '09.02'),
        description: 'Transfer BPJS · batch klaim RI Agustus 2026',
        amount: (1_284_600n * 1_000n).toString(),
      },
      {
        id: 'mt-9021-2',
        date: at(TODAY, '09.02'),
        description: 'Transfer BPJS · batch klaim RJ Agustus 2026',
        amount: (535_400n * 1_000n).toString(),
      },
    ],
    syncedAt: at(TODAY, '10.30'),
    note: 'Transfer BPJS belum dipadankan ke batch klaim',
  },
  {
    id: 'bank-mitra',
    label: 'Bank mitra · penggajian dan pemasok',
    account: '••••7730',
    mutations: 96,
    unmatched: [],
    syncedAt: at(TODAY, '10.30'),
    note: 'Mutasi penggajian dan pembayaran pemasok cocok dengan jadwal bayar',
  },
];

export const ACCOUNTING_KPIS: AccountingBoard['kpis'] = {
  revenueMtd: (7_820n * JUTA).toString(),
  revenueDeltaPercent: 6.1,
  bpjsReceivable: (21_412n * JUTA).toString(),
  avgCollectionDays: 34,
  cashAndBank: (9_150n * JUTA).toString(),
  cashDays: 41,
  payablesDue7d: (2_260n * JUTA).toString(),
  suppliersDue: 14,
};

export const PERIODS: Pick<AccountingBoard, 'period' | 'previousPeriod'> = {
  period: { id: '2026-10', label: 'Oktober 2026', status: 'terbuka', closedAt: null },
  previousPeriod: {
    id: '2026-09',
    label: 'September 2026',
    status: 'tertutup',
    closedAt: at('2026-10-02', '16.40'),
  },
};
