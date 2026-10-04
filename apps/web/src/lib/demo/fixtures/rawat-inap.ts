import {
  type Bed,
  type BedRequest,
  type BedStatus,
  type ClinicalResult,
  type CodedDiagnosis,
  type ConsentDocument,
  type CpptRole,
  type DischargeSummary,
  type EdBoard,
  type EdTrackingItem,
  EMAR_TIMES,
  type EmarSlot,
  type EmarTime,
  type EwsObservation,
  type InpatientDetail,
  type InpatientFlag,
  RESUME_CHECK_IDS,
  type ResumeCheckId,
  type TriageLevel,
  type Ward,
} from '@simrs/shared';
import { BOARDING_TARGET_MINUTES, ewsMaxParam, ewsScore, RESUME_CHECK_LABEL } from '../../rawat-inap';
import { BED_REQUEST_ID, CONSENT_ID, cpptNoteId, DOCTOR_ID, ENCOUNTER_ID, PATIENT_ID } from './ids';
import { encounterIdOf, patientById } from './pasien';
import { BANGSAL, type DemoWard } from './rs';
import { DOKTER, PERSONA, STAF, STAF_LAIN } from './staf';
import { DEMO_NOW, DEMO_TODAY, shiftDate } from './waktu';

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
    patientId: PATIENT_ID.lestiani,
    level: 2,
    complaint: 'Lemah anggota gerak kanan dan bicara pelo sejak 1 jam',
    doctor: doctorName(DOCTOR_ID.yudha),
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
    patientId: PATIENT_ID.nadia,
    level: 3,
    complaint: 'Demam 3 hari, muntah, minum sedikit',
    doctor: doctorName(DOCTOR_ID.nadia),
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
    patientId: PATIENT_ID.sumarni,
    level: 3,
    complaint: 'Nyeri perut kanan atas hilang timbul, muntah',
    doctor: doctorName(DOCTOR_ID.yohanes),
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
    rec: 'Nyeri perut dengan tanda vital stabil: triase 3, analgesik, USG abdomen, konsul bedah. USG 07.36: kolelitiasis, kolesistektomi dijadwalkan 14.00.',
    orderTitle: 'Order awal (alur nyeri perut)',
    orders: [
      ['USG abdomen', true],
      ['Darah lengkap, fungsi hati, lipase', true],
      ['Konsul bedah', true],
    ],
  },
  {
    bed: 'B6',
    patientId: PATIENT_ID.joko,
    level: 4,
    complaint: 'Nyeri dan bengkak lutut kanan setelah terjatuh di rumah',
    doctor: STAF.dokterJagaIgd,
    los: 40,
    status: 'pemeriksaan',
    mode: 'datang sendiri',
    vitals: [
      ['TD', '138/88'],
      ['Nadi', '88'],
      ['Napas', '18'],
      ['SpO2', '99%'],
      ['Suhu', '36,9'],
      ['GCS', '15'],
    ],
    rec: 'Nyeri lutut pasca jatuh tanpa tanda bahaya: triase 4. Riwayat ORIF femur kanan Sep 2026: foto lutut dan femur.',
    orderTitle: 'Order awal (alur trauma ekstremitas)',
    orders: [
      ['Foto lutut dan femur kanan', true],
      ['Analgesik oral', true],
      ['Konsul ortopedi', false],
    ],
  },
  {
    bed: 'B7',
    patientId: PATIENT_ID.fauzi,
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
    patientId: PATIENT_ID.robert,
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
    rec: 'Sesak dengan riwayat infark miokard dan gagal jantung (pulang rawat 3 Okt): triase 3, foto toraks dan troponin; naikkan ke level 2 bila memburuk.',
    orderTitle: 'Order awal otomatis (alur sesak napas)',
    orders: [
      ['Foto toraks', true],
      ['Troponin I, elektrolit, kreatinin', true],
      ['Konsul jantung', false],
    ],
  },
  {
    bed: 'K1',
    patientId: PATIENT_ID.gilang,
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

// ---------------------------------------------------------------------------------------------------------
// K05 · Tempat tidur. Jumlah bed dan bed terisi per ruang sama persis dengan `BANGSAL` (selaras Dasbor).
// ---------------------------------------------------------------------------------------------------------

/** Kode bed per ruang: `VIP 3`, `A-07`, `M-210`, `W-308`, `K-412`, `ICU 3`, `HCU 2`, `I-03`. */
const BED_CODE: Record<string, (n: number) => string> = {
  VIP: (n) => `VIP ${n}`,
  ANGGREK: (n) => `A-${String(n).padStart(2, '0')}`,
  MELATI: (n) => `M-${200 + n}`,
  MAWAR: (n) => `W-${300 + n}`,
  KENANGA: (n) => `K-${400 + n}`,
  ICU: (n) => `ICU ${n}`,
  HCU: (n) => `HCU ${n}`,
  ISOLASI: (n) => `I-${String(n).padStart(2, '0')}`,
};

export const WARD_SERVICE: Record<string, string> = {
  VIP: 'Campuran',
  ANGGREK: 'Bedah dan jantung',
  MELATI: 'Penyakit dalam',
  MAWAR: 'Anak dan kebidanan',
  KENANGA: 'Umum',
  ICU: 'Perawatan intensif',
  HCU: 'Perawatan intermediet',
  ISOLASI: 'Infeksi airborne',
};

/** Bed yang dipakai naskah skenario; tidak pernah ditawarkan ke permintaan lain. */
export const SCENARIO_BEDS = ['ICU 3', 'ICU 5', 'HCU 2', 'HCU 4', 'A-07', 'A-09', 'A-12', 'VIP 3', 'M-210'];

type NamedBed = Pick<Bed, 'status' | 'note'> & { patientId?: string };

/** Bed bernama: pasien rawat inap fixture dan bed naskah skenario. Sisanya dibangkitkan deterministik. */
const NAMED_BEDS: Record<string, NamedBed> = {
  'VIP 2': { status: 'terisi', note: 'H2 · naik kelas VIP · angiografi 13.00', patientId: PATIENT_ID.sutan },
  'VIP 3': { status: 'siap', note: 'siap · disiapkan untuk pasien elektif' },
  'A-07': { status: 'siap', note: 'siap · telemetri tersedia' },
  'A-09': { status: 'dibersihkan', note: 'sedang dibersihkan, siap ±30 menit' },
  'A-12': { status: 'siap', note: 'siap · telemetri tersedia' },
  'A-15': { status: 'terisi', note: 'H3 · kateter HD 13.00 (OK 1)', patientId: PATIENT_ID.yusuf },
  'M-203': { status: 'pulang', note: 'H5 · pulang hari ini · resume draf', patientId: PATIENT_ID.endang },
  'M-210': { status: 'siap', note: 'siap · kelas 2' },
  'W-308': { status: 'terisi', note: 'H2 · pantau hematokrit', patientId: PATIENT_ID.raka },
  'W-322': { status: 'terisi', note: 'H1 · pasca SC', patientId: PATIENT_ID.wulan },
  'K-412': {
    status: 'terisi',
    note: 'H4 · ORIF hari ini · di ruang pulih OK 4',
    patientId: PATIENT_ID.rizky,
  },
  'ICU 2': { status: 'terisi', note: 'H3 · ventilator', patientId: PATIENT_ID.hendro },
  'ICU 3': { status: 'siap', note: 'siap sekarang' },
  'ICU 5': { status: 'pulang', note: 'pindah ke HCU, siap ±30 menit setelah dibersihkan' },
  'ICU 7': { status: 'terisi', note: 'H2 · vasopresor', patientId: PATIENT_ID.aminah },
  'HCU 2': { status: 'siap', note: 'siap sekarang' },
  'HCU 4': { status: 'dibersihkan', note: 'sedang dibersihkan, siap ±30 menit' },
  'I-01': { status: 'terisi', note: 'TB paru · H6' },
  'I-03': { status: 'siap', note: 'siap · tekanan negatif' },
  'I-04': { status: 'dibersihkan', note: 'dekontaminasi' },
  'I-06': { status: 'rusak', note: 'perbaikan sistem tekanan negatif' },
};

const INITIALS = 'ABDEFHIJKLMNRSTWY';
function maskedLabel(ward: string, i: number): string {
  const prefix = ward === 'MAWAR' && i % 3 === 0 ? 'An.' : i % 2 ? 'Ny.' : 'Tn.';
  const a = INITIALS[(i * 7) % INITIALS.length] ?? 'A';
  const b = INITIALS[(i * 11 + 3) % INITIALS.length] ?? 'S';
  return `${prefix} ${a}. ${b}.`;
}

const FREE_CYCLE: readonly BedStatus[] = ['siap', 'dibersihkan', 'kotor', 'siap', 'dipesan', 'siap', 'rusak'];
const FREE_NOTE: Record<BedStatus, (i: number) => string> = {
  siap: () => 'siap',
  dibersihkan: (i) => `estimasi siap 11.${String(10 + (i % 40)).padStart(2, '0')}`,
  kotor: () => 'menunggu dibersihkan',
  dipesan: () => 'dipesan · admisi elektif besok',
  rusak: () => 'perbaikan bed elektrik',
  terisi: (i) => `H${1 + (i % 6)}`,
  pulang: (i) => (i % 2 ? 'resume final' : 'resume draf'),
};

/** Bed satu ruang: bed bernama dulu, lalu sisa terisi/kosong disebar merata agar total = `BANGSAL`. */
function wardBeds(w: DemoWard): Bed[] {
  const codes = Array.from({ length: w.beds }, (_, k) => BED_CODE[w.code]?.(k + 1) ?? `${w.code}-${k + 1}`);
  const named = codes.filter((c) => NAMED_BEDS[c]);
  const namedOcc = named.filter((c) => isOccupiedStatus(NAMED_BEDS[c]?.status)).length;
  const unnamed = codes.filter((c) => !NAMED_BEDS[c]);
  const free = unnamed.length - (w.occupied - namedOcc);
  const freeAt = new Set(
    Array.from({ length: Math.max(0, free) }, (_, j) => Math.floor(((j + 0.5) * unnamed.length) / free)),
  );
  let f = 0;
  return codes.map((code) => {
    const n = NAMED_BEDS[code];
    if (n) {
      const p = n.patientId ? patient(n.patientId) : null;
      const occ = isOccupiedStatus(n.status);
      return {
        code,
        wardCode: w.code,
        status: n.status,
        patientLabel: p ? p.nama : occ ? maskedLabel(w.code, codes.indexOf(code)) : null,
        encounterId: p ? encounterIdOf(p.id) : null,
        note: n.note,
      };
    }
    const u = unnamed.indexOf(code);
    if (freeAt.has(u)) {
      const status = FREE_CYCLE[f++ % FREE_CYCLE.length] ?? 'siap';
      return {
        code,
        wardCode: w.code,
        status,
        patientLabel: null,
        encounterId: null,
        note: FREE_NOTE[status](u),
      };
    }
    const status: BedStatus = u % 7 === 3 ? 'pulang' : 'terisi';
    return {
      code,
      wardCode: w.code,
      status,
      patientLabel: maskedLabel(w.code, u),
      encounterId: null,
      note: FREE_NOTE[status](u),
    };
  });
}

function isOccupiedStatus(s: BedStatus | undefined): boolean {
  return s === 'terisi' || s === 'pulang';
}

export function demoWards(): Ward[] {
  return BANGSAL.map((w) => ({
    code: w.code,
    name: w.name,
    kelas: w.kelas,
    service: WARD_SERVICE[w.code] ?? 'Umum',
    beds: w.beds,
  }));
}

export function demoBeds(): Bed[] {
  return BANGSAL.flatMap(wardBeds);
}

/** Bed siap yang cocok kelasnya (bed naskah skenario tidak ditawarkan ke permintaan lain). */
export function matchingBeds(beds: readonly Bed[], kelas: Ward['kelas'], max = 2): BedRequest['candidates'] {
  const wardOf = new Map(BANGSAL.map((w) => [w.code, w]));
  return beds
    .filter(
      (b) =>
        b.status === 'siap' && wardOf.get(b.wardCode)?.kelas === kelas && !SCENARIO_BEDS.includes(b.code),
    )
    .slice(0, max)
    .map((b) => ({
      bedCode: b.code,
      label: `${wardOf.get(b.wardCode)?.name ?? b.wardCode} ${b.code}`,
      note: b.note,
    }));
}

/** Permintaan bed hari demo (selain pasien skenario). */
export function demoBedRequests(beds: readonly Bed[]): BedRequest[] {
  const req = (
    id: string,
    patientId: string,
    from: string,
    need: string,
    kelas: Ward['kelas'],
    waitMinutes: number | null,
  ): BedRequest => {
    const p = patient(patientId);
    return {
      id,
      patientName: p.nama,
      sex: p.jk,
      ageYears: p.umur,
      rm: p.rm,
      from,
      need,
      kelas,
      waitMinutes,
      late: waitMinutes !== null && waitMinutes >= BOARDING_TARGET_MINUTES,
      candidates: matchingBeds(beds, kelas),
      scenario: null,
    };
  };
  return [
    req(BED_REQUEST_ID.sumarni, PATIENT_ID.sumarni, 'IGD B5', 'Bedah · kelas 1 · Umum', 'Kelas 1', 280),
    req(
      BED_REQUEST_ID.robert,
      PATIENT_ID.robert,
      'IGD B8',
      'Jantung · kelas 1 · BPJS · telemetri',
      'Kelas 1',
      135,
    ),
    req(
      BED_REQUEST_ID.lestiani,
      PATIENT_ID.lestiani,
      'IGD B3',
      'Saraf · kelas 3 · BPJS · pantau stroke',
      'Kelas 3',
      35,
    ),
    req(
      BED_REQUEST_ID.fajar,
      PATIENT_ID.fajar,
      'Ruang pulih OK 2',
      'Bedah · kelas 1 · Asuransi · pasca operasi',
      'Kelas 1',
      80,
    ),
    req(
      BED_REQUEST_ID.maria,
      PATIENT_ID.maria,
      'Poli PD · kemoterapi 13.00',
      'Penyakit dalam · kelas 2 · BPJS',
      'Kelas 2',
      null,
    ),
  ];
}

// ---------------------------------------------------------------------------------------------------------
// K04/K07/K12 · Pasien rawat inap: CPPT, eMAR, observasi + EWS, hasil, asuhan keperawatan
// ---------------------------------------------------------------------------------------------------------

export type DxSeed = [system: CodedDiagnosis['system'], code: string, label: string, primary?: boolean];
/** Slot eMAR ringkas: '' kosong · 'r' rencana · 'j' jadwal · 'g:08.05' diberikan · 't:…' terlambat · 'd:…' ditunda. */
export type MedSeed = [name: string, sig: string, kfa: string | null, highAlert: boolean, slots: string[]];
export interface NoteSeed {
  id: string;
  role: CpptRole;
  author: string;
  /** Instan ISO WIB. */
  at: string;
  s?: string;
  o?: string;
  a: string;
  p?: string;
  /** Co-sign DPJP: [nama, instan]. */
  cosign?: [string, string];
  /** Koreksi: [id entri lama, versi baru, alasan]. */
  corrects?: [string, number, string];
}
export type ObsSeed = [
  at: string,
  temp: number,
  hr: number,
  rr: number,
  sbp: number,
  dbp: number,
  spo2: number,
  onOxygen: boolean,
  avpu: EwsObservation['consciousness'],
];
export type ResultSeed = [at: string, name: string, value: string, flag: ClinicalResult['flag']];
export type NursingSeed = [diagnosis: string, items: Array<[label: string, done: boolean]>];

export interface InpatientSeed {
  patientId: string;
  wardCode: string;
  bed: string;
  dpjp: string;
  admittedOn: string;
  flags: InpatientFlag[];
  risk: string;
  plan: string;
  dx: DxSeed[];
  emarNow: EmarTime;
  emarNote: string;
  meds: MedSeed[];
  notes: NoteSeed[];
  obs: ObsSeed[];
  results: ResultSeed[];
  nursing: NursingSeed[];
}

function slot(time: EmarTime, code: string): EmarSlot {
  if (!code) return { time, state: 'kosong', label: '' };
  if (code === 'r') return { time, state: 'rencana', label: 'Rencana' };
  if (code === 'j') return { time, state: 'jadwal', label: 'Sekarang' };
  const [k, label = ''] = [code.slice(0, 1), code.slice(2)];
  const state: EmarSlot['state'] = k === 'g' ? 'diberikan' : k === 't' ? 'terlambat' : 'ditunda';
  return { time, state, label };
}

/** Hari rawat ke-n per hari demo (hari masuk = 1). */
export function hospitalDay(admittedOn: string, today: string = DEMO_TODAY): number {
  return Math.round((Date.parse(today) - Date.parse(admittedOn)) / 86_400_000) + 1;
}

export function buildInpatient(
  seed: InpatientSeed,
  extra?: { scenario?: boolean; day?: number },
): InpatientDetail {
  const enc = encounterIdOf(seed.patientId);
  const observations = seed.obs.map(([atIso, temp, hr, rr, sbp, dbp, spo2, onOxygen, consciousness]) => {
    const o = { temp, hr, rr, sbp, dbp, spo2, onOxygen, consciousness };
    return { at: atIso, ...o, score: ewsScore(o) };
  });
  const lastObs = observations.at(-1);
  return {
    summary: {
      encounterId: enc,
      patientId: seed.patientId,
      wardCode: seed.wardCode,
      bed: seed.bed,
      dpjp: seed.dpjp,
      diagnoses: seed.dx.map(([system, code, label, primary]) => ({
        system,
        code,
        label,
        primary: !!primary,
      })),
      admittedOn: seed.admittedOn,
      day: extra?.day ?? hospitalDay(seed.admittedOn),
      lastEws: lastObs?.score ?? 0,
      lastEwsMaxParam: lastObs ? ewsMaxParam(lastObs) : 0,
      flags: seed.flags,
      risk: seed.risk,
      scenario: !!extra?.scenario,
    },
    plan: seed.plan,
    cppt: seed.notes.map((n) => ({
      id: n.id,
      encounterId: enc,
      role: n.role,
      author: n.author,
      writtenAt: n.at,
      s: n.s ?? '',
      o: n.o ?? '',
      a: n.a,
      p: n.p ?? '',
      version: n.corrects?.[1] ?? 1,
      supersedesId: n.corrects?.[0] ?? null,
      correctionReason: n.corrects?.[2] ?? null,
      addendumOf: null,
      cosignRequired: n.role === 'residen',
      cosignedBy: n.cosign?.[0] ?? null,
      cosignedAt: n.cosign?.[1] ?? null,
    })),
    medications: seed.meds.map(([name, sig, kfa, highAlert, slots], i) => ({
      id: `${enc}-obat-${i + 1}`,
      name,
      sig,
      kfa,
      highAlert,
      slots: EMAR_TIMES.map((t, k) => slot(t, slots[k] ?? '')),
    })),
    emarNow: seed.emarNow,
    emarNote: seed.emarNote,
    observations,
    results: seed.results.map(([atIso, name, value, flag]) => ({ at: atIso, name, value, flag })),
    nursing: seed.nursing.map(([diagnosis, items], i) => ({
      diagnosis,
      interventions: items.map(([label, done], k) => ({ id: `ask-${i}-${k}`, label, done })),
    })),
  };
}

const T = (hm: string, dayOffset = 0) => at(shiftDate(DEMO_TODAY, dayOffset), hm);
const DIETISIEN = 'Nurul Aini, S.Gz';

/** Ny. Endang Wijaya · Melati M-203 (mockup Ranap): pneumonia + DM, hari ke-5, pulang hari ini (roster hari demo). */
const ENDANG: InpatientSeed = {
  patientId: PATIENT_ID.endang,
  wardCode: 'MELATI',
  bed: 'M-203',
  dpjp: STAF.dpjpPenyakitDalam,
  admittedOn: shiftDate(DEMO_TODAY, -4),
  flags: ['cosign', 'emar-terlambat', 'risiko-jatuh', 'rencana-pulang'],
  risk: 'Risiko jatuh sedang · Morse 35',
  plan: 'Seftriakson H5 dosis terakhir pagi ini, lanjut sefiksim oral di rumah; glargine 16 unit malam; pulang hari ini setelah resume ditandatangani DPJP.',
  dx: [
    ['ICD-10', 'J18.9', 'Pneumonia, tidak spesifik', true],
    ['ICD-10', 'E11.9', 'DM tipe 2 tanpa komplikasi'],
  ],
  emarNow: '12.00',
  emarNote:
    'Pindai gelang pasien, lalu label obat. GDS 10.30: 236 mg/dL → skala 6 unit SC sebelum makan siang.',
  meds: [
    ['Seftriakson 2 g', 'IV · 1×24 jam · H5 (terakhir)', null, false, ['', 'g:08.05', '', '', '']],
    [
      'Insulin aspart sesuai skala',
      'SC · sebelum makan · cek GDS',
      null,
      true,
      ['g:06.10 · 4 unit', '', 'j', 'r', ''],
    ],
    ['Insulin glargine 16 unit', 'SC · 1×/hari 22.00 · dosis baru', null, true, ['', '', '', '', 'r']],
    ['Metformin 500 mg', 'PO · 2×1 · sesudah makan', null, false, ['', 'd:Ditunda · mual', '', 'r', '']],
    ['N-asetilsistein 200 mg', 'PO · 3×1 (06, 14, 22)', null, false, ['g:06.00', '', '', '', 'r']],
    ['Parasetamol 1 g', 'IV · bila suhu ≥ 38,5 °C', null, false, ['', '', '', '', '']],
    ['Omeprazol 40 mg injeksi', 'IV · 1×24 jam pagi', '93001152', false, ['', 't:Terlambat', '', '', '']],
  ],
  notes: [
    {
      id: cpptNoteId(ENCOUNTER_ID.endang, 1),
      role: 'residen',
      author: PERSONA.dokterResiden,
      at: T('07.40'),
      s: 'Batuk berkurang, sesak tidak ada.',
      o: 'T 37,4 · RR 20 · SpO2 96% udara bebas. Ronki basah kanan berkurang.',
      a: 'Pneumonia komunitas perbaikan; DM hiperglikemia.',
      p: 'Lanjut seftriakson H5, naikkan glargine 14 → 16 unit.',
    },
    {
      id: cpptNoteId(ENCOUNTER_ID.endang, 2),
      role: 'farmasi',
      author: STAF_LAIN.apoteker[0],
      at: T('08.15'),
      o: 'Riwayat alergi amoksisilin (ruam ringan); seftriakson ditoleransi sejak H1 tanpa reaksi.',
      a: 'Rencana antibiotik H5 sesuai pedoman; tidak ada interaksi bermakna.',
      p: 'Usul evaluasi de-eskalasi ke oral H6.',
    },
    {
      id: cpptNoteId(ENCOUNTER_ID.endang, 3),
      role: 'gizi',
      author: DIETISIEN,
      at: T('09.00'),
      s: 'Asupan sekitar 70% kebutuhan.',
      o: 'BB 64 kg, GDS pagi 188 mg/dL.',
      a: 'Asupan kurang dari kebutuhan; risiko hiperglikemia.',
      p: 'Diet DM 1.700 kkal dibagi 3 makan + 2 selingan.',
    },
    {
      id: cpptNoteId(ENCOUNTER_ID.endang, 4),
      role: 'perawat',
      author: PERSONA.perawat,
      at: T('06.00'),
      s: 'Malam tidur cukup.',
      o: 'Infus lancar, tidak ada tanda flebitis.',
      a: 'Risiko jatuh sedang (Morse 35).',
      p: 'Edukasi pencegahan jatuh diulang ke keluarga.',
    },
    {
      id: cpptNoteId(ENCOUNTER_ID.endang, 5),
      role: 'perawat',
      author: STAF_LAIN.perawat[0],
      at: T('22.10', -1),
      o: 'SpO2 69% udara bebas, RR 20.',
      a: 'Bersihan jalan napas tidak efektif.',
      p: 'Posisi semi-Fowler, pantau SpO2 tiap 4 jam.',
    },
    {
      id: cpptNoteId(ENCOUNTER_ID.endang, 6),
      role: 'perawat',
      author: STAF_LAIN.perawat[0],
      at: T('22.25', -1),
      o: 'SpO2 96% udara bebas, RR 20.',
      a: 'Bersihan jalan napas tidak efektif.',
      p: 'Posisi semi-Fowler, pantau SpO2 tiap 4 jam.',
      corrects: [cpptNoteId(ENCOUNTER_ID.endang, 5), 2, 'Salah ketik nilai SpO2 (seharusnya 96%, bukan 69%)'],
    },
    {
      id: cpptNoteId(ENCOUNTER_ID.endang, 0),
      role: 'residen',
      author: PERSONA.dokterResiden,
      at: T('07.30', -1),
      s: 'Demam turun, batuk berdahak.',
      o: 'T 37,8 · SpO2 95% udara bebas.',
      a: 'Pneumonia komunitas, perbaikan klinis.',
      p: 'Lanjut terapi, cek GDS 4×/hari.',
      cosign: [STAF.dpjpPenyakitDalam, T('09.20', -1)],
    },
  ],
  obs: [
    [T('06.00'), 37.6, 92, 22, 128, 80, 95, false, 'A'],
    [T('07.40'), 37.4, 88, 20, 126, 78, 96, false, 'A'],
    [T('10.40'), 37.3, 86, 20, 124, 78, 96, false, 'A'],
  ],
  results: [
    [T('10.30'), 'Gula darah sewaktu', '236 mg/dL', 'tinggi'],
    [T('06.00'), 'Gula darah sewaktu', '188 mg/dL', 'tinggi'],
    [T('06.00'), 'Leukosit', '8.900 /µL (masuk 16.200)', 'normal'],
    [T('06.00'), 'CRP', '24 mg/L', 'tinggi'],
    [T('06.00', -1), 'Gula darah sewaktu', '254 mg/dL', 'tinggi'],
  ],
  nursing: [
    [
      'Risiko jatuh (Morse 35)',
      [
        ['Gelang kuning risiko jatuh terpasang', true],
        ['Pagar tempat tidur terpasang, roda terkunci', true],
        ['Bel pasien dalam jangkauan', false],
        ['Edukasi pencegahan jatuh ke keluarga', true],
      ],
    ],
    [
      'Ketidakstabilan kadar glukosa darah',
      [
        ['Cek GDS sebelum makan', true],
        ['Edukasi tanda hipoglikemia', false],
        ['Koordinasi diet DM 1.700 kkal dengan gizi', true],
      ],
    ],
    [
      'Bersihan jalan napas tidak efektif',
      [
        ['Latih batuk efektif', false],
        ['Posisi semi-Fowler', true],
        ['Pantau SpO2 tiap 4 jam', true],
      ],
    ],
  ],
};

const ICU_SEEDS: InpatientSeed[] = [
  {
    patientId: PATIENT_ID.hendro,
    wardCode: 'ICU',
    bed: 'ICU 2',
    dpjp: doctorName(DOCTOR_ID.kartika),
    admittedOn: shiftDate(DEMO_TODAY, -2),
    flags: ['cosign'],
    risk: 'Risiko dekubitus tinggi · Braden 12',
    plan: 'Ventilator mode PSIMV, rencana uji napas spontan besok; antibiotik empiris H3; ubah posisi tiap 2 jam.',
    dx: [
      ['ICD-10', 'J96.0', 'Gagal napas akut', true],
      ['ICD-10', 'J18.9', 'Pneumonia, tidak spesifik'],
      ['ICD-9-CM', '96.71', 'Ventilasi mekanik < 96 jam'],
    ],
    emarNow: '12.00',
    emarNote: 'Pindai gelang pasien sebelum setiap pemberian; titrasi sedasi sesuai target RASS −2.',
    meds: [
      ['Meropenem 1 g', 'IV · 3×1 (06, 14, 22) · H3', null, false, ['g:06.05', '', '', '', 'r']],
      [
        'Midazolam 2 mg/jam',
        'IV kontinu · titrasi RASS −2',
        null,
        true,
        ['g:06.00', 'g:08.00', 'j', 'r', 'r'],
      ],
      ['Omeprazol 40 mg injeksi', 'IV · 1×24 jam pagi', '93001152', false, ['', 'g:08.10', '', '', '']],
      ['Enoksaparin 60 mg/0,6 mL', 'SC · 1×24 jam sore', '93002210', true, ['', '', '', 'r', '']],
      ['Parasetamol 1 g', 'IV · bila suhu ≥ 38,5 °C', null, false, ['', '', '', '', '']],
    ],
    notes: [
      {
        id: cpptNoteId(ENCOUNTER_ID.hendro, 1),
        role: 'residen',
        author: PERSONA.dokterResiden,
        at: T('07.10'),
        s: 'Tersedasi, RASS −2.',
        o: 'FiO2 40%, PEEP 6, SpO2 95%. AGD pH 7,38 · PaO2 88 mmHg.',
        a: 'Gagal napas akut perbaikan.',
        p: 'Turunkan FiO2 ke 35%, uji napas spontan besok pagi.',
      },
      {
        id: cpptNoteId(ENCOUNTER_ID.hendro, 2),
        role: 'perawat',
        author: STAF_LAIN.perawat[1],
        at: T('06.00'),
        o: 'Sekret kental kekuningan, suction 3× malam ini.',
        a: 'Pola napas tidak efektif.',
        p: 'Lanjut suction sesuai kebutuhan, oral hygiene tiap 6 jam.',
      },
      {
        id: cpptNoteId(ENCOUNTER_ID.hendro, 0),
        role: 'dpjp',
        author: doctorName(DOCTOR_ID.kartika),
        at: T('08.30', -1),
        s: 'Keluarga menanyakan rencana lepas ventilator.',
        o: 'Foto toraks: infiltrat bilateral berkurang.',
        a: 'Pneumonia berat dengan gagal napas, membaik.',
        p: 'Lanjut meropenem, edukasi keluarga tentang rencana weaning.',
      },
    ],
    obs: [
      [T('06.00'), 37.9, 104, 18, 112, 68, 95, true, 'V'],
      [T('10.00'), 37.6, 98, 16, 118, 70, 96, true, 'V'],
    ],
    results: [
      [T('06.30'), 'Analisis gas darah', 'pH 7,38 · PaO2 88 · PaCO2 42', 'normal'],
      [T('06.00'), 'Leukosit', '15.800 /µL', 'tinggi'],
    ],
    nursing: [
      [
        'Pola napas tidak efektif',
        [
          ['Suction sesuai kebutuhan', true],
          ['Posisi kepala 30–45°', true],
          ['Oral hygiene klorheksidin', false],
        ],
      ],
    ],
  },
  {
    patientId: PATIENT_ID.aminah,
    wardCode: 'ICU',
    bed: 'ICU 7',
    dpjp: doctorName(DOCTOR_ID.rahmat),
    admittedOn: shiftDate(DEMO_TODAY, -1),
    flags: [],
    risk: 'Alergi kotrimoksazol · risiko dekubitus sedang',
    plan: 'Norepinefrin titrasi MAP ≥ 65 mmHg, antibiotik sesuai kultur, balans cairan ketat, laktat ulang 6 jam.',
    dx: [
      ['ICD-10', 'A41.9', 'Sepsis, tidak spesifik', true],
      ['ICD-10', 'R57.2', 'Syok septik'],
      ['ICD-9-CM', '00.17', 'Infus agen vasopresor'],
      ['ICD-9-CM', '38.93', 'Pemasangan kateter vena sentral'],
    ],
    emarNow: '12.00',
    emarNote: 'Obat vasoaktif lewat kateter vena sentral; konfirmasi kecepatan pompa setiap pergantian.',
    meds: [
      [
        'Norepinefrin 0,1 µg/kg/menit',
        'IV kontinu · titrasi MAP ≥ 65',
        null,
        true,
        ['g:06.00', 'g:08.00', 'j', 'r', 'r'],
      ],
      ['Meropenem 1 g', 'IV · 3×1 (06, 14, 22)', null, false, ['g:06.00', '', '', '', 'r']],
      [
        'Vankomisin 1 g',
        'IV · 2×1 · kadar lembah sebelum dosis 4',
        null,
        false,
        ['', 'g:08.00', '', 'r', ''],
      ],
      ['Omeprazol 40 mg injeksi', 'IV · 1×24 jam pagi', '93001152', false, ['', 'g:08.15', '', '', '']],
    ],
    notes: [
      {
        id: cpptNoteId(ENCOUNTER_ID.aminah, 1),
        role: 'dpjp',
        author: doctorName(DOCTOR_ID.rahmat),
        at: T('08.00'),
        s: 'Pasien mengeluh lemas, tidak sesak.',
        o: 'MAP 72 dengan norepinefrin 0,1 µg/kg/menit. Laktat 3,8 → ulang siang.',
        a: 'Syok septik sumber infeksi saluran kemih, respons awal baik.',
        p: 'Pertahankan MAP ≥ 65, tunggu kultur urin dan darah, hindari golongan sulfa (alergi).',
      },
      {
        id: cpptNoteId(ENCOUNTER_ID.aminah, 2),
        role: 'perawat',
        author: STAF_LAIN.perawat[2],
        at: T('06.00'),
        o: 'Urin 0,6 mL/kg/jam, balans +900 mL.',
        a: 'Risiko syok.',
        p: 'Catat urin per jam, lapor bila < 0,5 mL/kg/jam.',
      },
    ],
    obs: [
      [T('06.00'), 38.4, 112, 24, 96, 58, 93, true, 'A'],
      [T('10.00'), 38.0, 104, 22, 104, 62, 94, true, 'A'],
    ],
    results: [
      [T('06.00'), 'Laktat', '3,8 mmol/L', 'tinggi'],
      [T('06.00'), 'Kreatinin', '1,9 mg/dL', 'tinggi'],
    ],
    nursing: [
      [
        'Risiko syok',
        [
          ['Pantau MAP tiap 15 menit saat titrasi', true],
          ['Catat urin per jam', true],
          ['Cek kultur darah 2 set sebelum antibiotik', true],
        ],
      ],
    ],
  },
];

const WARD_SEEDS: InpatientSeed[] = [
  {
    patientId: PATIENT_ID.yusuf,
    wardCode: 'ANGGREK',
    bed: 'A-15',
    dpjp: doctorName(DOCTOR_ID.sinta),
    admittedOn: shiftDate(DEMO_TODAY, -2),
    flags: [],
    risk: 'AV shunt lengan kiri: jangan ukur TD atau infus di lengan kiri',
    plan: 'Thrill AV shunt melemah: kateter HD sementara di OK 1 pukul 13.00, HD berikutnya lewat kateter; batasi cairan 600 mL/hari; koreksi anemia dengan eritropoietin.',
    dx: [
      ['ICD-10', 'N18.5', 'Penyakit ginjal kronik stadium 5', true],
      ['ICD-10', 'Z99.2', 'Ketergantungan dialisis'],
      ['ICD-9-CM', '39.95', 'Hemodialisis'],
    ],
    emarNow: '12.00',
    emarNote: 'Dosis obat disesuaikan fungsi ginjal (CDS dosis ginjal aktif).',
    meds: [
      ['Asam folat 1 mg', 'PO · 1×1 pagi', null, false, ['', 'g:08.00', '', '', '']],
      ['Kalsium karbonat 500 mg', 'PO · 3×1 bersama makan', null, false, ['', 'g:08.00', 'j', 'r', '']],
      ['Amlodipin 10 mg', 'PO · 1×1 pagi', null, false, ['', 'g:08.00', '', '', '']],
      ['Eritropoietin 3.000 IU', 'SC · 2×/minggu (Sen, Kam)', null, false, ['', '', '', 'r', '']],
    ],
    notes: [
      {
        id: cpptNoteId(ENCOUNTER_ID.yusuf, 1),
        role: 'dpjp',
        author: doctorName(DOCTOR_ID.sinta),
        at: T('08.30'),
        s: 'Sesak berkurang setelah HD kemarin.',
        o: 'BB turun 2,1 kg pasca HD. Ureum 168 · K 5,4 · Hb 8,9. Thrill AV shunt lengan kiri melemah.',
        a: 'CKD stadium 5 on HD, kelebihan cairan teratasi sebagian; curiga trombosis AV shunt.',
        p: 'Kateter HD sementara di OK 1 pukul 13.00 (konsul bedah), restriksi cairan, mulai eritropoietin.',
      },
      {
        id: cpptNoteId(ENCOUNTER_ID.yusuf, 2),
        role: 'perawat',
        author: STAF_LAIN.perawat[3],
        at: T('06.00'),
        o: 'Balans cairan −350 mL, edema tungkai berkurang.',
        a: 'Kelebihan volume cairan.',
        p: 'Timbang BB pagi, catat balans ketat.',
      },
    ],
    obs: [
      [T('06.00'), 36.7, 82, 18, 152, 90, 97, false, 'A'],
      [T('10.00'), 36.8, 80, 18, 148, 88, 97, false, 'A'],
    ],
    results: [
      [T('06.00'), 'Ureum', '168 mg/dL', 'tinggi'],
      [T('06.00'), 'Kalium', '5,4 mmol/L', 'tinggi'],
      [T('06.00'), 'Hemoglobin', '8,9 g/dL', 'rendah'],
    ],
    nursing: [
      [
        'Kelebihan volume cairan',
        [
          ['Timbang BB harian', true],
          ['Catat balans cairan', true],
          ['Edukasi batas cairan 600 mL/hari', false],
        ],
      ],
    ],
  },
  {
    patientId: PATIENT_ID.rizky,
    wardCode: 'KENANGA',
    bed: 'K-412',
    dpjp: doctorName(DOCTOR_ID.yohanes),
    admittedOn: shiftDate(DEMO_TODAY, -3),
    flags: ['risiko-jatuh'],
    risk: 'Risiko jatuh tinggi · Morse 55',
    plan: 'Pasca ORIF femur kanan hari ini (OK 4, selesai 10.28): pantau neurovaskular distal, analgesik terjadwal, foto kontrol 11.00; mobilisasi kruk tanpa tumpuan mulai besok.',
    dx: [
      ['ICD-10', 'S72.3', 'Fraktur batang femur', true],
      ['ICD-9-CM', '79.35', 'Reduksi terbuka dengan fiksasi internal femur'],
    ],
    emarNow: '12.00',
    emarNote: 'Pasien di ruang pulih OK 4. Nilai skala nyeri sebelum dan 30 menit setelah analgesik.',
    meds: [
      ['Ketorolak 30 mg', 'IV · 3×1 · mulai pasca operasi', null, false, ['', '', 'j', 'r', 'r']],
      ['Seftriakson 1 g', 'IV · 2×1', null, false, ['g:06.00', '', '', 'r', '']],
      ['Enoksaparin 60 mg/0,6 mL', 'SC · 1×24 jam sore', '93002210', true, ['', '', '', 'r', '']],
      ['Parasetamol 1 g', 'IV · 4×1', null, false, ['g:06.00', '', 'j', 'r', 'r']],
    ],
    notes: [
      {
        id: cpptNoteId(ENCOUNTER_ID.rizky, 1),
        role: 'residen',
        author: PERSONA.dokterResiden,
        at: T('07.30', -1),
        s: 'Nyeri paha kanan skala 4.',
        o: 'Traksi kulit terpasang. Distal hangat, pulsasi baik, tidak ada tanda sindrom kompartemen.',
        a: 'Fraktur batang femur kanan tertutup H3, siap ORIF.',
        p: 'ORIF besok 08.00 di OK 4; puasa mulai 24.00; persetujuan tindakan sudah ditandatangani.',
        cosign: [doctorName(DOCTOR_ID.yohanes), T('10.05', -1)],
      },
      {
        id: cpptNoteId(ENCOUNTER_ID.rizky, 2),
        role: 'perawat',
        author: PERSONA.perawat,
        at: T('06.00'),
        s: 'Puasa sejak 24.00, nyeri skala 3.',
        o: 'Persiapan operasi lengkap: gelang identitas, penandaan lokasi operasi, tanda vital stabil.',
        a: 'Risiko jatuh tinggi; ansietas pra-operasi.',
        p: 'Antar ke OK 4 pukul 07.30, serah terima dengan perawat kamar operasi.',
      },
      {
        id: cpptNoteId(ENCOUNTER_ID.rizky, 3),
        role: 'dpjp',
        author: doctorName(DOCTOR_ID.yohanes),
        at: T('10.35'),
        o: 'ORIF femur kanan selesai 10.28; perdarahan ± 350 mL; distal hangat, pulsasi baik.',
        a: 'Pasca ORIF femur kanan hari 0, stabil.',
        p: 'Observasi di ruang pulih, foto kontrol 11.00, analgesik terjadwal, kembali ke Kenanga K-412.',
      },
    ],
    obs: [
      [T('06.00'), 37.2, 84, 18, 122, 76, 98, false, 'A'],
      [T('10.40'), 36.6, 88, 18, 118, 72, 98, false, 'A'],
    ],
    results: [
      [T('06.00', -1), 'Hemoglobin', '11,2 g/dL', 'rendah'],
      [T('06.00', -1), 'Leukosit', '9.800 /µL', 'normal'],
    ],
    nursing: [
      [
        'Nyeri akut',
        [
          ['Kaji skala nyeri tiap shift', true],
          ['Kompres dingin area operasi', false],
        ],
      ],
      [
        'Risiko jatuh',
        [
          ['Gelang kuning terpasang', true],
          ['Kruk dan alas kaki anti-slip tersedia', true],
        ],
      ],
    ],
  },
  {
    patientId: PATIENT_ID.raka,
    wardCode: 'MAWAR',
    bed: 'W-308',
    dpjp: doctorName(DOCTOR_ID.nadia),
    admittedOn: shiftDate(DEMO_TODAY, -1),
    flags: [],
    risk: 'Fase kritis DBD hari ke-4–5 · pantau tanda syok',
    plan: 'Cairan sesuai protokol DBD, hematokrit tiap 6 jam, pantau tanda bahaya dan diuresis.',
    dx: [['ICD-10', 'A91', 'Demam berdarah dengue', true]],
    emarNow: '12.00',
    emarNote: 'Dosis anak per kg BB (22 kg); hindari obat antiinflamasi nonsteroid.',
    meds: [
      [
        'Ringer laktat 7 mL/kg/jam',
        'IV kontinu · evaluasi tiap 6 jam',
        null,
        false,
        ['g:06.00', 'g:08.00', 'j', 'r', 'r'],
      ],
      ['Parasetamol 250 mg', 'PO · bila suhu ≥ 38 °C', null, false, ['', 'g:08.20', '', '', '']],
    ],
    notes: [
      {
        id: cpptNoteId(ENCOUNTER_ID.raka, 1),
        role: 'dpjp',
        author: doctorName(DOCTOR_ID.nadia),
        at: T('08.00'),
        s: 'Demam hari ke-4, nafsu makan menurun, tidak ada perdarahan.',
        o: 'Hematokrit 44% (naik dari 40%), trombosit 62.000. Akral hangat, CRT < 2 detik.',
        a: 'DBD derajat II, fase kritis.',
        p: 'Naikkan cairan 7 mL/kg/jam, hematokrit ulang 6 jam.',
      },
      {
        id: cpptNoteId(ENCOUNTER_ID.raka, 2),
        role: 'perawat',
        author: STAF_LAIN.perawat[1],
        at: T('06.00'),
        o: 'Diuresis 1,2 mL/kg/jam. Suhu 38,2 °C.',
        a: 'Hipertermia; risiko syok hipovolemik.',
        p: 'Kompres hangat, pantau tanda vital tiap 2 jam.',
      },
    ],
    obs: [
      [T('06.00'), 38.2, 108, 22, 98, 64, 98, false, 'A'],
      [T('10.00'), 37.6, 100, 20, 102, 66, 98, false, 'A'],
    ],
    results: [
      [T('06.00'), 'Hematokrit', '44% (sebelumnya 40%)', 'tinggi'],
      [T('06.00'), 'Trombosit', '62.000 /µL', 'rendah'],
    ],
    nursing: [
      [
        'Risiko syok hipovolemik',
        [
          ['Pantau tanda vital tiap 2 jam', true],
          ['Catat asupan dan diuresis', true],
          ['Edukasi orang tua tanda bahaya', false],
        ],
      ],
    ],
  },
  {
    patientId: PATIENT_ID.wulan,
    wardCode: 'MAWAR',
    bed: 'W-322',
    dpjp: doctorName(DOCTOR_ID.hana),
    admittedOn: DEMO_TODAY,
    flags: [],
    risk: 'Pasca seksio sesarea hari 0 · IMD berhasil',
    plan: 'Mobilisasi bertahap, ASI sesuai keinginan bayi, analgesik terjadwal, lepas kateter 12 jam pasca operasi.',
    dx: [
      ['ICD-10', 'O82.0', 'Persalinan dengan seksio sesarea elektif', true],
      ['ICD-10', 'Z37.0', 'Lahir hidup tunggal'],
      ['ICD-9-CM', '74.1', 'Seksio sesarea segmen bawah'],
    ],
    emarNow: '12.00',
    emarNote: 'Oksitosin obat kewaspadaan tinggi: cek ganda sebelum mengganti cairan.',
    meds: [
      [
        'Sefazolin 2 g',
        'IV · dosis tunggal profilaksis pra-operasi',
        null,
        false,
        ['g:06.50', '', '', '', ''],
      ],
      [
        'Oksitosin 20 IU dalam RL 500 mL',
        'IV · 8 jam pasca operasi',
        null,
        true,
        ['', 'g:08.30', '', '', ''],
      ],
      ['Ketorolak 30 mg', 'IV · 3×1', null, false, ['', '', 'j', 'r', 'r']],
      ['Parasetamol 1 g', 'IV · 3×1', null, false, ['', 'g:08.30', '', 'r', '']],
    ],
    notes: [
      {
        id: cpptNoteId(ENCOUNTER_ID.wulan, 1),
        role: 'bidan',
        author: PERSONA.bidan,
        at: T('10.00'),
        s: 'Nyeri luka operasi skala 4, sudah menyusui.',
        o: 'Kontraksi uterus baik, TFU 2 jari bawah pusat, perdarahan ± 50 mL.',
        a: 'Pasca SC hari 0, kondisi stabil.',
        p: 'Pantau perdarahan dan kontraksi tiap 1 jam, dampingi menyusui.',
      },
      {
        id: cpptNoteId(ENCOUNTER_ID.wulan, 2),
        role: 'dpjp',
        author: doctorName(DOCTOR_ID.hana),
        at: T('08.45'),
        s: 'Seksio sesarea elektif atas indikasi bekas SC.',
        o: 'Bayi lahir 07.52, perempuan 3.100 g, APGAR 8/9. Perdarahan operasi 450 mL.',
        a: 'G2P2A0 pasca SC elektif.',
        p: 'Oksitosin 8 jam, mobilisasi 6 jam pasca operasi.',
      },
    ],
    obs: [
      [T('08.45'), 36.8, 88, 18, 118, 74, 99, false, 'A'],
      [T('10.15'), 36.9, 84, 18, 120, 76, 99, false, 'A'],
    ],
    results: [[T('10.00'), 'Hemoglobin pasca operasi', '10,9 g/dL', 'rendah']],
    nursing: [
      [
        'Nyeri akut pasca operasi',
        [
          ['Kaji skala nyeri tiap 4 jam', true],
          ['Ajarkan teknik relaksasi napas', false],
        ],
      ],
      [
        'Risiko menyusui tidak efektif',
        [
          ['Bantu posisi dan pelekatan menyusui', true],
          ['Edukasi ASI eksklusif', false],
        ],
      ],
    ],
  },
];

/** Pasien rawat inap hari demo (tanpa pasien skenario). */
export const INPATIENT_SEEDS: readonly InpatientSeed[] = [ENDANG, ...ICU_SEEDS, ...WARD_SEEDS];

export function demoInpatients(): InpatientDetail[] {
  return INPATIENT_SEEDS.map((s) => buildInpatient(s));
}

/** Kunjungan yang punya draf resume pulang di mode presentasi (Ny. Endang + dua pasien skenario). */
export const RESUME_ENCOUNTERS: readonly string[] = [
  ENCOUNTER_ID.endang,
  ENCOUNTER_ID.hartono,
  ENCOUNTER_ID.ratna,
];
/** Dokumen persetujuan tindakan di tablet (`/tablet/persetujuan/<id>`). */
export const CONSENT_IDS: readonly string[] = [CONSENT_ID.hartono, CONSENT_ID.hendro, CONSENT_ID.ratna];

export const INPATIENT_FLAG_LABEL: Record<InpatientFlag, string> = {
  cosign: 'Menunggu co-sign DPJP',
  'emar-terlambat': 'Obat terlambat',
  'rencana-pulang': 'Rencana pulang',
  'risiko-jatuh': 'Risiko jatuh',
  isolasi: 'Isolasi',
};

// ---------------------------------------------------------------------------------------------------------
// K13 · Resume medis pulang (Ny. Endang; pasien skenario diproyeksikan di lib/rawat-inap-scenario.ts)
// ---------------------------------------------------------------------------------------------------------

export function resumeChecklist(
  done: Partial<Record<ResumeCheckId, boolean>>,
): DischargeSummary['checklist'] {
  return RESUME_CHECK_IDS.map((id) => ({ id, label: RESUME_CHECK_LABEL[id], done: !!done[id] }));
}

/** Resume Ny. Endang (mockup Resume): semua butir lengkap kecuali rekonsiliasi obat pulang. */
export function demoEndangResume(): DischargeSummary {
  const dpjp = STAF.dpjpPenyakitDalam;
  return {
    encounterId: ENCOUNTER_ID.endang,
    patientId: PATIENT_ID.endang,
    admittedAt: T('09.30', -4),
    dischargeAt: T('13.00'),
    admissionVia: 'IGD',
    dischargeMethod: 'Atas persetujuan dokter',
    condition: 'Membaik',
    location: 'Bangsal Melati M-203',
    dpjp,
    sections: [
      {
        id: 'anamnesis',
        title: 'Alasan masuk dan anamnesis singkat',
        body: 'Demam 4 hari, batuk berdahak, sesak. Riwayat DM tipe 2 sejak 2019. Alergi amoksisilin (ruam).',
        source: 'asesmen-igd',
      },
      {
        id: 'fisik',
        title: 'Pemeriksaan fisik penting',
        body: 'Masuk: T 38,9 °C, RR 28, SpO2 91%, ronki basah paru kanan. Pulang: T 36,8 °C, RR 18, SpO2 97%.',
        source: 'observasi',
      },
      {
        id: 'penunjang',
        title: 'Pemeriksaan penunjang',
        body: 'Foto toraks: infiltrat lobus kanan bawah. Leukosit 16.200 → 8.900 /µL. GDS 254 → 168 mg/dL. Kultur sputum: Streptococcus pneumoniae, sensitif seftriakson.',
        source: 'hasil',
      },
      {
        id: 'terapi',
        title: 'Terapi selama dirawat',
        body: 'Seftriakson 2 g IV 1×24 jam (H1–H5), insulin basal-bolus, N-asetilsistein, O2 nasal 2 lpm (H1–H3); kateter vena sentral dipasang H2.',
        source: 'emar',
      },
      {
        id: 'obat-pulang',
        title: 'Obat pulang (hasil rekonsiliasi)',
        body: 'Lihat daftar rekonsiliasi.',
        source: 'rekonsiliasi',
      },
      {
        id: 'instruksi',
        title: 'Instruksi dan edukasi',
        body: 'Cek gula darah mandiri 2×/hari dan catat di aplikasi pasien. Kembali ke IGD bila demam ≥ 38,5 °C atau sesak.',
        source: 'dpjp',
      },
      {
        id: 'tindak-lanjut',
        title: 'Tindak lanjut',
        body: `Kontrol Poli Penyakit Dalam Rab, 14 Okt 2026 · ${dpjp}. Foto toraks ulang 6 minggu.`,
        source: 'surat-kontrol',
      },
    ],
    medications: [
      { name: 'Sefiksim 200 mg', sig: '2×1 PO · 4 hari', change: 'baru' },
      { name: 'Metformin 500 mg', sig: '2×1 PO sesudah makan', change: 'lanjut' },
      { name: 'Insulin glargine 16 unit', sig: 'SC malam', change: 'baru' },
      { name: 'Amlodipin 5 mg', sig: 'dihentikan sementara (TD terkontrol)', change: 'dihentikan' },
    ],
    reconciliationConfirmedAt: null,
    codes: [
      { system: 'ICD-10', code: 'J13', label: 'Pneumonia akibat S. pneumoniae', primary: true },
      { system: 'ICD-10', code: 'E11.9', label: 'DM tipe 2 tanpa komplikasi', primary: false },
      { system: 'ICD-9-CM', code: '38.93', label: 'Pemasangan kateter vena sentral', primary: false },
    ],
    checklist: resumeChecklist({
      ident: true,
      anamnesis: true,
      fisik: true,
      penunjang: true,
      diagnosis: true,
      prosedur: true,
      terapi: true,
      edukasi: true,
      instruksi: true,
      kontrol: true,
      kondisi: true,
    }),
    signedAt: null,
    signedBy: null,
  };
}

// ---------------------------------------------------------------------------------------------------------
// K11 · Persetujuan tindakan di tablet. Status pasien skenario mengikuti mesin skenario.
// ---------------------------------------------------------------------------------------------------------

type ConsentItems = ConsentDocument['items'];
const items = (texts: [string, string, string, string, string, string, string]): ConsentItems => {
  const titles = [
    'Diagnosis',
    'Tindakan dan tujuannya',
    'Cara pelaksanaan',
    'Risiko',
    'Komplikasi dan penanganannya',
    'Alternatif',
    'Prognosis',
  ];
  return texts.map((body, i) => ({ id: `info-${i + 1}`, title: titles[i] ?? '', body }));
};

/** Tn. Hendro (ICU, tersedasi): pemasangan kateter vena sentral; istri memberi persetujuan (mockup Consent). */
export function demoHendroConsent(): ConsentDocument {
  return {
    id: CONSENT_ID.hendro,
    encounterId: ENCOUNTER_ID.hendro,
    patientId: PATIENT_ID.hendro,
    procedure: 'Pemasangan kateter vena sentral',
    consentGiver: 'Istri (pasien tersedasi, belum kompeten)',
    doctor: doctorName(DOCTOR_ID.ferry),
    informer: doctorName(DOCTOR_ID.kartika),
    explainedAt: T('09.50'),
    explanationMinutes: 9,
    location: 'ICU',
    items: items([
      'Pneumonia berat dengan gagal napas; membutuhkan akses vena jangka menengah untuk obat dan cairan.',
      'Memasang selang kecil di pembuluh vena leher untuk obat, cairan, dan pemantauan tekanan vena.',
      'Bius lokal, dipandu USG, sekitar 30 menit, di tempat tidur ICU.',
      'Nyeri, perdarahan, infeksi, kolaps paru (jarang, < 1%).',
      'Posisi kateter dipastikan dengan foto toraks; komplikasi ditangani segera oleh tim ICU.',
      'Infus perifer berulang, atau kateter PICC lewat lengan.',
      'Baik bila tindakan dan terapi berjalan sesuai rencana.',
    ]),
    signerName: 'Sekar Gunawan',
    witness: { name: 'Dimas Gunawan', relation: 'anak' },
    staffWitness: STAF_LAIN.perawat[1],
    status: 'draf',
    finalAt: null,
  };
}

/** Tn. Hartono (IGD, kompeten): rawat intensif + terapi antitrombotik; istri menjadi saksi (naskah Simulasi). */
export function hartonoConsentBase(explainedAt: string): ConsentDocument {
  return {
    id: CONSENT_ID.hartono,
    encounterId: ENCOUNTER_ID.hartono,
    patientId: PATIENT_ID.hartono,
    procedure: 'Rawat intensif dan terapi antitrombotik',
    consentGiver: 'Pasien sendiri (kompeten)',
    doctor: STAF.dpjpJantung,
    informer: STAF.dokterJagaIgd,
    explainedAt,
    explanationMinutes: 8,
    location: 'IGD',
    items: items([
      'Serangan jantung tanpa elevasi ST (NSTEMI) disertai kadar kalium darah tinggi.',
      'Rawat di ruang intensif dengan pemantauan EKG terus-menerus; obat pengencer darah untuk mencegah serangan berulang.',
      'Obat diminum dan disuntik di bawah kulit dua kali sehari; infus dan pemeriksaan darah berkala.',
      'Perdarahan (gusi, saluran cerna, bekas suntikan) dan memar; reaksi alergi obat (jarang).',
      'Perdarahan dipantau dengan pemeriksaan darah; obat dihentikan atau dinetralkan bila perlu.',
      'Terapi tanpa antikoagulan (risiko serangan berulang lebih tinggi) atau rujukan untuk kateterisasi segera.',
      'Baik bila terapi teratur dan faktor risiko (tekanan darah, ginjal) dikendalikan.',
    ]),
    signerName: 'Hartono Wibisono',
    witness: { name: 'Wening Wibisono', relation: 'istri' },
    staffWitness: PERSONA.perawat,
    status: 'draf',
    finalAt: null,
  };
}

/** Ny. Ratna (elektif): kolesistektomi laparoskopik; suami menjadi saksi. */
export function ratnaConsentBase(explainedAt: string): ConsentDocument {
  return {
    id: CONSENT_ID.ratna,
    encounterId: ENCOUNTER_ID.ratna,
    patientId: PATIENT_ID.ratna,
    procedure: 'Kolesistektomi laparoskopik',
    consentGiver: 'Pasien sendiri (kompeten)',
    doctor: STAF.dpjpBedah,
    informer: STAF.dpjpBedah,
    explainedAt,
    explanationMinutes: 12,
    location: 'Admisi rawat inap',
    items: items([
      'Batu kandung empedu yang menimbulkan nyeri berulang (kolelitiasis simptomatik).',
      'Mengangkat kandung empedu melalui 3–4 sayatan kecil dengan bantuan kamera (laparoskopi).',
      'Bius umum, sekitar 60–90 menit, di kamar operasi.',
      'Nyeri, perdarahan, infeksi luka, cedera saluran empedu (jarang, < 0,5%).',
      'Bila sulit, operasi diubah menjadi bedah terbuka; pemulihan dipantau di ruang pulih.',
      'Obat pereda nyeri dan diet rendah lemak (keluhan bisa berulang), atau operasi terbuka.',
      'Baik; sebagian besar pasien pulang 1–2 hari setelah operasi.',
    ]),
    signerName: 'Ratna Sari',
    witness: { name: 'Bima Pratomo', relation: 'suami' },
    staffWitness: STAF_LAIN.perawat[0],
    status: 'draf',
    finalAt: null,
  };
}
