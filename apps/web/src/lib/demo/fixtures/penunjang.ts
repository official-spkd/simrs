import type { LabRange, LabResult, LabSample, LabWorklist, SupportPatient } from '@simrs/shared';
import { deltaCheck, labFlag } from '../../penunjang';
import { type DemoPatient, PASIEN } from './pasien';
import { DOKTER, PERSONA, STAF, STAF_LAIN } from './staf';
import { DEMO_NOW, DEMO_TODAY, shiftDate } from './waktu';

/**
 * Data dummy layar penunjang (laboratorium, farmasi, radiologi) untuk mode presentasi (ADR-0023). Semua pasien dari
 * `PASIEN`, dokter dari `DOKTER`, kode klinis hanya dari contoh seed (dijaga tes). Flag hasil lab dihitung dari
 * rentang rujukan (`labFlag`, `deltaCheck`), bukan diketik. Pasien skenario diproyeksikan terpisah
 * (`lib/penunjang-skenario.ts`) sesuai kemajuan simulasi.
 */

/** Instan ISO WIB pada hari demo (atau `day` hari sebelumnya/sesudahnya): `at('10.39')`. */
export function at(hhmm: string, day = 0): string {
  return `${shiftDate(DEMO_TODAY, day)}T${hhmm.replace('.', ':')}:00+07:00`;
}

/** Menit utuh dari `fromIso` sampai `toIso` (bawaan: jam data demo). */
export function minutesUntil(fromIso: string, toIso: string = DEMO_NOW): number {
  return Math.max(0, Math.round((Date.parse(toIso) - Date.parse(fromIso)) / 60_000));
}

export function patientOrThrow(id: string): DemoPatient {
  const p = PASIEN.find((x) => x.id === id);
  if (!p) throw new Error(`Pasien demo ${id} tidak ada`);
  return p;
}

/** Identitas banner pasien penunjang dari fixture bersama. */
export function supportPatient(id: string): SupportPatient {
  const p = patientOrThrow(id);
  const guarantor =
    p.penjamin === 'BPJS'
      ? `BPJS ${p.kelas ?? ''}`.trim()
      : p.penjamin === 'Asuransi'
        ? 'Asuransi swasta'
        : 'Umum';
  return {
    id: p.id,
    name: p.nama,
    rm: p.rm,
    sex: p.jk,
    ageYears: p.umur,
    birthDate: p.tanggalLahir,
    allergies: [...p.alergi],
    guarantor,
  };
}

export function doctorName(id: string): string {
  const d = DOKTER.find((x) => x.id === id);
  if (!d) throw new Error(`Dokter demo ${id} tidak ada`);
  return d.nama;
}

// ───────────────────────────── Katalog pemeriksaan (LOINC seed) ─────────────────────────────

interface TestDef {
  loinc: string;
  name: string;
  unit: string;
  decimals: number;
  ref: LabRange | null;
  critical: LabRange | null;
  deltaLimit: number | null;
}

const r = (low: number | null, high: number | null): LabRange => ({ low, high });

/** Rentang rujukan dewasa (laki-laki/perempuan bila berbeda) dan anak untuk hemoglobin. */
export const LAB_TESTS = {
  hbL: {
    loinc: '718-7',
    name: 'Hemoglobin',
    unit: 'g/dL',
    decimals: 1,
    ref: r(13.5, 17.5),
    critical: r(7, 20),
    deltaLimit: 2,
  },
  hbP: {
    loinc: '718-7',
    name: 'Hemoglobin',
    unit: 'g/dL',
    decimals: 1,
    ref: r(12, 15.5),
    critical: r(7, 20),
    deltaLimit: 2,
  },
  hbAnak: {
    loinc: '718-7',
    name: 'Hemoglobin',
    unit: 'g/dL',
    decimals: 1,
    ref: r(11.5, 15.5),
    critical: r(7, 20),
    deltaLimit: 2,
  },
  leukosit: {
    loinc: '6690-2',
    name: 'Leukosit',
    unit: '/µL',
    decimals: 0,
    ref: r(4000, 11000),
    critical: null,
    deltaLimit: null,
  },
  trombosit: {
    loinc: '777-3',
    name: 'Trombosit',
    unit: '/µL',
    decimals: 0,
    ref: r(150000, 450000),
    critical: r(20000, null),
    deltaLimit: 30000,
  },
  crp: {
    loinc: '1988-5',
    name: 'CRP',
    unit: 'mg/L',
    decimals: 0,
    ref: r(null, 5),
    critical: null,
    deltaLimit: null,
  },
  glukosa: {
    loinc: '2345-7',
    name: 'Glukosa sewaktu',
    unit: 'mg/dL',
    decimals: 0,
    ref: r(70, 140),
    critical: r(40, 500),
    deltaLimit: null,
  },
  ureum: {
    loinc: '3094-0',
    name: 'Ureum',
    unit: 'mg/dL',
    decimals: 0,
    ref: r(15, 40),
    critical: null,
    deltaLimit: null,
  },
  kreatininL: {
    loinc: '2160-0',
    name: 'Kreatinin',
    unit: 'mg/dL',
    decimals: 1,
    ref: r(0.7, 1.3),
    critical: null,
    deltaLimit: 0.3,
  },
  kreatininP: {
    loinc: '2160-0',
    name: 'Kreatinin',
    unit: 'mg/dL',
    decimals: 1,
    ref: r(0.5, 1.1),
    critical: null,
    deltaLimit: 0.3,
  },
  natrium: {
    loinc: '2951-2',
    name: 'Natrium',
    unit: 'mmol/L',
    decimals: 0,
    ref: r(135, 145),
    critical: r(120, 160),
    deltaLimit: null,
  },
  kalium: {
    loinc: '2823-3',
    name: 'Kalium',
    unit: 'mmol/L',
    decimals: 1,
    ref: r(3.5, 5.1),
    critical: r(2.5, 6),
    deltaLimit: 1,
  },
  klorida: {
    loinc: '2075-0',
    name: 'Klorida',
    unit: 'mmol/L',
    decimals: 0,
    ref: r(98, 107),
    critical: null,
    deltaLimit: null,
  },
  troponin: {
    loinc: '10839-9',
    name: 'Troponin I',
    unit: 'ng/mL',
    decimals: 2,
    ref: r(null, 0.04),
    critical: null,
    deltaLimit: null,
  },
  hba1c: {
    loinc: '4548-4',
    name: 'HbA1c',
    unit: '%',
    decimals: 1,
    ref: r(null, 6.5),
    critical: null,
    deltaLimit: null,
  },
  kolesterol: {
    loinc: '2093-3',
    name: 'Kolesterol total',
    unit: 'mg/dL',
    decimals: 0,
    ref: r(null, 200),
    critical: null,
    deltaLimit: null,
  },
  ldl: {
    loinc: '13457-7',
    name: 'LDL',
    unit: 'mg/dL',
    decimals: 0,
    ref: r(null, 100),
    critical: null,
    deltaLimit: null,
  },
  hdl: {
    loinc: '2085-9',
    name: 'HDL',
    unit: 'mg/dL',
    decimals: 0,
    ref: r(40, null),
    critical: null,
    deltaLimit: null,
  },
  trigliserida: {
    loinc: '2571-8',
    name: 'Trigliserida',
    unit: 'mg/dL',
    decimals: 0,
    ref: r(null, 150),
    critical: null,
    deltaLimit: null,
  },
  abo: {
    loinc: '883-9',
    name: 'Golongan darah ABO',
    unit: '—',
    decimals: 0,
    ref: null,
    critical: null,
    deltaLimit: null,
  },
  rhesus: {
    loinc: '10331-7',
    name: 'Rhesus',
    unit: '—',
    decimals: 0,
    ref: null,
    critical: null,
    deltaLimit: null,
  },
} as const satisfies Record<string, TestDef>;

export type LabTestKey = keyof typeof LAB_TESTS;

/** Hasil numerik dengan flag dan delta check dihitung dari definisi pemeriksaan. */
export function numeric(
  key: LabTestKey,
  value: number,
  previous: number[] = [],
  note: string | null = null,
): LabResult {
  const t: TestDef = LAB_TESTS[key];
  return {
    ...t,
    value,
    text: null,
    previous,
    flag: labFlag(value, t.ref, t.critical),
    delta: deltaCheck(value, previous, t.deltaLimit),
    pending: false,
    note,
  };
}

/** Hasil kualitatif (golongan darah, rhesus). */
export function qualitative(key: LabTestKey, text: string): LabResult {
  const t: TestDef = LAB_TESTS[key];
  return { ...t, value: null, text, previous: [], flag: 'N', delta: false, pending: false, note: null };
}

/** Parameter yang masih diproses analyzer. */
export function pendingResult(key: LabTestKey): LabResult {
  const t: TestDef = LAB_TESTS[key];
  return { ...t, value: null, text: null, previous: [], flag: null, delta: false, pending: true, note: null };
}

// ───────────────────────────── Laboratorium (S01, S09) ─────────────────────────────

const ANALIS = PERSONA.analisLab;
const ANALIS_2 = STAF_LAIN.analis[0];

type SampleSeed = Omit<LabSample, 'tatMinutes' | 'patient'> & { patientId: string };

function sample(s: SampleSeed): LabSample {
  const { patientId, ...rest } = s;
  const end = s.status === 'selesai' && s.clinical ? s.clinical.at : DEMO_NOW;
  return {
    ...rest,
    patient: supportPatient(patientId),
    tatMinutes: s.receivedAt ? minutesUntil(s.receivedAt, end) : null,
  };
}

/** Sampel hari demo di luar pasien skenario (8 sampel; pasien skenario ditambahkan sesuai kemajuan simulasi). */
export function demoLabSamples(): LabSample[] {
  return [
    sample({
      id: 'lab-yusuf',
      labNo: 'L2610050131',
      patientId: 'ps-yusuf',
      location: 'Ruang hemodialisis · HD-03',
      sender: doctorName('dr-sinta'),
      priority: 'cito',
      status: 'hasil',
      tests: 'Elektrolit, ureum, kreatinin, Hb (pra-HD)',
      specimen: 'Serum + darah EDTA',
      orderedAt: at('10.05'),
      receivedAt: at('10.21'),
      results: [
        numeric('natrium', 134, [136, 135]),
        numeric('kalium', 6.4, [5.6, 5.9]),
        numeric('klorida', 99, [100, 99]),
        numeric('ureum', 142, [128, 136]),
        numeric('kreatininL', 8.9, [8.4, 8.7]),
        numeric('hbL', 9.6, [9.4, 9.5]),
      ],
      qcNote:
        'Kalium melewati batas kritis (> 6,0) · sampel tidak hemolisis · QC harian lolos · hasil dari analyzer',
      technical: null,
      clinical: null,
      critical: {
        loinc: '2823-3',
        analyte: 'Kalium',
        value: 6.4,
        unit: 'mmol/L',
        decimals: 1,
        resultAt: at('10.39'),
        limitMinutes: 30,
        elapsedSeconds: minutesUntil(at('10.39')) * 60,
        recipient: null,
        reportedAt: null,
        readBackAt: null,
        minutesToReport: null,
      },
    }),
    sample({
      id: 'lab-endang',
      labNo: 'L2610050142',
      patientId: 'ps-endang',
      location: 'Bangsal Melati · M-203',
      sender: doctorName('dr-kartika'),
      priority: 'rutin',
      status: 'hasil',
      tests: 'DL, kimia, CRP',
      specimen: 'Darah EDTA + serum',
      orderedAt: at('09.30'),
      receivedAt: at('09.53'),
      results: [
        numeric('hbP', 11.2, [10.8, 11]),
        numeric('leukosit', 8900, [16200, 11400]),
        numeric('trombosit', 312000, [298000, 305000]),
        numeric('crp', 24, [142, 68]),
        numeric('glukosa', 168, [254, 201]),
        numeric('ureum', 38, [34, 35]),
        numeric('kreatininP', 1.3, [0.9, 0.9]),
        numeric('natrium', 137, [138, 137]),
        numeric('kalium', 4.1, [4, 4.2]),
      ],
      qcNote:
        'Delta check: kreatinin naik 0,4 mg/dL dalam 24 jam · QC harian lolos (Westgard 1-2s) · hasil dari analyzer, belum diubah manual',
      technical: null,
      clinical: null,
      critical: null,
    }),
    sample({
      id: 'lab-raka',
      labNo: 'L2610050157',
      patientId: 'ps-raka',
      location: 'Bangsal Mawar · MW-112',
      sender: doctorName('dr-nadia'),
      priority: 'cito',
      status: 'hasil',
      tests: 'DL serial (DBD hari ke-4)',
      specimen: 'Darah EDTA',
      orderedAt: at('10.15'),
      receivedAt: at('10.27'),
      results: [
        numeric('hbAnak', 13.8, [12.9, 13.4]),
        numeric('leukosit', 3200, [4100, 3600]),
        numeric('trombosit', 62000, [148000, 96000]),
      ],
      qcNote:
        'Delta check: trombosit turun 34.000/µL sejak kemarin · apusan darah tepi dikonfirmasi · QC harian lolos',
      technical: null,
      clinical: null,
      critical: null,
    }),
    sample({
      id: 'lab-wulan',
      labNo: 'L2610050163',
      patientId: 'ps-wulan',
      location: 'Kamar bersalin (VK)',
      sender: doctorName('dr-hana'),
      priority: 'rutin',
      status: 'hasil',
      tests: 'DL, golongan darah',
      specimen: 'Darah EDTA',
      orderedAt: at('09.50'),
      receivedAt: at('10.06'),
      results: [
        numeric('hbP', 11.8),
        numeric('leukosit', 9800),
        numeric('trombosit', 245000),
        qualitative('abo', 'O'),
        qualitative('rhesus', 'Positif'),
      ],
      qcNote: 'QC harian lolos (Westgard 1-2s) · golongan darah dikonfirmasi forward dan reverse typing',
      technical: null,
      clinical: null,
      critical: null,
    }),
    sample({
      id: 'lab-maria',
      labNo: 'L2610050109',
      patientId: 'ps-maria',
      location: 'Poli Penyakit Dalam (pra-kemoterapi)',
      sender: doctorName('dr-rahmat'),
      priority: 'rutin',
      status: 'validasi-teknis',
      tests: 'DL pra-kemoterapi',
      specimen: 'Darah EDTA',
      orderedAt: at('08.40'),
      receivedAt: at('09.05'),
      results: [
        numeric('hbP', 8.9, [10.1, 9.6]),
        numeric('leukosit', 3100, [5600, 4200]),
        numeric('trombosit', 168000, [210000, 182000]),
      ],
      qcNote: `Validasi teknis 10.20 oleh ${ANALIS_2} · QC harian lolos · menunggu validasi klinis Sp.PK`,
      technical: { by: ANALIS_2, at: at('10.20') },
      clinical: null,
      critical: null,
    }),
    sample({
      id: 'lab-hendro',
      labNo: 'L2610050117',
      patientId: 'ps-hendro',
      location: 'ICU/ICCU · ICU 7',
      sender: doctorName('dr-kartika'),
      priority: 'cito',
      status: 'selesai',
      tests: 'Leukosit, CRP, elektrolit',
      specimen: 'Darah EDTA + serum',
      orderedAt: at('09.25'),
      receivedAt: at('09.40'),
      results: [
        numeric('leukosit', 15600, [18900, 17200]),
        numeric('crp', 96, [188, 131]),
        numeric('natrium', 139, [141, 140]),
        numeric('kalium', 3.9, [3.6, 3.8]),
      ],
      qcNote: 'Dirilis 10.12 · hasil tampil di CPPT ICU, notifikasi DPJP, dan SATUSEHAT',
      technical: { by: ANALIS, at: at('09.58') },
      clinical: { by: STAF.dokterPatologiKlinik, at: at('10.12') },
      critical: null,
    }),
    sample({
      id: 'lab-lestiani',
      labNo: 'L2610050171',
      patientId: 'ps-lestiani',
      location: 'Poli Saraf',
      sender: doctorName('dr-yudha'),
      priority: 'rutin',
      status: 'order',
      tests: 'Elektrolit, glukosa sewaktu',
      specimen: 'Serum',
      orderedAt: at('10.40'),
      receivedAt: null,
      results: [],
      qcNote: 'Label barcode tercetak dari order CPOE · menunggu pengambilan sampel di Poli Saraf',
      technical: null,
      clinical: null,
      critical: null,
    }),
    sample({
      id: 'lab-aminah',
      labNo: 'L2610040398',
      patientId: 'ps-aminah',
      location: 'ICU/ICCU · ICU 9',
      sender: doctorName('dr-rahmat'),
      priority: 'cito',
      status: 'inkubasi',
      tests: 'Kultur darah (2 botol)',
      specimen: 'Darah (botol kultur aerob)',
      orderedAt: at('22.10', -1),
      receivedAt: at('22.35', -1),
      results: [],
      qcNote: 'Kultur dalam inkubasi. Laporan pertumbuhan H+1, uji kepekaan H+3.',
      technical: null,
      clinical: null,
      critical: null,
    }),
  ];
}

/** Worklist laboratorium hari demo (tanpa pasien skenario). */
export function demoLabWorklist(extra: readonly LabSample[] = []): LabWorklist {
  return {
    asOf: DEMO_NOW,
    stats: {
      samplesToday: 412,
      awaitingValidation: 38,
      tatRoutineMinutes: 58,
      tatRoutineTarget: 60,
      tatCitoMinutes: 41,
      tatCitoTarget: 45,
    },
    analyzers: [
      { name: 'Analyzer hematologi', link: 'HL7 ORU', online: true },
      { name: 'Analyzer kimia klinik', link: 'HL7 ORU', online: true },
    ],
    samples: [...extra, ...demoLabSamples()],
  };
}
