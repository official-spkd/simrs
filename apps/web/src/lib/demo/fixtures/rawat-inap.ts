import type { EdBoard, EdTrackingItem, TriageLevel } from '@simrs/shared';
import { encounterIdOf, patientById } from './pasien';
import { DOKTER, STAF } from './staf';
import { DEMO_NOW } from './waktu';

/**
 * Data dummy IGD, tempat tidur, rawat inap, resume, dan persetujuan tindakan (mockup IGD, BedManagement, Ranap,
 * Resume, Consent; ADR-0023). Semua pasien dari `PASIEN`, dokter dari `DOKTER`, ruang dari `BANGSAL`. Pasien
 * skenario (Tn. Hartono, Ny. Ratna) diproyeksikan dari mesin skenario di `lib/rawat-inap-scenario.ts`.
 */

/** Instan ISO WIB (`+07:00`) `minutes` menit sebelum `iso`. */
export function minutesBefore(iso: string, minutes: number): string {
  return wib(new Date(new Date(iso).getTime() - minutes * 60_000));
}

/** Format ISO 8601 dengan offset WIB. */
export function wib(d: Date): string {
  return `${new Date(d.getTime() + 7 * 3_600_000).toISOString().slice(0, 19)}+07:00`;
}

/** Instan WIB dari tanggal `YYYY-MM-DD` dan jam `HH.MM`. */
export function at(date: string, hm: string): string {
  return `${date}T${hm.replace('.', ':')}:00+07:00`;
}

function doctorName(id: string): string {
  const d = DOKTER.find((x) => x.id === id);
  if (!d) throw new Error(`Dokter ${id} tidak ada di fixture`);
  return d.nama;
}

function patient(id: string) {
  const p = patientById(id);
  if (!p) throw new Error(`Pasien ${id} tidak ada di fixture`);
  return p;
}

// ---------------------------------------------------------------------------------------------------------
// K03 · IGD
// ---------------------------------------------------------------------------------------------------------

type Vital = [label: string, value: string, abnormal?: boolean];
type Order = [label: string, on: boolean];

interface EdSeed {
  bed: string;
  patientId: string | null;
  level: TriageLevel;
  suggested?: TriageLevel;
  complaint: string;
  doctor: string | null;
  los: number;
  status: EdTrackingItem['status'];
  mode: string;
  vitals: Vital[];
  rec: string;
  orderTitle: string;
  orders: Order[];
}

const ED_SEED: EdSeed[] = [
  {
    bed: 'R1',
    patientId: null,
    level: 1,
    complaint: 'Penurunan kesadaran pasca kecelakaan, GCS 8',
    doctor: `${STAF.dokterJagaIgd} + tim trauma`,
    los: 22,
    status: 'resusitasi',
    mode: 'ambulans 119',
    vitals: [
      ['TD', '90/60', true],
      ['Nadi', '124', true],
      ['Napas', '8', true],
      ['SpO2', '91%', true],
      ['Suhu', '36,2'],
      ['GCS', '8', true],
    ],
    rec: 'Penurunan kesadaran pasca trauma: triase 1, amankan jalan napas, aktifkan tim trauma, CT kepala segera setelah stabil.',
    orderTitle: 'Order awal otomatis (alur trauma)',
    orders: [
      ['CT kepala tanpa kontras', true],
      ['Darah lengkap, golongan darah, crossmatch', true],
      ['Konsul bedah saraf jaga', false],
    ],
  },
  {
    bed: 'B3',
    patientId: 'ps-lestiani',
    level: 2,
    complaint: 'Lemah anggota gerak kanan dan bicara pelo sejak 1 jam',
    doctor: doctorName('dr-yudha'),
    los: 35,
    status: 'pemeriksaan',
    mode: 'diantar keluarga',
    vitals: [
      ['TD', '186/104', true],
      ['Nadi', '92'],
      ['Napas', '20'],
      ['SpO2', '97%'],
      ['Suhu', '36,7'],
      ['GCS', '14', true],
    ],
    rec: 'Defisit neurologis akut < 4,5 jam: triase 2, aktifkan kode stroke, CT kepala ≤ 25 menit, cek gula darah.',
    orderTitle: 'Order awal otomatis (alur kode stroke)',
    orders: [
      ['CT kepala tanpa kontras', true],
      ['Gula darah, darah lengkap, PT/APTT', true],
      ['Konsul neurologi (kode stroke)', true],
    ],
  },
  {
    bed: 'B4',
    patientId: 'ps-nadia',
    level: 3,
    complaint: 'Demam 3 hari, muntah, minum sedikit',
    doctor: doctorName('dr-nadia'),
    los: 55,
    status: 'observasi',
    mode: 'diantar orang tua',
    vitals: [
      ['Suhu', '38,9', true],
      ['Nadi', '132', true],
      ['Napas', '28'],
      ['SpO2', '98%'],
      ['TD', '90/60'],
      ['GCS', '15'],
    ],
    rec: 'Demam pada anak dengan muntah: triase 3, nilai derajat dehidrasi, ulang tanda vital tiap 30 menit.',
    orderTitle: 'Order awal (alur demam anak)',
    orders: [
      ['Darah lengkap, hematokrit', true],
      ['Rehidrasi oral terpantau', true],
      ['Konsul dokter anak', false],
    ],
  },
  {
    bed: 'B5',
    patientId: 'ps-fajar',
    level: 3,
    complaint: 'Nyeri perut kanan atas hilang timbul, muntah',
    doctor: doctorName('dr-yohanes'),
    los: 280,
    status: 'tunggu-bed',
    mode: 'datang sendiri',
    vitals: [
      ['TD', '132/84'],
      ['Nadi', '96'],
      ['Napas', '20'],
      ['SpO2', '98%'],
      ['Suhu', '37,9'],
      ['GCS', '15'],
    ],
    rec: 'Nyeri perut dengan tanda vital stabil: triase 3, analgesik, USG abdomen, konsul bedah.',
    orderTitle: 'Order awal (alur nyeri perut)',
    orders: [
      ['USG abdomen', true],
      ['Darah lengkap, fungsi hati, lipase', true],
      ['Konsul bedah', true],
    ],
  },
  {
    bed: 'B6',
    patientId: 'ps-darmawan',
    level: 4,
    complaint: 'Nyeri dan bengkak sendi lutut kanan sejak semalam',
    doctor: STAF.dokterJagaIgd,
    los: 40,
    status: 'pemeriksaan',
    mode: 'datang sendiri',
    vitals: [
      ['TD', '138/88'],
      ['Nadi', '88'],
      ['Napas', '18'],
      ['SpO2', '99%'],
      ['Suhu', '37,6'],
      ['GCS', '15'],
    ],
    rec: 'Nyeri sendi tanpa tanda bahaya: triase 4. Alergi ibuprofen tercatat: hindari OAINS.',
    orderTitle: 'Order awal (alur nyeri sendi)',
    orders: [
      ['Asam urat, darah lengkap', true],
      ['Analgesik non-OAINS', true],
      ['Foto lutut kanan', false],
    ],
  },
  {
    bed: 'B7',
    patientId: 'ps-dewi',
    level: 4,
    complaint: 'Nyeri ulu hati dan mual sejak pagi',
    doctor: null,
    los: 31,
    status: 'tunggu-dokter',
    mode: 'datang sendiri',
    vitals: [
      ['TD', '124/80'],
      ['Nadi', '84'],
      ['Napas', '18'],
      ['SpO2', '99%'],
      ['Suhu', '36,8'],
      ['GCS', '15'],
    ],
    rec: 'Nyeri epigastrium tanpa tanda bahaya: triase 4; EKG untuk menyingkirkan sindrom koroner.',
    orderTitle: 'Order awal (alur nyeri epigastrium)',
    orders: [
      ['EKG 12 sadapan', true],
      ['Darah lengkap', false],
      ['PPI sesuai order dokter', false],
    ],
  },
  {
    bed: 'B8',
    patientId: 'ps-bonifasius',
    level: 3,
    complaint: 'Sesak saat aktivitas, kaki bengkak 3 hari',
    doctor: STAF.dokterJagaIgd,
    los: 135,
    status: 'tunggu-lab',
    mode: 'datang sendiri',
    vitals: [
      ['TD', '150/92', true],
      ['Nadi', '104', true],
      ['Napas', '24', true],
      ['SpO2', '93%', true],
      ['Suhu', '36,9'],
      ['GCS', '15'],
    ],
    rec: 'Sesak dengan riwayat infark miokard: triase 3, foto toraks dan troponin; naikkan ke level 2 bila memburuk.',
    orderTitle: 'Order awal otomatis (alur sesak napas)',
    orders: [
      ['Foto toraks', true],
      ['Troponin I, elektrolit, kreatinin', true],
      ['Konsul jantung', false],
    ],
  },
  {
    bed: 'K1',
    patientId: 'ps-ayu',
    level: 5,
    complaint: 'Batuk pilek 5 hari, demam ringan',
    doctor: STAF.dokterJagaIgd,
    los: 70,
    status: 'siap-pulang',
    mode: 'datang sendiri',
    vitals: [
      ['TD', '118/76'],
      ['Nadi', '82'],
      ['Napas', '18'],
      ['SpO2', '98%'],
      ['Suhu', '37,4'],
      ['GCS', '15'],
    ],
    rec: 'Keluhan ringan dengan tanda vital normal: triase 5, fast track; pertimbangkan rujuk balik ke FKTP.',
    orderTitle: 'Order awal (fast track)',
    orders: [
      ['Obat simtomatik', true],
      ['Edukasi tanda bahaya', true],
      ['Surat rujuk balik FKTP', false],
    ],
  },
];

const slug = (s: string) =>
  s
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-|-$/g, '')
    .slice(0, 40);

function edItem(s: EdSeed, asOf: string): EdTrackingItem {
  const p = s.patientId ? patient(s.patientId) : null;
  return {
    encounterId: p ? encounterIdOf(p.id) : `kj-igd-${s.bed.toLowerCase()}`,
    bed: s.bed,
    zone: s.bed.charAt(0) as EdTrackingItem['zone'],
    patientId: p?.id ?? null,
    patientName: p?.nama ?? 'Tn. X (tanpa identitas)',
    rm: p?.rm ?? null,
    sex: p?.jk ?? 'L',
    ageLabel: p ? `${p.umur} th` : '±40 th',
    guarantor: p ? (p.penjamin === 'BPJS' ? `BPJS ${p.kelas ?? ''}`.trim() : p.penjamin) : 'Belum diketahui',
    triageLevel: s.level,
    suggestedLevel: s.suggested ?? s.level,
    maxLevel: 5,
    chiefComplaint: s.complaint,
    doctor: s.doctor,
    arrivedAt: minutesBefore(asOf, s.los),
    losMinutes: s.los,
    status: s.status,
    arrivalMode: s.mode,
    vitals: s.vitals.map(([label, value, abnormal]) => ({ label, value, abnormal: !!abnormal })),
    recommendation: s.rec,
    orderTitle: s.orderTitle,
    orders: s.orders.map(([label, on]) => ({ id: slug(label), label, defaultOn: on })),
    scenario: false,
  };
}

/** Papan IGD hari demo (tanpa pasien skenario; Tn. Hartono ditambahkan proyeksi skenario). */
export function demoEdBoardBase(asOf: string = DEMO_NOW): EdBoard {
  return {
    asOf,
    capacity: 20,
    ambulancesIncoming: 2,
    doctorWaitMedianMinutes: 7,
    leftWithoutBeingSeen24h: 0,
    items: ED_SEED.map((s) => edItem(s, asOf)),
  };
}
