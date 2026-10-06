import type {
  AllergyEntry,
  AllergySeverity,
  EncounterDx,
  Problem,
  ProcedureEntry,
} from '../../rme-diagnosis';
import { ENCOUNTER_ID, PATIENT_ID } from './ids';
import { at } from './rawat-inap';
import type { RmeChart } from './rme-pasien';
import { PERSONA, STAF, STAF_LAIN } from './staf';
import { DEMO_TODAY, shiftDate } from './waktu';

/**
 * K08 · Diagnosis, prosedur, problem list, dan alergi mode presentasi. Kode HANYA dari rujukan seed
 * (`SEED_REF_SAMPLES` di `@simrs/db`, dijaga `rme-diagnosis.test.ts`); tidak ada kode karangan (CLAUDE.md §4.10).
 */

export const RME_ICD10: ReadonlyArray<{ code: string; display: string }> = [
  { code: 'A41.9', display: 'Sepsis, tidak spesifik' },
  { code: 'A91', display: 'Demam berdarah dengue' },
  { code: 'C18.9', display: 'Neoplasma ganas kolon' },
  { code: 'E11.9', display: 'Diabetes melitus tipe 2 tanpa komplikasi' },
  { code: 'E78.5', display: 'Hiperlipidemia, tidak spesifik' },
  { code: 'E87.5', display: 'Hiperkalemia' },
  { code: 'I10', display: 'Hipertensi esensial (primer)' },
  { code: 'I20.0', display: 'Angina tidak stabil' },
  { code: 'I21.4', display: 'Infark miokard akut non-ST elevasi' },
  { code: 'I63.9', display: 'Infark serebral' },
  { code: 'J06.9', display: 'Infeksi saluran napas atas akut' },
  { code: 'J18.9', display: 'Pneumonia, tidak spesifik' },
  { code: 'J96.0', display: 'Gagal napas akut' },
  { code: 'K30', display: 'Dispepsia' },
  { code: 'K80.2', display: 'Batu kandung empedu tanpa kolesistitis' },
  { code: 'M10.9', display: 'Gout, tidak spesifik' },
  { code: 'N17.9', display: 'Gagal ginjal akut' },
  { code: 'N18.3', display: 'Penyakit ginjal kronik stadium 3' },
  { code: 'N18.5', display: 'Penyakit ginjal kronik stadium 5' },
  { code: 'R50.9', display: 'Demam, tidak spesifik' },
  { code: 'R57.2', display: 'Syok septik' },
  { code: 'S72.3', display: 'Fraktur batang femur' },
  { code: 'Z51.1', display: 'Sesi kemoterapi' },
  { code: 'Z99.2', display: 'Ketergantungan dialisis' },
];

export const RME_ICD9: ReadonlyArray<{ code: string; display: string }> = [
  { code: '38.93', display: 'Pemasangan kateter vena sentral' },
  { code: '39.95', display: 'Hemodialisis' },
  { code: '79.35', display: 'Reduksi terbuka dengan fiksasi internal femur' },
  { code: '88.56', display: 'Angiografi koroner' },
  { code: '88.76', display: 'USG abdomen' },
  { code: '89.52', display: 'EKG' },
  { code: '96.71', display: 'Ventilasi mekanik < 96 jam' },
  { code: '99.25', display: 'Injeksi kemoterapi' },
];

const icd10 = (code: string) => RME_ICD10.find((c) => c.code === code)?.display ?? code;
const icd9 = (code: string) => RME_ICD9.find((c) => c.code === code)?.display ?? code;
const T = (hm: string, dayOffset = 0) => at(shiftDate(DEMO_TODAY, dayOffset), hm);

type DxSeed = [
  code: string,
  rank: EncounterDx['rank'],
  certainty: EncounterDx['certainty'],
  by: string,
  at: string,
];

/** Diagnosis kunjungan selain rawat inap fixture (rawat inap: dari `inpatient.summary.diagnoses`). */
const OTHER_DX: Readonly<Record<string, readonly DxSeed[]>> = {
  [ENCOUNTER_ID.sutan]: [
    ['I20.0', 'utama', 'kerja', '', T('21.00', -1)],
    ['I10', 'sekunder', 'kerja', '', T('21.00', -1)],
    ['N18.3', 'sekunder', 'kerja', '', T('21.00', -1)],
  ],
  [ENCOUNTER_ID.rohana]: [
    ['E11.9', 'utama', 'kerja', STAF.dpjpPenyakitDalam, T('10.38')],
    ['J18.9', 'sekunder', 'kerja', STAF.dpjpPenyakitDalam, T('10.38')],
  ],
  [ENCOUNTER_ID.dewi]: [['K30', 'utama', 'kerja', STAF.dpjpPenyakitDalam, T('09.20')]],
  [ENCOUNTER_ID.maria]: [
    ['Z51.1', 'utama', 'kerja', '', T('08.40')],
    ['C18.9', 'sekunder', 'kerja', '', T('08.40')],
  ],
};

const OTHER_PROC: Readonly<Record<string, ReadonlyArray<[string, string]>>> = {
  [ENCOUNTER_ID.sutan]: [['89.52', T('20.20', -1)]],
  [ENCOUNTER_ID.maria]: [['38.93', T('09.52')]],
  [ENCOUNTER_ID.dewi]: [['88.76', T('09.40')]],
};

/** Diagnosis dan prosedur kunjungan. */
export function encounterCoding(chart: RmeChart): { dx: EncounterDx[]; procedures: ProcedureEntry[] } {
  const enc = chart.encounterId;
  if (chart.inpatient) {
    const s = chart.inpatient.summary;
    const when = at(s.admittedOn, '11.00');
    const dx = s.diagnoses
      .filter((d) => d.system === 'ICD-10')
      .map((d, i): EncounterDx => ({
        id: `${enc}-dx-${i + 1}`,
        version: 1,
        supersedesId: null,
        by: s.dpjp,
        at: when,
        code: d.code,
        display: icd10(d.code),
        rank: d.primary ? 'utama' : 'sekunder',
        certainty: 'kerja',
        status: 'aktif',
        reason: null,
      }));
    const procedures = s.diagnoses
      .filter((d) => d.system === 'ICD-9-CM')
      .map((d, i) => ({
        id: `${enc}-proc-${i + 1}`,
        code: d.code,
        display: icd9(d.code),
        by: s.dpjp,
        at: when,
      }));
    return { dx, procedures };
  }
  const dx = (OTHER_DX[enc] ?? []).map(([code, rank, certainty, by, atIso], i): EncounterDx => ({
    id: `${enc}-dx-${i + 1}`,
    version: 1,
    supersedesId: null,
    by: by || chart.dpjp,
    at: atIso,
    code,
    display: icd10(code),
    rank,
    certainty,
    status: 'aktif',
    reason: null,
  }));
  const procedures = (OTHER_PROC[enc] ?? []).map(([code, atIso], i) => ({
    id: `${enc}-proc-${i + 1}`,
    code,
    display: icd9(code),
    by: chart.dpjp,
    at: atIso,
  }));
  return { dx, procedures };
}

type ProblemSeed = [code: string, onset: string, status: Problem['status'], resolvedOn: string | null];

/** Masalah lintas kunjungan per pasien (kelompok RM). */
const PROBLEMS: Readonly<Record<string, readonly ProblemSeed[]>> = {
  [PATIENT_ID.endang]: [
    ['E11.9', '2019-03-11', 'aktif', null],
    ['J18.9', shiftDate(DEMO_TODAY, -4), 'aktif', null],
  ],
  [PATIENT_ID.rohana]: [
    ['E11.9', '2020-07-02', 'aktif', null],
    ['J18.9', '2026-09-14', 'aktif', null],
  ],
  [PATIENT_ID.yusuf]: [
    ['N18.5', '2023-05-20', 'aktif', null],
    ['Z99.2', '2024-01-08', 'aktif', null],
    ['E87.5', '2025-11-02', 'teratasi', '2025-11-05'],
  ],
  [PATIENT_ID.sutan]: [
    ['I10', '2016-04-01', 'aktif', null],
    ['I20.0', shiftDate(DEMO_TODAY, -1), 'aktif', null],
  ],
  [PATIENT_ID.darmawan]: [
    ['M10.9', '2022-08-15', 'aktif', null],
    ['K30', '2024-02-10', 'aktif', null],
  ],
};

export function problemList(chart: RmeChart, dx: readonly EncounterDx[]): Problem[] {
  const seeds =
    PROBLEMS[chart.patientId] ??
    dx.filter((d) => d.status === 'aktif').map((d): ProblemSeed => [d.code, chart.startedOn, 'aktif', null]);
  return seeds.map(([code, onset, status, resolvedOn], i) => ({
    id: `${chart.encounterId}-masalah-${i + 1}`,
    version: 1,
    supersedesId: null,
    by: chart.dpjp,
    at: at(onset, '10.00'),
    code,
    display: icd10(code),
    onset,
    status,
    resolvedOn,
    note: null,
  }));
}

const REACTIONS: Readonly<Record<string, [string, AllergySeverity]>> = {
  Amoksisilin: ['Ruam kulit gatal di badan', 'sedang'],
  Ibuprofen: ['Bengkak bibir dan kelopak mata', 'berat'],
  'Kotrimoksazol (sulfa)': ['Ruam makulopapular', 'sedang'],
};

/** Alergi tercatat (dari identitas pasien) dengan reaksi; kosong = NKDA terverifikasi saat masuk. */
export function allergyList(
  chart: RmeChart,
  alergi: readonly string[],
): { list: AllergyEntry[]; nkdaAt: string | null } {
  const when = at(chart.startedOn, '09.00');
  const list = alergi.map((substance, i): AllergyEntry => {
    const [reaction, severity] = REACTIONS[substance] ?? ['Reaksi tidak diketahui', 'sedang'];
    return {
      id: `${chart.encounterId}-alergi-${i + 1}`,
      version: 1,
      supersedesId: null,
      by: chart.setting === 'kamar-bersalin' ? PERSONA.bidan : STAF_LAIN.perawat[0],
      at: when,
      substance,
      reaction,
      severity,
      status: 'aktif',
      reason: null,
    };
  });
  return { list, nkdaAt: list.length === 0 ? when : null };
}
