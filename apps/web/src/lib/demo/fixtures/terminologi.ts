import type { RefCodeSystem } from '@simrs/shared';
import type { RefConcept, RefVersion } from '../../platform-terminologi';

/**
 * FE1 · P06 data rujukan mode presentasi. Kode HANYA dari `SEED_REF_SAMPLES` (`@simrs/db`, dijaga tes): web tidak
 * boleh mengimpor `@simrs/db` di runtime, jadi contoh disalin di sini. Lima kode LOINC sengaja belum ada di data aktif
 * agar berkas impor contoh punya kode baru untuk ditambahkan (tidak ada kode karangan).
 */

const S = (system: RefCodeSystem, rows: Array<[string, string]>, active = true): RefConcept[] =>
  rows.map(([code, display]) => ({ system, code, display, active }));

export const LOINC_PENDING: Array<[string, string]> = [
  ['1988-5', 'CRP'],
  ['2085-9', 'HDL'],
  ['13457-7', 'LDL'],
  ['2571-8', 'Trigliserida'],
  ['10839-9', 'Troponin I'],
];

export const DEMO_REF_CONCEPTS: readonly RefConcept[] = [
  ...S('icd10', [
    ['A41.9', 'Sepsis, tidak spesifik'],
    ['A91', 'Demam berdarah dengue'],
    ['C18.9', 'Neoplasma ganas kolon'],
    ['E11.9', 'Diabetes melitus tipe 2 tanpa komplikasi'],
    ['E78.5', 'Hiperlipidemia, tidak spesifik'],
    ['E87.2', 'Asidosis'],
    ['E87.5', 'Hiperkalemia'],
    ['I10', 'Hipertensi esensial (primer)'],
    ['I20.0', 'Angina tidak stabil'],
    ['I21.4', 'Infark miokard akut non-ST elevasi'],
    ['I63.9', 'Infark serebral'],
    ['J06.9', 'Infeksi saluran napas atas akut'],
    ['J13', 'Pneumonia akibat S. pneumoniae'],
    ['J18.9', 'Pneumonia, tidak spesifik'],
    ['J96.0', 'Gagal napas akut'],
    ['K30', 'Dispepsia'],
    ['K80.2', 'Batu kandung empedu tanpa kolesistitis'],
    ['M10.9', 'Gout, tidak spesifik'],
    ['N17.9', 'Gagal ginjal akut'],
    ['N18.3', 'Penyakit ginjal kronik stadium 3'],
    ['N18.5', 'Penyakit ginjal kronik stadium 5'],
    ['O82.0', 'Persalinan dengan seksio sesarea elektif'],
    ['R50.9', 'Demam, tidak spesifik'],
    ['R57.2', 'Syok septik'],
    ['R57.9', 'Syok, tidak spesifik'],
    ['S72.3', 'Fraktur batang femur'],
    ['Z37.0', 'Lahir hidup tunggal'],
    ['Z51.1', 'Sesi kemoterapi'],
    ['Z99.2', 'Ketergantungan dialisis'],
  ]),
  ...S('icd9cm', [
    ['00.17', 'Infus agen vasopresor'],
    ['38.93', 'Pemasangan kateter vena sentral'],
    ['39.95', 'Hemodialisis'],
    ['51.23', 'Kolesistektomi laparoskopik'],
    ['66.39', 'Sterilisasi tuba bilateral'],
    ['74.1', 'Seksio sesarea segmen bawah'],
    ['79.35', 'Reduksi terbuka dengan fiksasi internal femur'],
    ['87.03', 'CT scan kepala'],
    ['88.56', 'Angiografi koroner'],
    ['88.72', 'Ekokardiografi'],
    ['88.76', 'USG abdomen'],
    ['89.03', 'Pemeriksaan dan evaluasi'],
    ['89.52', 'EKG'],
    ['89.65', 'Analisis gas darah arteri'],
    ['93.90', 'Ventilasi non-invasif'],
    ['96.71', 'Ventilasi mekanik < 96 jam'],
    ['96.72', 'Ventilasi mekanik ≥ 96 jam'],
    ['99.18', 'Infus cairan elektrolit'],
    ['99.25', 'Injeksi kemoterapi'],
    ['99.55', 'Imunisasi bayi baru lahir'],
  ]),
  ...S('loinc', [
    ['2345-7', 'Glukosa sewaktu'],
    ['883-9', 'Golongan darah ABO'],
    ['4548-4', 'HbA1c'],
    ['718-7', 'Hemoglobin'],
    ['2823-3', 'Kalium'],
    ['2075-0', 'Klorida'],
    ['2093-3', 'Kolesterol total'],
    ['2160-0', 'Kreatinin'],
    ['6690-2', 'Leukosit'],
    ['2951-2', 'Natrium'],
    ['10331-7', 'Rhesus'],
    ['777-3', 'Trombosit'],
    ['3094-0', 'Ureum'],
  ]),
  ...S('kfa', [
    ['93000387', 'Klopidogrel 75 mg tablet'],
    ['93000655', 'Bisoprolol 2,5 mg tablet'],
    ['93000914', 'Atorvastatin 40 mg tablet'],
    ['93001152', 'Omeprazol 40 mg injeksi'],
    ['93002210', 'Enoksaparin 60 mg/0,6 mL injeksi'],
  ]),
];

export const DEMO_REF_VERSIONS: readonly RefVersion[] = [
  {
    system: 'kfa',
    version: '2026-09',
    source: 'Kemenkes (KFA) · contoh',
    appliedAt: '2026-09-30T16:10:00+07:00',
    appliedBy: 'Admin SIM RS (presentasi)',
    inserted: 1,
    updated: 2,
    deactivated: 0,
  },
  {
    system: 'loinc',
    version: '2.76-contoh',
    source: 'loinc.org · contoh',
    appliedAt: '2026-08-12T09:05:00+07:00',
    appliedBy: 'Admin SIM RS (presentasi)',
    inserted: 13,
    updated: 0,
    deactivated: 0,
  },
  {
    system: 'icd10',
    version: '2019-contoh',
    source: 'WHO · contoh',
    appliedAt: '2026-07-01T08:00:00+07:00',
    appliedBy: 'Admin SIM RS (presentasi)',
    inserted: 29,
    updated: 0,
    deactivated: 0,
  },
  {
    system: 'icd9cm',
    version: '2010-contoh',
    source: 'Kemenkes · contoh',
    appliedAt: '2026-07-01T08:02:00+07:00',
    appliedBy: 'Admin SIM RS (presentasi)',
    inserted: 20,
    updated: 0,
    deactivated: 0,
  },
];

const loincBody = (extra: string[]) =>
  [
    'code,display,active',
    '2345-7,Glukosa sewaktu plasma,true',
    '718-7,Hemoglobin darah,true',
    '2160-0,Kreatinin serum,true',
    '2823-3,Kalium,true',
    ...LOINC_PENDING.map(([c, d]) => `${c},${d},true`),
    ...extra,
  ].join('\n');

export interface DemoImportFile {
  id: string;
  name: string;
  system: RefCodeSystem;
  version: string;
  text: string;
}

/** Berkas contoh: versi pertama memuat 2 galat (check digit LOINC + kode ganda), versi perbaikan bersih. */
export const DEMO_IMPORT_FILES: readonly DemoImportFile[] = [
  {
    id: 'loinc-galat',
    name: 'loinc-2.77-lab-rsfa.csv',
    system: 'loinc',
    version: '2.77-contoh',
    text: loincBody(['718-6,Hemoglobin (salah ketik check digit),true', '2823-3,Kalium serum,true']),
  },
  {
    id: 'loinc-bersih',
    name: 'loinc-2.77-lab-rsfa-perbaikan.csv',
    system: 'loinc',
    version: '2.77-contoh',
    text: loincBody([]),
  },
];
