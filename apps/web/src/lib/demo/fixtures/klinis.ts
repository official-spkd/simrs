import type {
  CpoeCatalogItem,
  CpoeContext,
  CpoeEncounterRef,
  CpoeOrder,
  CpoeOrderKind,
  CpoeOrderSet,
  EncounterLab,
  KlinisPatient,
  PoliEncounter,
  PoliQueueItem,
  PoliVital,
  PoliWorklist,
} from '@simrs/shared';
import { taskKey } from '../engine/run';
import type { RunResult, TaskValue } from '../engine/types';
import { evaluateOrders, type OrderLine } from '../../klinis-cds';
import { bloodPressureFlag, glucoseFlag, icd10Display, minutesToJam, parseBloodPressure } from '../../klinis';
import { PATIENT_ID } from './ids';
import { ANTREAN_POLI_PD, type AntreanPoli, encounterIdOf, type DemoPatient, patientById } from './pasien';
import { poliByCode, queueNo } from './rs';
import { STAF } from './staf';
import { DEMO_TODAY } from './waktu';

/**
 * K01/K02/K09 · Data dummy pemeriksaan poli dan CPOE (mockup `Main.dc.html`, `CPOE.dc.html`; ADR-0023). Pasien dari
 * `PASIEN`, dokter dari `STAF`/`DOKTER`, kode klinis hanya dari rujukan seed (LOINC, KFA, ICD-9-CM, ICD-10; dijaga
 * tes). Pasien skenario (Tn. Suryo, Tn. Hartono) diproyeksikan dari rekam medis mesin skenario.
 */

// ---------------------------------------------------------------------------------------------------------------
// Katalog CPOE
// ---------------------------------------------------------------------------------------------------------------

const loinc = (code: string) => ({ system: 'LOINC', code }) as const;
const kfa = (code: string) => ({ system: 'KFA', code }) as const;
const icd9 = (code: string) => ({ system: 'ICD-9-CM', code }) as const;

function item(
  id: string,
  kind: CpoeOrderKind,
  name: string,
  meta: string,
  detail: string,
  code: CpoeCatalogItem['code'],
  tariff: number,
  note: string,
  extra: Partial<CpoeCatalogItem> = {},
): CpoeCatalogItem {
  return {
    id,
    kind,
    name,
    meta,
    detail,
    code,
    coverage: kind === 'obat' ? 'fornas' : 'ditanggung',
    priority: 'rutin',
    tariff: String(tariff),
    keywords: '',
    substance: null,
    classes: [],
    note,
    ...extra,
  };
}

const NO_DUP = 'Tidak ada duplikasi hari ini.';

const LAB_ITEMS: CpoeCatalogItem[] = [
  item(
    'hba1c',
    'lab',
    'HbA1c',
    'Lab PK · LOINC 4548-4',
    'Evaluasi kontrol glikemik 3 bulan',
    loinc('4548-4'),
    185_000,
    'Tidak ada duplikasi dalam 3 bulan.',
    { keywords: 'hba1c hemoglobin glikat diabetes dm' },
  ),
  item(
    'lipid',
    'lab',
    'Profil lipid',
    'Lab PK · LOINC 2093-3, 13457-7, 2085-9, 2571-8',
    'Kolesterol total, LDL, HDL, trigliserida · puasa 10 jam',
    null,
    160_000,
    'Tidak ada duplikasi dalam 6 bulan.',
    { keywords: 'lipid kolesterol ldl hdl trigliserida' },
  ),
  item(
    'gds',
    'lab',
    'Glukosa darah sewaktu',
    'Lab PK · LOINC 2345-7',
    'Evaluasi glukosa saat kunjungan',
    loinc('2345-7'),
    25_000,
    NO_DUP,
    { keywords: 'glukosa gula sewaktu gds diabetes' },
  ),
  item(
    'kreatinin',
    'lab',
    'Kreatinin serum',
    'Lab PK · LOINC 2160-0',
    'Pemantauan fungsi ginjal (eGFR)',
    loinc('2160-0'),
    45_000,
    'Pemantauan rutin sesuai PPK.',
    { keywords: 'kreatinin ginjal egfr' },
  ),
  item('ureum', 'lab', 'Ureum', 'Lab PK · LOINC 3094-0', 'Fungsi ginjal', loinc('3094-0'), 40_000, NO_DUP, {
    keywords: 'ureum bun ginjal',
  }),
  item(
    'darah-lengkap',
    'lab',
    'Darah lengkap',
    'Lab PK · LOINC 718-7, 6690-2, 777-3',
    'Hemoglobin, leukosit, trombosit, hitung jenis',
    null,
    95_000,
    NO_DUP,
    { keywords: 'darah lengkap dl hematologi hemoglobin leukosit trombosit' },
  ),
  item(
    'elektrolit',
    'lab',
    'Elektrolit (Na, K, Cl)',
    'Lab PK · LOINC 2951-2, 2823-3, 2075-0',
    'Pemantauan elektrolit',
    null,
    150_000,
    NO_DUP,
    { keywords: 'elektrolit natrium kalium klorida' },
  ),
  item(
    'kalium',
    'lab',
    'Kalium ulang',
    'Lab PK · LOINC 2823-3',
    'Evaluasi 1 jam setelah tata laksana hiperkalemia',
    loinc('2823-3'),
    60_000,
    'Diulang sesuai protokol hiperkalemia.',
    { priority: 'cito', keywords: 'kalium ulang hiperkalemia elektrolit' },
  ),
  item(
    'troponin',
    'lab',
    'Troponin I',
    'Lab PK · LOINC 10839-9',
    'Serial jam 0 dan jam 3',
    loinc('10839-9'),
    250_000,
    'Masuk alur sindrom koroner akut.',
    { priority: 'cito', keywords: 'troponin jantung ska nyeri dada' },
  ),
  item('crp', 'lab', 'CRP', 'Lab PK · LOINC 1988-5', 'Penanda inflamasi', loinc('1988-5'), 120_000, NO_DUP, {
    keywords: 'crp inflamasi infeksi',
  }),
  item(
    'golongan-darah',
    'lab',
    'Golongan darah + rhesus',
    'Lab PK · LOINC 883-9, 10331-7',
    'Persiapan transfusi atau operasi',
    loinc('883-9'),
    60_000,
    'Belum ada golongan darah tercatat.',
    { keywords: 'golongan darah rhesus abo' },
  ),
  item(
    'vitamin-d',
    'lab',
    'Vitamin D (25-OH)',
    'Lab PK · di luar paket',
    'Atas permintaan pasien · tidak ada indikasi di PPK',
    null,
    385_000,
    'Tidak ada indikasi di PPK.',
    { coverage: 'tidak-ditanggung', keywords: 'vitamin d 25-oh' },
  ),
];

const OTHER_ITEMS: CpoeCatalogItem[] = [
  item(
    'foto-toraks',
    'radiologi',
    'Foto toraks PA',
    'Radiologi · kode tindakan belum dipetakan',
    'Proyeksi PA · posisi tegak',
    null,
    150_000,
    'Tidak ada foto toraks dalam 30 hari.',
    { keywords: 'foto toraks rontgen thorax radiologi' },
  ),
  item(
    'usg-abdomen',
    'radiologi',
    'USG abdomen',
    'Radiologi · ICD-9-CM 88.76',
    'Puasa 6 jam · evaluasi hepatobilier',
    icd9('88.76'),
    350_000,
    'Jadwal radiologi tersedia hari ini.',
    { keywords: 'usg abdomen ultrasonografi perut' },
  ),
  item(
    'ekg',
    'tindakan',
    'EKG 12 sadapan',
    'Tindakan · ICD-9-CM 89.52',
    'Dikerjakan sebelum pasien pulang',
    icd9('89.52'),
    85_000,
    'Tidak ada EKG dalam 3 bulan.',
    { keywords: 'ekg elektrokardiogram jantung' },
  ),
  item(
    'ekokardiografi',
    'tindakan',
    'Ekokardiografi',
    'Tindakan · ICD-9-CM 88.72',
    'Evaluasi fungsi ventrikel kiri',
    icd9('88.72'),
    650_000,
    'Jadwal ekokardiografi tersedia besok.',
    { keywords: 'ekokardiografi echo jantung' },
  ),
  item(
    'agd',
    'tindakan',
    'Analisa gas darah arteri',
    'Tindakan · ICD-9-CM 89.65',
    'Arteri radialis · bila SpO2 < 94%',
    icd9('89.65'),
    275_000,
    NO_DUP,
    { priority: 'cito', keywords: 'agd analisa gas darah arteri' },
  ),
  item(
    'surat-kontrol',
    'kontrol',
    'Surat kontrol 4 minggu',
    'Tindak lanjut · BPJS',
    'Kontrol Senin 2 Nov 2026 · Poli Penyakit Dalam',
    null,
    0,
    'Kuota tersedia, terkirim ke aplikasi pasien.',
    { keywords: 'surat kontrol tindak lanjut' },
  ),
  item(
    'rujuk-balik',
    'kontrol',
    'Rujuk balik ke FKTP (PRB)',
    'Tindak lanjut · BPJS',
    'Obat PRB 30 hari · evaluasi di RS 3 bulan lagi',
    null,
    0,
    'Diagnosis termasuk program rujuk balik.',
    { keywords: 'rujuk balik prb fktp' },
  ),
];

/** Obat: KFA hanya bila ada di rujukan seed; selain itu `null` ("KFA belum dipetakan"). */
function drug(
  id: string,
  name: string,
  group: string,
  detail: string,
  code: CpoeCatalogItem['code'],
  tariff: number,
  substance: string,
  classes: string[],
  note = 'Tidak ada interaksi dengan obat lain di daftar.',
  extra: Partial<CpoeCatalogItem> = {},
): CpoeCatalogItem {
  const kfaLabel = code ? `KFA ${code.code}` : 'KFA belum dipetakan';
  return item(id, 'obat', name, `Obat · Fornas · ${group} · ${kfaLabel}`, detail, code, tariff, note, {
    substance,
    classes,
    keywords: `${substance} ${classes.join(' ')} ${group}`,
    ...extra,
  });
}

const NOT_BETALACTAM = 'Bukan beta-laktam: aman dengan alergi penisilin.';

const DRUG_ITEMS: CpoeCatalogItem[] = [
  drug(
    'amlodipin-5',
    'Amlodipin 5 mg tablet',
    'antihipertensi',
    '1 × 1 pagi · oral · 30 tablet · indikasi I10',
    null,
    45_000,
    'amlodipin',
    ['ccb'],
  ),
  drug(
    'amlodipin-10',
    'Amlodipin 10 mg tablet',
    'antihipertensi',
    '1 × 1 pagi · oral · 30 tablet · indikasi I10',
    null,
    60_000,
    'amlodipin',
    ['ccb'],
  ),
  drug(
    'bisoprolol-2-5',
    'Bisoprolol 2,5 mg tablet',
    'beta-bloker',
    '1 × 1 pagi · oral · pantau nadi',
    kfa('93000655'),
    60_000,
    'bisoprolol',
    ['beta-bloker'],
  ),
  drug(
    'metformin-500',
    'Metformin 500 mg tablet',
    'antidiabetik',
    '2 × 1 sesudah makan · oral · 60 tablet · indikasi E11.9',
    null,
    36_000,
    'metformin',
    ['biguanid'],
    'eGFR ≥ 45: dosis aman.',
  ),
  drug(
    'metformin-1000',
    'Metformin 1000 mg tablet',
    'antidiabetik',
    '2 × 1 sesudah makan · oral · indikasi E11.9',
    null,
    60_000,
    'metformin',
    ['biguanid'],
    'eGFR ≥ 45: dosis aman.',
  ),
  drug(
    'glimepirid-2',
    'Glimepirid 2 mg tablet',
    'sulfonilurea',
    '1 × 1 sebelum makan pagi · oral · indikasi E11.9',
    null,
    45_000,
    'glimepirid',
    ['sulfonilurea'],
  ),
  drug(
    'atorvastatin-20',
    'Atorvastatin 20 mg tablet',
    'statin',
    '1 × 1 malam · oral · indikasi E78.5',
    null,
    90_000,
    'atorvastatin',
    ['statin'],
  ),
  drug(
    'atorvastatin-40',
    'Atorvastatin 40 mg tablet',
    'statin',
    '1 × 1 malam · oral · indikasi E78.5',
    kfa('93000914'),
    120_000,
    'atorvastatin',
    ['statin'],
  ),
  drug(
    'klopidogrel-75',
    'Klopidogrel 75 mg tablet',
    'antiplatelet',
    'Dosis muat 300 mg (4 tablet), lanjut 1 × 75 mg',
    kfa('93000387'),
    40_000,
    'klopidogrel',
    ['antiplatelet'],
    'Tidak ada riwayat perdarahan aktif.',
    { priority: 'cito' },
  ),
  drug(
    'asetosal-160',
    'Asetosal 160 mg tablet kunyah',
    'antiplatelet',
    'Dosis muat · dikunyah · 1 kali',
    null,
    5_000,
    'asetosal',
    ['antiplatelet'],
    'Tidak ada riwayat perdarahan aktif.',
    { priority: 'cito' },
  ),
  drug(
    'isdn-5',
    'Isosorbid dinitrat 5 mg sublingual',
    'nitrat',
    'Bila nyeri dada · maksimal 3 kali',
    null,
    8_000,
    'isosorbid dinitrat',
    ['nitrat'],
    'TD terakhir memadai untuk nitrat.',
    { priority: 'cito' },
  ),
  drug(
    'enoksaparin-60',
    'Enoksaparin 60 mg/0,6 mL injeksi',
    'antikoagulan · high alert',
    '2 × 60 mg subkutan · verifikasi ganda',
    kfa('93002210'),
    180_000,
    'enoksaparin',
    ['antikoagulan'],
    'Obat high alert: verifikasi ganda sebelum pemberian.',
  ),
  drug(
    'omeprazol-20',
    'Omeprazol 20 mg kapsul',
    'PPI',
    '1 × 1 sebelum makan pagi · oral',
    null,
    45_000,
    'omeprazol',
    ['ppi'],
  ),
  drug(
    'omeprazol-40-inj',
    'Omeprazol 40 mg injeksi',
    'PPI',
    '1 × 40 mg IV',
    kfa('93001152'),
    35_000,
    'omeprazol',
    ['ppi'],
  ),
  drug(
    'pantoprazol-40',
    'Pantoprazol 40 mg tablet',
    'PPI',
    '1 × 1 sebelum makan pagi · oral',
    null,
    60_000,
    'pantoprazol',
    ['ppi'],
    'Tidak berinteraksi bermakna dengan klopidogrel.',
  ),
  drug(
    'antasida',
    'Antasida doen suspensi',
    'antasida',
    '3 × 1 sendok takar · sebelum makan',
    null,
    15_000,
    'antasida',
    ['antasida'],
  ),
  drug(
    'amoksisilin-500',
    'Amoksisilin 500 mg kapsul',
    'antibiotik penisilin',
    '3 × 1 · oral · 5 hari · 15 kapsul',
    null,
    25_000,
    'amoksisilin',
    ['penisilin'],
  ),
  drug(
    'sefadroksil-500',
    'Sefadroksil 500 mg kapsul',
    'sefalosporin gen. 1',
    '2 × 1 · oral · 5 hari · 10 kapsul',
    null,
    40_000,
    'sefadroksil',
    ['sefalosporin-1'],
  ),
  drug(
    'seftriakson-2g',
    'Seftriakson 2 g injeksi',
    'sefalosporin gen. 3',
    '1 × 2 g IV · 5–7 hari',
    null,
    85_000,
    'seftriakson',
    ['sefalosporin-3'],
  ),
  drug(
    'klindamisin-300',
    'Klindamisin 300 mg kapsul',
    'linkosamid',
    '3 × 1 · oral · 5 hari · 15 kapsul',
    null,
    60_000,
    'klindamisin',
    ['linkosamid'],
    NOT_BETALACTAM,
  ),
  drug(
    'azitromisin-500',
    'Azitromisin 500 mg tablet',
    'makrolid',
    '1 × 1 · oral · 3 hari · 3 tablet',
    null,
    45_000,
    'azitromisin',
    ['makrolid'],
    NOT_BETALACTAM,
  ),
  drug(
    'ibuprofen-400',
    'Ibuprofen 400 mg tablet',
    'AINS',
    '3 × 1 sesudah makan · bila nyeri',
    null,
    15_000,
    'ibuprofen',
    ['ains'],
  ),
  drug(
    'asam-mefenamat-500',
    'Asam mefenamat 500 mg tablet',
    'AINS',
    '3 × 1 sesudah makan · bila nyeri',
    null,
    15_000,
    'asam mefenamat',
    ['ains'],
  ),
  drug(
    'parasetamol-500',
    'Parasetamol 500 mg tablet',
    'analgetik-antipiretik',
    '3 × 1 bila demam atau nyeri · oral',
    null,
    10_000,
    'parasetamol',
    ['analgetik'],
    'Dosis harian di bawah batas aman.',
  ),
  drug(
    'allopurinol-100',
    'Allopurinol 100 mg tablet',
    'antigout',
    '1 × 1 sesudah makan · 30 tablet · indikasi M10.9',
    null,
    30_000,
    'allopurinol',
    ['antigout'],
  ),
  drug(
    'kolkisin-0-5',
    'Kolkisin 0,5 mg tablet',
    'antigout',
    '2 × 1 · 7 hari · saat serangan',
    null,
    40_000,
    'kolkisin',
    ['antigout'],
  ),
  drug(
    'kalsium-glukonat',
    'Kalsium glukonat 10% injeksi',
    'elektrolit',
    'IV 10 mL dalam 10 menit · monitor EKG',
    null,
    25_000,
    'kalsium glukonat',
    ['elektrolit'],
    'Stabilisasi membran jantung pada hiperkalemia.',
    { priority: 'cito' },
  ),
  drug(
    'insulin-dekstrosa',
    'Insulin reguler 10 IU + dekstrosa 40%',
    'insulin · high alert',
    'IV bolus · cek gula darah tiap jam',
    null,
    70_000,
    'insulin',
    ['insulin'],
    'Obat high alert: verifikasi ganda, pantau gula darah.',
    { priority: 'cito' },
  ),
];

export const CPOE_CATALOG: readonly CpoeCatalogItem[] = [...LAB_ITEMS, ...OTHER_ITEMS, ...DRUG_ITEMS];

export function catalogItem(id: string): CpoeCatalogItem {
  const found = CPOE_CATALOG.find((c) => c.id === id);
  if (!found) throw new Error(`Item katalog ${id} tidak ada`);
  return found;
}

export const CPOE_ORDER_SETS: readonly CpoeOrderSet[] = [
  {
    id: 'kontrol-ht-dm',
    name: 'Kontrol hipertensi + DM tipe 2',
    meta: '6 item · PPK Penyakit Dalam 2026',
    itemIds: ['hba1c', 'lipid', 'kreatinin', 'amlodipin-10', 'metformin-500', 'surat-kontrol'],
  },
  {
    id: 'nyeri-dada',
    name: 'Nyeri dada akut (SKA)',
    meta: '9 item · alur IGD',
    itemIds: [
      'ekg',
      'troponin',
      'elektrolit',
      'darah-lengkap',
      'ureum',
      'kreatinin',
      'foto-toraks',
      'asetosal-160',
      'isdn-5',
    ],
  },
  {
    id: 'pneumonia',
    name: 'Pneumonia komunitas',
    meta: '8 item · PPK Paru 2026',
    itemIds: [
      'darah-lengkap',
      'crp',
      'foto-toraks',
      'agd',
      'elektrolit',
      'seftriakson-2g',
      'azitromisin-500',
      'parasetamol-500',
    ],
  },
  {
    id: 'pra-operasi',
    name: 'Pra-operasi elektif dewasa',
    meta: '7 item · alur bedah elektif',
    itemIds: ['darah-lengkap', 'golongan-darah', 'gds', 'kreatinin', 'elektrolit', 'ekg', 'foto-toraks'],
  },
];

// ---------------------------------------------------------------------------------------------------------------
// Poli Penyakit Dalam hari ini (pasien non-skenario)
// ---------------------------------------------------------------------------------------------------------------

export const POLI_KODE = 'PD';
export const POLI_DOKTER = STAF.dpjpPenyakitDalam;

const VITAL_META: Record<PoliVital['id'], { label: string; unit: string }> = {
  td: { label: 'Tekanan darah', unit: 'mmHg' },
  nadi: { label: 'Nadi', unit: 'x/mnt' },
  suhu: { label: 'Suhu', unit: '°C' },
  napas: { label: 'Napas', unit: 'x/mnt' },
  spo2: { label: 'SpO2', unit: '%' },
  berat: { label: 'Berat', unit: 'kg' },
  gds: { label: 'GDS', unit: 'mg/dL' },
};

function vital(
  id: PoliVital['id'],
  value: string,
  note: string,
  flag: PoliVital['flag'] = 'normal',
): PoliVital {
  return { id, ...VITAL_META[id], value, note, flag };
}

type Row<T extends unknown[]> = readonly [...T];

/** Isi kunjungan poli; nomor antrean dan status diambil dari roster (`ANTREAN_POLI_PD`). */
interface PoliFixture {
  patientId: string;
  waitNote: string;
  sep: string | null;
  fallRisk: string;
  stage: number;
  vitalsAt: string | null;
  vitals: PoliVital[];
  cdsNote: string;
  s: string;
  o: string;
  times: Row<[created: string | null, saved: string | null, signed: string | null]>;
  dx: string[];
  plan: Array<
    Row<[kind: PoliEncounter['plan'][number]['kind'], text: string, note: string, attention?: boolean]>
  >;
  labDate: string | null;
  labs: Array<
    Row<[name: string, value: string, flag: EncounterLab['flag'], ref: string, loinc: string | null]>
  >;
  meds: Array<Row<[name: string, since: string]>>;
  history: Array<Row<[when: string, what: string]>>;
}

const POLI_FIXTURES: readonly PoliFixture[] = [
  {
    patientId: PATIENT_ID.lukman,
    waitNote: 'selesai 08.50',
    sep: '0301R0011026V005096',
    fallRisk: 'Risiko jatuh rendah',
    stage: 5,
    vitalsAt: '08.25',
    vitals: [
      vital('td', '134/84', 'sebelumnya 136/86'),
      vital('nadi', '78', 'sebelumnya 80'),
      vital('suhu', '36,6', 'sebelumnya 36,5'),
      vital('napas', '18', 'sebelumnya 18'),
      vital('spo2', '98', 'sebelumnya 98'),
      vital('berat', '76', 'IMT 26,3'),
      vital('gds', '168', 'sebelumnya 182', 'tinggi'),
    ],
    cdsNote: 'Kunjungan sudah ditandatangani. Tidak ada peringatan klinis terbuka.',
    s: 'Kontrol DM bulanan. Tidak ada keluhan; gula darah di rumah 140–170 mg/dL.',
    o: 'Kompos mentis. Kaki: sensasi monofilamen baik, tidak ada luka.',
    times: ['08.40', '08.46', '08.50'],
    dx: ['E11.9'],
    plan: [
      ['OBAT', 'Metformin 500 mg · 2×1 sesudah makan · 7 hari', 'Diserahkan farmasi'],
      ['KONTROL', 'Kontrol 1 minggu dengan hasil HbA1c', 'Surat kontrol dibuat'],
    ],
    labDate: '7 Sep 2026',
    labs: [
      ['HbA1c', '7,6 %', 'H', '< 7', '4548-4'],
      ['Kreatinin', '1,0 mg/dL', '', '0,7–1,3', '2160-0'],
    ],
    meds: [['Metformin 500 mg · 2×1', 'sejak 2023']],
    history: [
      ['7 Sep 2026 · Poli PD', 'E11.9 · kontrol DM'],
      ['3 Agu 2026 · Poli PD', 'E11.9'],
    ],
  },
  {
    patientId: PATIENT_ID.fransiska,
    waitNote: 'selesai 09.02',
    sep: null,
    fallRisk: 'Risiko jatuh rendah',
    stage: 5,
    vitalsAt: '08.30',
    vitals: [
      vital('td', '132/86', 'sebelumnya 130/84'),
      vital('nadi', '84', 'sebelumnya 82'),
      vital('suhu', '36,7', 'sebelumnya 36,6'),
      vital('napas', '18', 'sebelumnya 18'),
      vital('spo2', '98', 'sebelumnya 99'),
      vital('berat', '88', 'IMT 32,2'),
    ],
    cdsNote: 'Kunjungan sudah ditandatangani. Tidak ada peringatan klinis terbuka.',
    s: 'Nyeri sendi jari kaki hilang timbul; kontrol asam urat.',
    o: 'Tidak ada tanda radang sendi akut. Obesitas sentral.',
    times: ['08.52', '08.58', '09.02'],
    dx: ['M10.9'],
    plan: [
      ['LAB', 'Asam urat, kreatinin, darah lengkap', 'Sampel diambil 09.05'],
      ['OBAT', 'Allopurinol 100 mg · 1×1 · 14 hari', 'Diserahkan farmasi'],
      ['KONTROL', 'Kontrol 2 minggu dengan hasil lab', 'Edukasi diet rendah purin'],
    ],
    labDate: '20 Agu 2026',
    labs: [
      ['Kreatinin', '0,8 mg/dL', '', '0,6–1,1', '2160-0'],
      ['Kolesterol total', '226 mg/dL', 'H', '< 200', '2093-3'],
    ],
    meds: [],
    history: [['20 Agu 2026 · Poli PD', 'M10.9 · edukasi diet']],
  },
  {
    patientId: PATIENT_ID.ayu,
    waitNote: 'selesai 09.14',
    sep: null,
    fallRisk: 'Risiko jatuh rendah',
    stage: 5,
    vitalsAt: '08.45',
    vitals: [
      vital('td', '118/76', 'sebelumnya 115/75'),
      vital('nadi', '88', 'sebelumnya 80'),
      vital('suhu', '37,4', 'sebelumnya 36,6'),
      vital('napas', '18', 'sebelumnya 18'),
      vital('spo2', '98', 'sebelumnya 99'),
      vital('berat', '61', 'IMT 23,8'),
    ],
    cdsNote: 'Kunjungan sudah ditandatangani. Tidak ada peringatan klinis terbuka.',
    s: 'Batuk pilek 4 hari, tanpa demam tinggi.',
    o: 'Faring hiperemis ringan. Paru bersih.',
    times: ['09.04', '09.10', '09.14'],
    dx: ['J06.9'],
    plan: [
      ['LAB', 'Darah lengkap, CRP', 'Hasil dalam batas normal'],
      ['OBAT', 'Parasetamol 500 mg · 3×1 bila perlu · 10 tablet', 'Diserahkan farmasi'],
      ['KONTROL', 'Kontrol bila keluhan menetap lebih dari 7 hari', 'Edukasi diberikan'],
    ],
    labDate: null,
    labs: [],
    meds: [],
    history: [
      ['Hari ini · Poli PD', 'J06.9 · selesai 09.14'],
      ['5 Jan 2026 · Poli Umum', 'J06.9'],
    ],
  },
  {
    patientId: PATIENT_ID.wahyuni,
    waitNote: 'selesai 09.40',
    sep: '0301R0011026V005087',
    fallRisk: 'Risiko jatuh rendah',
    stage: 5,
    vitalsAt: '09.00',
    vitals: [
      vital('td', '150/95', '↑ dari 142/90', 'tinggi'),
      vital('nadi', '88', 'sebelumnya 84'),
      vital('suhu', '36,8', 'sebelumnya 36,6'),
      vital('napas', '20', 'sebelumnya 18'),
      vital('spo2', '97', 'sebelumnya 98'),
      vital('berat', '72', 'IMT 28,1'),
    ],
    cdsNote:
      'Kunjungan sudah ditandatangani. Dosis amlodipin dinaikkan dari 5 mg ke 10 mg; tidak ditemukan interaksi dengan obat aktif.',
    s: 'Pusing dan tengkuk terasa berat sejak 3 hari. Kontrol rutin hipertensi.',
    o: 'Kompos mentis. TD 150/95 mmHg. Pemeriksaan fisik lain dalam batas normal.',
    times: ['09.26', '09.34', '09.40'],
    dx: ['I10', 'E78.5'],
    plan: [
      ['LAB', 'Profil lipid, kreatinin', 'Sampel diambil 09.45'],
      ['OBAT', 'Amlodipin 10 mg · 1×1 pagi · 30 tablet', 'Dosis naik dari 5 mg · resep PRB di farmasi', true],
      ['OBAT', 'Atorvastatin 20 mg · 1×1 malam · 30 tablet', 'Lanjutkan · resep PRB di farmasi'],
      ['KONTROL', 'Kontrol 4 minggu · surat kontrol BPJS', 'Dibuat otomatis'],
    ],
    labDate: '12 Sep 2026',
    labs: [
      ['Kolesterol LDL', '152 mg/dL', 'H', '< 100', '13457-7'],
      ['Kolesterol total', '236 mg/dL', 'H', '< 200', '2093-3'],
      ['Kreatinin', '0,9 mg/dL', '', '0,6–1,1', '2160-0'],
    ],
    meds: [
      ['Amlodipin 5 mg · 1×1 pagi', 'sejak Agu 2026'],
      ['Atorvastatin 20 mg · 1×1 malam', 'sejak Mar 2025'],
    ],
    history: [
      ['12 Sep 2026 · Poli PD', 'I10, E78.5 · amlodipin dimulai'],
      ['14 Agu 2026 · Poli PD', 'I10'],
      ['3 Jun 2026 · Lab', 'Profil lipid'],
    ],
  },
  {
    patientId: PATIENT_ID.rohana,
    waitNote: 'mulai 10.31',
    sep: '0301R0011026V005091',
    fallRisk: 'Risiko jatuh sedang',
    stage: 2,
    vitalsAt: '07.36',
    vitals: [
      vital('td', '132/84', 'sebelumnya 130/82'),
      vital('nadi', '92', 'sebelumnya 104'),
      vital('suhu', '37,2', 'sebelumnya 38,4'),
      vital('napas', '20', 'sebelumnya 24'),
      vital('spo2', '96', 'sebelumnya 93'),
      vital('berat', '64', 'IMT 25,6'),
    ],
    cdsNote:
      'Alergi amoksisilin tercatat: golongan penisilin dan sefalosporin generasi 1 diblokir CDS. Makrolid atau linkosamid aman.',
    s: 'Kontrol pasca rawat inap pneumonia. Batuk berkurang, tidak demam. Gula darah di rumah 150–180 mg/dL.',
    o: '',
    times: ['10.31', null, null],
    dx: [],
    plan: [],
    labDate: '20 Sep 2026',
    labs: [
      ['Leukosit', '11.800 /µL', 'H', '4.000–10.000', '6690-2'],
      ['CRP', '24 mg/L', 'H', '< 5', '1988-5'],
      ['Hemoglobin', '12,4 g/dL', '', '12–16', '718-7'],
    ],
    meds: [
      ['Metformin 500 mg · 2×1', 'sejak 2022'],
      ['Azitromisin 500 mg · 1×1', 'selesai 23 Sep 2026'],
    ],
    history: [
      ['20 Sep 2026 · Rawat inap', 'J18.9 · pulang membaik'],
      ['2 Jun 2026 · Poli PD', 'E11.9 · kontrol DM'],
    ],
  },
  {
    patientId: PATIENT_ID.darmawan,
    waitNote: 'tunggu 27 mnt',
    sep: null,
    fallRisk: 'Risiko jatuh rendah',
    stage: 2,
    vitalsAt: '10.18',
    vitals: [
      vital('td', '128/82', 'sebelumnya 126/80'),
      vital('nadi', '80', 'sebelumnya 78'),
      vital('suhu', '36,6', 'sebelumnya 36,5'),
      vital('napas', '18', 'sebelumnya 18'),
      vital('spo2', '98', 'sebelumnya 98'),
      vital('berat', '81', 'IMT 27,4'),
    ],
    cdsNote:
      'Alergi ibuprofen tercatat. Hindari AINS (ibuprofen, asam mefenamat); parasetamol dan kolkisin dapat dipakai.',
    s: 'Nyeri dan bengkak ibu jari kaki kanan sejak 2 hari. Nyeri ulu hati bila telat makan.',
    o: '',
    times: [null, null, null],
    dx: [],
    plan: [],
    labDate: '14 Agu 2026',
    labs: [
      ['Kreatinin', '1,0 mg/dL', '', '0,7–1,3', '2160-0'],
      ['Ureum', '28 mg/dL', '', '15–40', '3094-0'],
      ['Kolesterol total', '214 mg/dL', 'H', '< 200', '2093-3'],
    ],
    meds: [['Allopurinol 100 mg · 1×1', 'sejak Agu 2026']],
    history: [
      ['14 Agu 2026 · Poli PD', 'M10.9 · allopurinol dimulai'],
      ['3 Feb 2026 · Poli PD', 'K30 · dispepsia'],
    ],
  },
  {
    patientId: PATIENT_ID.dewi,
    waitNote: 'hasil lab dan USG',
    sep: '0301R0011026V005095',
    fallRisk: 'Risiko jatuh rendah',
    stage: 3,
    vitalsAt: '08.50',
    vitals: [
      vital('td', '124/78', 'sebelumnya 120/80'),
      vital('nadi', '76', 'sebelumnya 74'),
      vital('suhu', '36,5', 'sebelumnya 36,6'),
      vital('napas', '16', 'sebelumnya 16'),
      vital('spo2', '99', 'sebelumnya 99'),
      vital('berat', '58', 'IMT 22,7'),
    ],
    cdsNote:
      'Menunggu hasil darah lengkap dan ekspertise USG sebelum asesmen akhir. Tidak ada peringatan klinis terbuka.',
    s: 'Nyeri ulu hati, kembung, dan mual sejak 2 minggu; memburuk setelah makan pedas.',
    o: 'Nyeri tekan epigastrium ringan. Tanda bahaya (alarm) tidak ada.',
    times: ['09.16', '09.24', null],
    dx: ['K30'],
    plan: [
      ['LAB', 'Darah lengkap', 'Menunggu hasil'],
      ['RAD', 'USG abdomen', 'Pemeriksaan 09.52 · menunggu ekspertise'],
      ['OBAT', 'Omeprazol 20 mg · 1×1 sebelum makan pagi', 'Draf'],
      ['OBAT', 'Antasida doen · 3×1 sendok takar', 'Draf'],
    ],
    labDate: null,
    labs: [],
    meds: [],
    history: [['3 Feb 2026 · Poli PD', 'K30 · dispepsia']],
  },
];

function mustPatient(id: string): DemoPatient {
  const p = patientById(id);
  if (!p) throw new Error(`Pasien ${id} tidak ada di PASIEN`);
  return p;
}

function payerLabel(p: DemoPatient): string {
  if (p.penjamin === 'BPJS') return `BPJS ${p.kelas ?? ''}`.trim();
  if (p.penjamin === 'Asuransi') return `Asuransi swasta${p.kelas ? ` · ${p.kelas}` : ''}`;
  return 'Umum · bayar mandiri';
}

export function klinisPatient(p: DemoPatient, sep: string | null, fallRisk: string): KlinisPatient {
  return {
    id: p.id,
    name: p.nama,
    sex: p.jk,
    ageYears: p.umur,
    birthDate: p.tanggalLahir,
    rm: p.rm,
    nikMasked: p.nikMasked,
    allergies: [...p.alergi],
    payer: p.penjamin,
    payerLabel: payerLabel(p),
    sep,
    fallRisk,
    history: p.riwayat,
  };
}

const POLI_NAME = `Poli ${poliByCode(POLI_KODE)?.name ?? 'Penyakit Dalam'}`;

function documents(
  payer: DemoPatient['penjamin'],
  sep: string | null,
  signed: boolean,
): PoliEncounter['documents'] {
  const bpjs = payer === 'BPJS';
  return [
    { name: 'Persetujuan umum', value: 'Ditandatangani', done: true },
    bpjs
      ? { name: 'SEP BPJS', value: sep ? 'Terbit' : 'Belum terbit', done: Boolean(sep) }
      : { name: 'Penjaminan', value: payer === 'Asuransi' ? 'Terverifikasi' : 'Umum', done: true },
    {
      name: bpjs ? 'Surat kontrol' : 'Surat keterangan',
      value: signed ? 'Dibuat' : 'Menunggu',
      done: signed,
    },
  ];
}

function diagnoses(codes: readonly string[]): PoliEncounter['diagnoses'] {
  return codes.map((code, i) => ({
    system: 'ICD-10',
    code,
    display: icd10Display(code) ?? code,
    primary: i === 0,
  }));
}

/** Baris roster antrean Poli PD milik pasien fixture (nomor dan status satu sumber dengan papan TV). */
function antreanOf(patientId: string): AntreanPoli {
  const a = ANTREAN_POLI_PD.find((x) => x.patientId === patientId);
  if (!a) throw new Error(`Pasien ${patientId} tidak ada di ANTREAN_POLI_PD`);
  return a;
}

function fixtureQueueItem(f: PoliFixture): PoliQueueItem {
  const p = mustPatient(f.patientId);
  const a = antreanOf(p.id);
  return {
    patientId: p.id,
    encounterId: encounterIdOf(p.id),
    queueNo: a.no,
    name: p.nama,
    rm: p.rm,
    sex: p.jk,
    ageYears: p.umur,
    payer: p.penjamin,
    status: a.status,
    waitNote: f.waitNote,
    scenario: null,
  };
}

function fixtureEncounter(f: PoliFixture): PoliEncounter {
  const p = mustPatient(f.patientId);
  const [createdAt, savedAt, signedAt] = f.times;
  return {
    encounterId: encounterIdOf(p.id),
    queueNo: antreanOf(p.id).no,
    poliName: POLI_NAME,
    doctor: POLI_DOKTER,
    patient: klinisPatient(p, f.sep, f.fallRisk),
    stage: f.stage,
    vitalsAt: f.vitalsAt,
    vitals: f.vitals,
    cdsNote: f.cdsNote,
    soap: {
      subjective: f.s,
      objective: f.o,
      author: POLI_DOKTER,
      createdAt,
      savedAt,
      signedAt,
      version: signedAt ? 2 : 1,
    },
    diagnoses: diagnoses(f.dx),
    plan: f.plan.map(([kind, text, note, attention]) => ({
      kind,
      text,
      note,
      attention: attention ?? false,
    })),
    labDate: f.labDate,
    labs: f.labs.map(([name, value, flag, reference, code]) => ({
      name,
      value,
      flag,
      reference,
      loinc: code,
    })),
    meds: f.meds.map(([name, since]) => ({ name, since })),
    history: f.history.map(([when, what]) => ({ when, what })),
    documents: documents(p.penjamin, f.sep, Boolean(signedAt)),
  };
}

// ---------------------------------------------------------------------------------------------------------------
// Proyeksi pasien skenario (murni: hanya dari RunResult mesin skenario)
// ---------------------------------------------------------------------------------------------------------------

/** Nilai tugas skenario yang sudah selesai (padanan murni `milestoneValue`). */
export function doneValue(R: RunResult, stepId: string, taskId: string): TaskValue | undefined {
  const i = R.def.steps.findIndex((s) => s.id === stepId);
  return i < 0 ? undefined : R.done.get(taskKey(i, taskId));
}

/** Jam selesai tugas skenario (`07.52`), atau null. */
function doneJam(R: RunResult, stepId: string, taskId: string): string | null {
  const i = R.def.steps.findIndex((s) => s.id === stepId);
  const at = i < 0 ? undefined : R.doneAt.get(taskKey(i, taskId));
  return at === undefined ? null : minutesToJam(at);
}

/** Hasil penunjang skenario (teks rekam medis mesin) → baris hasil berkode LOINC seed. */
const SCENARIO_LABS: Readonly<Record<string, EncounterLab>> = {
  'HbA1c 8,4% (tinggi)': { name: 'HbA1c', value: '8,4 %', flag: 'H', reference: '< 5,7', loinc: '4548-4' },
  'LDL 142 mg/dL (tinggi)': {
    name: 'Kolesterol LDL',
    value: '142 mg/dL',
    flag: 'H',
    reference: '< 100',
    loinc: '13457-7',
  },
  'Kreatinin 1,1 mg/dL · eGFR 74': {
    name: 'Kreatinin',
    value: '1,1 mg/dL',
    flag: '',
    reference: '0,7–1,3 · eGFR 74',
    loinc: '2160-0',
  },
  'Kalium 6,8 mmol/L (KRITIS)': {
    name: 'Kalium',
    value: '6,8 mmol/L',
    flag: 'K',
    reference: '3,5–5,1',
    loinc: '2823-3',
  },
  'Troponin I meningkat': {
    name: 'Troponin I',
    value: 'meningkat',
    flag: 'H',
    reference: '< 0,04 ng/mL',
    loinc: '10839-9',
  },
  'Kreatinin 1,8 mg/dL · eGFR 38': {
    name: 'Kreatinin',
    value: '1,8 mg/dL',
    flag: 'H',
    reference: '0,7–1,3 · eGFR 38',
    loinc: '2160-0',
  },
  'EKG: depresi ST V4–V6, T tinggi runcing': {
    name: 'EKG 12 sadapan',
    value: 'depresi ST V4–V6, T tinggi runcing',
    flag: 'A',
    reference: 'irama sinus normal',
    loinc: null,
  },
};

export function scenarioLabs(hasil: readonly string[]): EncounterLab[] {
  return hasil.map(
    (h) => SCENARIO_LABS[h] ?? { name: h, value: 'lihat hasil', flag: '', reference: '', loinc: null },
  );
}

/** Nomor antrean poli Tn. Suryo (naskah Simulasi: SEP terbit → `PD-027`). */
export const SURYO_QUEUE = queueNo(POLI_KODE, 27);
const SURYO = PATIENT_ID.suryo;

const FALL_RISK: Record<string, string> = {
  tidak: 'Tidak berisiko jatuh',
  rendah: 'Risiko jatuh rendah',
  tinggi: 'Risiko jatuh tinggi · gelang kuning',
};

/** Tn. Suryo masuk antrean Poli PD setelah SEP terbit (`pendaftaran.sep`). */
export function suryoQueueItem(rj: RunResult): PoliQueueItem | null {
  if (doneValue(rj, 'pendaftaran', 'sep') === undefined) return null;
  const p = mustPatient(SURYO);
  const tte = doneJam(rj, 'resep', 'tte');
  const panggil = doneJam(rj, 'pemeriksaan-dokter', 'panggil');
  let status: PoliQueueItem['status'] = 'menunggu';
  let waitNote = 'menunggu asesmen perawat';
  if (tte) [status, waitNote] = ['selesai', `selesai ${tte}`];
  else if (doneValue(rj, 'laboratorium', 'validasi') !== undefined)
    [status, waitNote] = ['diperiksa', 'hasil lab siap ditinjau'];
  else if (doneValue(rj, 'pemeriksaan-dokter', 'order') !== undefined)
    [status, waitNote] = ['menunggu-hasil', 'lab berjalan'];
  else if (panggil) [status, waitNote] = ['diperiksa', `mulai ${panggil}`];
  else if (doneValue(rj, 'asesmen-perawat', 'jatuh') !== undefined) waitNote = 'siap diperiksa dokter';
  return {
    patientId: p.id,
    encounterId: encounterIdOf(p.id),
    queueNo: SURYO_QUEUE,
    name: p.nama,
    rm: p.rm,
    sex: p.jk,
    ageYears: p.umur,
    payer: p.penjamin,
    status,
    waitNote,
    scenario: 'rawat-jalan',
  };
}

/** Tanda vital Tn. Suryo dari rekam medis skenario (`rec.ttv`, mis. "TD 138/86 · GDS 212 mg/dL"). */
export function suryoVitals(ttv: string): PoliVital[] {
  const td = /TD (\d{2,3}\/\d{2,3})/.exec(ttv)?.[1];
  const gds = /GDS (\d{1,3})/.exec(ttv)?.[1];
  const bp = td ? parseBloodPressure(td) : null;
  if (!td || !bp) {
    return (['td', 'nadi', 'suhu', 'spo2', 'berat', 'gds'] as const).map((id) =>
      vital(id, '—', 'belum diukur hari ini', 'belum'),
    );
  }
  return [
    vital('td', td, 'sebelumnya 136/84', bloodPressureFlag(bp.sys, bp.dia)),
    vital('nadi', '84', 'sebelumnya 80'),
    vital('suhu', '36,7', 'sebelumnya 36,6'),
    vital('spo2', '98', 'sebelumnya 98'),
    vital('berat', '78', 'IMT 27,0'),
    gds
      ? vital(
          'gds',
          gds,
          Number(gds) >= 200 ? 'ditandai tinggi untuk dokter' : 'glukometer',
          glucoseFlag(Number(gds)),
        )
      : vital('gds', '—', 'menunggu glukometer', 'belum'),
  ];
}

function suryoStage(rj: RunResult): number {
  if (doneValue(rj, 'farmasi', 'serah') !== undefined) return 5;
  if (doneValue(rj, 'resep', 'tte') !== undefined) return 4;
  if (doneValue(rj, 'pemeriksaan-dokter', 'order') !== undefined) return 3;
  if (doneValue(rj, 'asesmen-perawat', 'jatuh') !== undefined) return 2;
  return 1;
}

function suryoCdsNote(rj: RunResult, gdsHigh: boolean): string {
  const cds = doneValue(rj, 'resep', 'cds');
  if (cds === 'ganti')
    return 'Peringatan CDS ditindaklanjuti: glimepirid dihapus, metformin dioptimalkan, evaluasi 1 bulan.';
  if (cds === 'lanjut')
    return 'Override CDS tercatat: glimepirid tetap diberikan dengan edukasi hipoglikemia dan cek gula mandiri.';
  return `Riwayat hipoglikemia berat (2025): sulfonilurea akan diblokir CDS saat resep.${gdsHigh ? ' GDS tinggi dari perawat ditandai untuk dokter.' : ''}`;
}

export function suryoEncounter(rj: RunResult): PoliEncounter {
  const p = mustPatient(SURYO);
  const r = rj.rec;
  const vitals = suryoVitals(r.ttv);
  const td = vitals.find((v) => v.id === 'td');
  const gds = vitals.find((v) => v.id === 'gds');
  const tte = doneJam(rj, 'resep', 'tte');
  const plan: PoliEncounter['plan'] = [];
  if (r.order.length > 0) {
    plan.push({
      kind: 'LAB',
      text: r.order.join(', '),
      note: r.hasil.length ? 'Hasil keluar' : 'Order terkirim',
      attention: false,
    });
  }
  for (const o of r.obat) {
    plan.push({
      kind: 'OBAT',
      text: o,
      note: tte ? 'Terkirim ke farmasi' : 'Draf resep',
      attention: o.startsWith('Glimepirid'),
    });
  }
  if (r.prb)
    plan.push({
      kind: 'KONTROL',
      text: 'Program rujuk balik · obat PRB 30 hari di FKTP',
      note: 'BPJS PRB',
      attention: false,
    });
  if (r.kontrol) plan.push({ kind: 'KONTROL', text: r.kontrol, note: 'Terjadwal', attention: false });
  const labs = scenarioLabs(r.hasil);
  const jatuh = doneValue(rj, 'asesmen-perawat', 'jatuh');
  return {
    encounterId: encounterIdOf(p.id),
    queueNo: SURYO_QUEUE,
    poliName: POLI_NAME,
    doctor: POLI_DOKTER,
    patient: klinisPatient(
      p,
      r.sep || null,
      typeof jatuh === 'string'
        ? (FALL_RISK[jatuh] ?? 'Risiko jatuh rendah')
        : 'Skrining risiko jatuh belum dilakukan',
    ),
    stage: suryoStage(rj),
    vitalsAt: doneJam(rj, 'asesmen-perawat', 'td'),
    vitals,
    cdsNote: suryoCdsNote(rj, gds?.flag === 'tinggi'),
    soap: {
      subjective:
        'Kontrol DM tipe 2. Sering haus dan buang air kecil malam hari sejak 2 minggu. Riwayat hipoglikemia berat 2025.',
      objective:
        td && td.flag !== 'belum'
          ? `Kompos mentis. TD ${td.value} mmHg. GDS ${gds?.value ?? '—'} mg/dL (glukometer). Pemeriksaan fisik lain dalam batas normal.`
          : '',
      author: POLI_DOKTER,
      createdAt: doneJam(rj, 'pemeriksaan-dokter', 'panggil'),
      savedAt: doneJam(rj, 'pemeriksaan-dokter', 'dx'),
      signedAt: tte,
      version: tte ? 2 : 1,
    },
    diagnoses: diagnoses(r.dx.map((d) => d.split(' · ')[0] ?? d)),
    plan,
    labDate: labs.length ? 'Hari ini' : '6 Jul 2026',
    labs: labs.length
      ? labs
      : [
          { name: 'HbA1c', value: '7,6 %', flag: 'H', reference: '< 5,7', loinc: '4548-4' },
          { name: 'Kreatinin', value: '1,0 mg/dL', flag: '', reference: '0,7–1,3', loinc: '2160-0' },
        ],
    meds: tte
      ? r.obat.map((name) => ({ name, since: 'mulai hari ini' }))
      : [{ name: 'Metformin 500 mg · 2×1', since: 'sejak 2018' }],
    history: [
      { when: '6 Jul 2026 · Poli PD', what: 'E11.9 · HbA1c 7,6%' },
      { when: 'Mar 2025 · IGD', what: 'Hipoglikemia berat · glimepirid dihentikan' },
    ],
    documents: documents('BPJS', r.sep || null, Boolean(tte)),
  };
}

/**
 * Antrean Poli PD hari ini (urut nomor roster): pasien fiktif + Tn. Suryo bila SEP-nya sudah terbit. Setelah DPJP
 * memanggil PD-027 (skenario), pasien yang sedang diperiksa sudah dikirim ke penunjang, jadi hanya satu pasien di
 * ruang periksa (selaras papan TV).
 */
export function demoPoliWorklist(rj: RunResult): PoliWorklist {
  const poli = poliByCode(POLI_KODE);
  const order = (no: string) => ANTREAN_POLI_PD.findIndex((a) => a.no === no);
  const suryo = suryoQueueItem(rj);
  const suryoCalled = suryo !== null && suryo.status !== 'menunggu';
  const items = [...POLI_FIXTURES]
    .map(fixtureQueueItem)
    .sort((a, b) => order(a.queueNo) - order(b.queueNo))
    .map((q) =>
      suryoCalled && q.status === 'diperiksa'
        ? { ...q, status: 'menunggu-hasil' as const, waitNote: 'penunjang berjalan' }
        : q,
    );
  if (suryo) items.push(suryo);
  return {
    poli: { code: POLI_KODE, name: POLI_NAME, room: poli?.room ?? 'Ruang 2' },
    doctor: POLI_DOKTER,
    date: DEMO_TODAY,
    items,
  };
}

/** Ringkasan kunjungan poli; null bila pasien tidak ada di antrean hari ini. */
export function demoPoliEncounter(patientId: string, rj: RunResult): PoliEncounter | null {
  if (patientId === SURYO) return suryoQueueItem(rj) ? suryoEncounter(rj) : null;
  const f = POLI_FIXTURES.find((x) => x.patientId === patientId);
  return f ? fixtureEncounter(f) : null;
}

// ---------------------------------------------------------------------------------------------------------------
// CPOE per kunjungan
// ---------------------------------------------------------------------------------------------------------------

type ActiveMed = CpoeContext['activeMeds'][number];
const med = (name: string, substance: string, catalogId: string | null): ActiveMed => ({
  name,
  substance,
  catalogId,
});

interface CpoeFixture {
  weightKg: number;
  egfr: number | null;
  activeMeds: ActiveMed[];
  orders: Array<Row<[catalogId: string, status: CpoeOrder['status']]>>;
}

const CPOE_FIXTURES: Readonly<Record<string, CpoeFixture>> = {
  [PATIENT_ID.lukman]: {
    weightKg: 76,
    egfr: 84,
    activeMeds: [med('Metformin 500 mg · 2×1', 'metformin', 'metformin-500')],
    orders: [
      ['hba1c', 'terkirim'],
      ['metformin-500', 'terkirim'],
      ['surat-kontrol', 'terkirim'],
    ],
  },
  [PATIENT_ID.fransiska]: {
    weightKg: 88,
    egfr: 90,
    activeMeds: [],
    orders: [
      ['kreatinin', 'terkirim'],
      ['darah-lengkap', 'terkirim'],
      ['allopurinol-100', 'terkirim'],
    ],
  },
  [PATIENT_ID.ayu]: {
    weightKg: 61,
    egfr: null,
    activeMeds: [],
    orders: [
      ['darah-lengkap', 'terkirim'],
      ['crp', 'terkirim'],
      ['parasetamol-500', 'terkirim'],
    ],
  },
  [PATIENT_ID.wahyuni]: {
    weightKg: 72,
    egfr: 82,
    activeMeds: [
      med('Amlodipin 5 mg · 1×1 pagi', 'amlodipin', 'amlodipin-5'),
      med('Atorvastatin 20 mg · 1×1 malam', 'atorvastatin', 'atorvastatin-20'),
    ],
    orders: [
      ['lipid', 'terkirim'],
      ['kreatinin', 'terkirim'],
      ['amlodipin-10', 'terkirim'],
      ['atorvastatin-20', 'terkirim'],
      ['surat-kontrol', 'terkirim'],
    ],
  },
  [PATIENT_ID.rohana]: {
    weightKg: 64,
    egfr: 71,
    activeMeds: [med('Metformin 500 mg · 2×1', 'metformin', 'metformin-500')],
    orders: [
      ['darah-lengkap', 'draf'],
      ['crp', 'draf'],
      ['foto-toraks', 'draf'],
      ['metformin-500', 'draf'],
    ],
  },
  [PATIENT_ID.darmawan]: {
    weightKg: 81,
    egfr: 88,
    activeMeds: [med('Allopurinol 100 mg · 1×1', 'allopurinol', 'allopurinol-100')],
    orders: [
      ['kreatinin', 'draf'],
      ['allopurinol-100', 'draf'],
      ['kolkisin-0-5', 'draf'],
      ['omeprazol-20', 'draf'],
      ['asam-mefenamat-500', 'draf'],
    ],
  },
  [PATIENT_ID.dewi]: {
    weightKg: 58,
    egfr: 95,
    activeMeds: [],
    orders: [
      ['darah-lengkap', 'terkirim'],
      ['usg-abdomen', 'terkirim'],
      ['omeprazol-20', 'draf'],
      ['antasida', 'draf'],
    ],
  },
};

function line(
  encounterId: string,
  catalogId: string,
  status: CpoeOrder['status'],
  detail?: string,
  override: string | null = null,
): OrderLine {
  const base = catalogItem(catalogId);
  return {
    lineId: `${encounterId}-${catalogId}`,
    item: detail ? { ...base, detail } : base,
    status,
    override,
  };
}

function toOrders(
  lines: readonly OrderLine[],
  ctx: Pick<CpoeContext, 'patient' | 'activeMeds' | 'flags' | 'doctor'>,
): CpoeOrder[] {
  const patient = {
    allergies: ctx.patient.allergies,
    activeMeds: ctx.activeMeds,
    flags: ctx.flags,
    payer: ctx.patient.payer,
  };
  return evaluateOrders(lines, patient, ctx.doctor).map((l) => ({
    id: l.lineId,
    catalogId: l.item.id,
    kind: l.item.kind,
    name: l.item.name,
    detail: l.item.detail,
    code: l.item.code,
    coverage: l.item.coverage,
    priority: l.item.priority,
    tariff: l.item.tariff,
    cds: l.cds,
    status: l.status,
    override: l.override,
  }));
}

function fixtureCpoe(f: PoliFixture, c: CpoeFixture): CpoeContext {
  const p = mustPatient(f.patientId);
  const encounterId = encounterIdOf(p.id);
  const base = {
    encounterId,
    setting: 'rawat-jalan' as const,
    breadcrumb: `Rawat jalan / ${POLI_NAME} / Order & resep`,
    doctor: POLI_DOKTER,
    patient: klinisPatient(p, f.sep, f.fallRisk),
    weightKg: c.weightKg,
    egfr: c.egfr,
    activeMeds: c.activeMeds,
    flags: [],
    catalog: [...CPOE_CATALOG],
    orderSets: [...CPOE_ORDER_SETS],
    results: f.labs.map(([name, value, flag, reference, code]) => ({
      name,
      value,
      flag,
      reference,
      loinc: code,
    })),
  };
  return {
    ...base,
    orders: toOrders(
      c.orders.map(([id, status]) => line(encounterId, id, status)),
      base,
    ),
  };
}

const SURYO_LAB_IDS: Readonly<Record<string, string>> = {
  HbA1c: 'hba1c',
  'Profil lipid': 'lipid',
  Kreatinin: 'kreatinin',
};
const SURYO_DRUG_IDS: ReadonlyArray<Row<[prefix: string, id: string]>> = [
  ['Metformin 1000', 'metformin-1000'],
  ['Glimepirid', 'glimepirid-2'],
  ['Atorvastatin 20', 'atorvastatin-20'],
];

function suryoCpoe(rj: RunResult): CpoeContext {
  const p = mustPatient(SURYO);
  const r = rj.rec;
  const encounterId = encounterIdOf(p.id);
  const sent = doneValue(rj, 'resep', 'tte') !== undefined;
  const cds = doneValue(rj, 'resep', 'cds');
  const lines: OrderLine[] = r.order.flatMap((o) => {
    const id = SURYO_LAB_IDS[o];
    return id ? [line(encounterId, id, 'terkirim')] : [];
  });
  for (const o of r.obat) {
    const id = SURYO_DRUG_IDS.find(([prefix]) => o.startsWith(prefix))?.[1];
    if (!id) continue;
    const override =
      id === 'glimepirid-2' && cds === 'lanjut' ? 'Edukasi hipoglikemia + cek gula darah mandiri' : null;
    lines.push(line(encounterId, id, sent ? 'terkirim' : 'draf', o, override));
  }
  if (r.prb) lines.push(line(encounterId, 'rujuk-balik', sent ? 'terkirim' : 'draf'));
  const egfr = /eGFR (\d+)/.exec(r.hasil.join(' '))?.[1];
  const jatuh = doneValue(rj, 'asesmen-perawat', 'jatuh');
  const base = {
    encounterId,
    setting: 'rawat-jalan' as const,
    breadcrumb: `Rawat jalan / ${POLI_NAME} / Order & resep`,
    doctor: POLI_DOKTER,
    patient: klinisPatient(
      p,
      r.sep || null,
      typeof jatuh === 'string'
        ? (FALL_RISK[jatuh] ?? 'Risiko jatuh rendah')
        : 'Skrining risiko jatuh belum dilakukan',
    ),
    weightKg: 78,
    egfr: egfr ? Number(egfr) : null,
    activeMeds: [med('Metformin 500 mg · 2×1', 'metformin', 'metformin-500')],
    flags: ['hipoglikemia-berat' as const],
    catalog: [...CPOE_CATALOG],
    orderSets: [...CPOE_ORDER_SETS],
    results: scenarioLabs(r.hasil),
  };
  return { ...base, orders: toOrders(lines, base) };
}

const HARTONO = PATIENT_ID.hartono;
const HARTONO_LAB_IDS: Readonly<Record<string, readonly string[]>> = {
  'Troponin I': ['troponin'],
  Elektrolit: ['elektrolit'],
  'Darah lengkap': ['darah-lengkap'],
  'Ureum/kreatinin': ['ureum', 'kreatinin'],
  'Foto toraks': ['foto-toraks'],
};
const HARTONO_DRUG_IDS: ReadonlyArray<Row<[prefix: string, ids: readonly string[]]>> = [
  ['Aspirin', ['asetosal-160']],
  ['ISDN', ['isdn-5']],
  ['Kalsium glukonat 10% IV + insulin', ['kalsium-glukonat', 'insulin-dekstrosa']],
  ['Kalsium glukonat', ['kalsium-glukonat']],
  ['Klopidogrel', ['klopidogrel-75']],
  ['Pantoprazol', ['pantoprazol-40']],
  ['Omeprazol', ['omeprazol-20']],
];

/** Langkah `stepId` skenario sudah dimulai (aktif atau lewat)? */
function stepStarted(R: RunResult, stepId: string): boolean {
  const i = R.def.steps.findIndex((s) => s.id === stepId);
  return R.finished || (i >= 0 && R.step >= i);
}

/** Langkah `tata-laksana` sudah dimulai (aktif atau lewat)? */
function tataLaksanaReached(igd: RunResult): boolean {
  return stepStarted(igd, 'tata-laksana');
}

/**
 * Kunjungan IGD Tn. Hartono terbuka di CPOE sejak langkah `asesmen-dokter` dimulai sampai serah terima
 * `admisi.transfer`; setelah itu order ditulis di rawat inap, sebelum itu pasien belum diperiksa dokter IGD.
 */
export function hartonoCpoeOpen(igd: RunResult): boolean {
  return stepStarted(igd, 'asesmen-dokter') && doneValue(igd, 'admisi', 'transfer') === undefined;
}

function hartonoCpoe(igd: RunResult): CpoeContext {
  const p = mustPatient(HARTONO);
  const r = igd.rec;
  const encounterId = encounterIdOf(p.id);
  const cds = doneValue(igd, 'tata-laksana', 'cds');
  const lines: OrderLine[] = [];
  if (doneValue(igd, 'asesmen-dokter', 'ekg') !== undefined) lines.push(line(encounterId, 'ekg', 'terkirim'));
  for (const o of r.order)
    for (const id of HARTONO_LAB_IDS[o] ?? []) lines.push(line(encounterId, id, 'terkirim'));
  for (const o of r.obat) {
    const ids = HARTONO_DRUG_IDS.find(([prefix]) => o.startsWith(prefix))?.[1] ?? [];
    for (const id of ids) {
      if (lines.some((l) => l.item.id === id)) continue;
      const override =
        id === 'klopidogrel-75' && cds === 'lanjut'
          ? 'Manfaat antiplatelet pada NSTEMI lebih besar; pantau ketat'
          : null;
      lines.push(line(encounterId, id, 'terkirim', o, override));
    }
  }
  // Order antiplatelet tertahan CDS sampai tugas `tata-laksana.cds` ditindaklanjuti (naskah Simulasi).
  if (tataLaksanaReached(igd) && cds === undefined) {
    lines.push(
      line(encounterId, 'klopidogrel-75', 'draf', 'Dosis muat 300 mg (4 tablet) · rencana DPJP jantung'),
    );
  }
  const ppi =
    cds === 'ganti'
      ? med('Pantoprazol 40 mg 1×1', 'pantoprazol', 'pantoprazol-40')
      : med('Omeprazol 20 mg 1×1 (obat rutin)', 'omeprazol', 'omeprazol-20');
  const patient = klinisPatient(p, r.sep || null, 'Risiko jatuh sedang (IGD)');
  const egfr = /eGFR (\d+)/.exec(r.hasil.join(' '))?.[1];
  const base = {
    encounterId,
    setting: 'igd' as const,
    breadcrumb: 'Gawat darurat / IGD / Order & resep',
    doctor: STAF.dokterJagaIgd,
    patient: { ...patient, payerLabel: r.penjamin },
    weightKg: 70,
    egfr: egfr ? Number(egfr) : null,
    activeMeds: [med('Amlodipin 5 mg 1×1 (obat rutin)', 'amlodipin', 'amlodipin-5'), ppi],
    flags: ['ckd' as const],
    catalog: [...CPOE_CATALOG],
    orderSets: [...CPOE_ORDER_SETS],
    results: scenarioLabs(r.hasil),
  };
  return { ...base, orders: toOrders(lines, base) };
}

function poliCpoeFixture(encounterId: string): { f: PoliFixture; c: CpoeFixture } | null {
  const f = POLI_FIXTURES.find((x) => encounterIdOf(x.patientId) === encounterId);
  const c = f ? CPOE_FIXTURES[f.patientId] : undefined;
  return f && c ? { f, c } : null;
}

/**
 * Ada konteks CPOE untuk kunjungan ini saat ini? Padanan murah `demoCpoeContext(…) !== null` (dijaga tes) untuk
 * layar lain yang menampilkan tautan "Order" hanya bila CPOE kunjungan itu bisa dibuka.
 */
export function demoCpoeAvailable(encounterId: string, igd: RunResult): boolean {
  if (encounterId === encounterIdOf(SURYO)) return true;
  if (encounterId === encounterIdOf(HARTONO)) return hartonoCpoeOpen(igd);
  return poliCpoeFixture(encounterId) !== null;
}

/** Konteks CPOE kunjungan `encounterId`; null bila kunjungan tidak dikenal atau tidak terbuka saat ini. */
export function demoCpoeContext(encounterId: string, rj: RunResult, igd: RunResult): CpoeContext | null {
  if (!demoCpoeAvailable(encounterId, igd)) return null;
  if (encounterId === encounterIdOf(SURYO)) return suryoCpoe(rj);
  if (encounterId === encounterIdOf(HARTONO)) return hartonoCpoe(igd);
  const x = poliCpoeFixture(encounterId);
  return x ? fixtureCpoe(x.f, x.c) : null;
}

/** Kunjungan hari ini untuk daftar CPOE (`/klinis/order`); Tn. Hartono hanya selama CPOE IGD-nya terbuka. */
export function demoCpoeEncounters(rj: RunResult, igd: RunResult): CpoeEncounterRef[] {
  const poli: CpoeEncounterRef[] = demoPoliWorklist(rj).items.map((q) => ({
    encounterId: q.encounterId,
    name: q.name,
    rm: q.rm,
    unit: `${POLI_NAME} · ${q.queueNo}`,
    note: q.waitNote,
    allergies: [...mustPatient(q.patientId).alergi],
  }));
  if (!hartonoCpoeOpen(igd)) return poli;
  const h = mustPatient(HARTONO);
  return [
    ...poli,
    {
      encounterId: encounterIdOf(h.id),
      name: h.nama,
      rm: h.rm,
      unit: 'IGD · nyeri dada',
      note: 'gawat darurat',
      allergies: [...h.alergi],
    },
  ];
}
