import type { LabResult, LabSample } from '@simrs/shared';
import { taskKey } from './demo/engine/run';
import type { RunResult, ScenarioDef, ScenarioId, TaskValue } from './demo/engine/types';
import { LAB_SAMPLE_ID } from './demo/fixtures/ids';
import { numeric, pendingResult, supportPatient } from './demo/fixtures/penunjang';
import { patientByScenario } from './demo/fixtures/pasien';
import { PERSONA, STAF } from './demo/fixtures/staf';
import { shiftDate } from './demo/fixtures/waktu';

/**
 * Proyeksi pasien skenario Simulasi ke layar penunjang (ADR-0023, pembangun-layar §6). Fungsi murni atas hasil
 * replay (`RunResult`): Tn. Suryo (rawat jalan) muncul di worklist lab setelah order CPOE, Tn. Hartono (IGD) setelah
 * order set, lengkap dengan nilai kritis yang mengikuti tugas `nilai-kritis`. Diuji dengan `advanceTo`/`applyAction`.
 */

export type ScenarioResults = Record<ScenarioId, RunResult>;

/**
 * Kait tugas skenario untuk komponen klien layar asli: tombol asli layar memajukan skenario hanya bila tugasnya
 * sedang giliran (`enabled`) di langkah aktif yang dibawakan layar ini.
 */
export interface ScenarioTaskHook {
  rev: number;
  /** Per skenario yang langkah aktifnya ada di layar ini: indeks langkah dan tugas yang sedang giliran. */
  steps: Partial<Record<ScenarioId, { step: number; enabled: string[] }>>;
  /** Id pasien → skenario pemiliknya. */
  patients: Record<string, ScenarioId>;
}

function stepIndex(R: RunResult, stepId: string): number {
  const i = R.def.steps.findIndex((s) => s.id === stepId);
  if (i < 0) throw new Error(`Langkah ${stepId} tidak ada di skenario ${R.def.id}`);
  return i;
}

export function taskDone(R: RunResult, stepId: string, taskId: string): boolean {
  return R.done.has(taskKey(stepIndex(R, stepId), taskId));
}

export function taskValue(R: RunResult, stepId: string, taskId: string): TaskValue | undefined {
  return R.done.get(taskKey(stepIndex(R, stepId), taskId));
}

/** Menit simulasi saat tugas selesai (undefined bila belum). */
export function taskAt(R: RunResult, stepId: string, taskId: string): number | undefined {
  return R.doneAt.get(taskKey(stepIndex(R, stepId), taskId));
}

/** Instan ISO WIB dari menit simulasi: `2026-10-03T22:31:00+07:00`. */
export function simIso(def: ScenarioDef, minutes: number): string {
  const day = Math.floor(minutes / 1440);
  const rest = minutes - day * 1440;
  const hh = String(Math.floor(rest / 60)).padStart(2, '0');
  const mm = String(rest % 60).padStart(2, '0');
  return `${shiftDate(def.startDate, day)}T${hh}:${mm}:00+07:00`;
}

export function scenarioPatientId(id: ScenarioId): string {
  const p = patientByScenario(id);
  if (!p) throw new Error(`Pasien skenario ${id} tidak ada`);
  return p.id;
}

/** Nomor lab sampel skenario (sama dengan naskah Simulasi: "Sampel L2610050088 diterima"). */
export const SURYO_LAB_NO = 'L2610050088';
export const HARTONO_LAB_NO = 'L2610030188';

/** Tn. Suryo · rawat jalan: sampel muncul setelah `pemeriksaan-dokter.order`, lalu sampling → hasil → validasi. */
export function suryoLabSample(R: RunResult): LabSample | null {
  const orderAt = taskAt(R, 'pemeriksaan-dokter', 'order');
  if (orderAt === undefined) return null;
  const paket = taskValue(R, 'pemeriksaan-dokter', 'order') === 'paket';
  const sampledAt = taskAt(R, 'laboratorium', 'sampling');
  const hasilAt = taskAt(R, 'laboratorium', 'hasil');
  const validAt = taskAt(R, 'laboratorium', 'validasi');
  const status =
    validAt !== undefined
      ? 'selesai'
      : hasilAt !== undefined
        ? 'hasil'
        : sampledAt !== undefined
          ? 'diterima'
          : 'order';
  const keys = paket
    ? (['hba1c', 'kolesterol', 'ldl', 'hdl', 'trigliserida', 'kreatininL'] as const)
    : (['hba1c'] as const);
  let results: LabResult[] = [];
  if (hasilAt !== undefined) {
    const full: Record<(typeof keys)[number], LabResult> = {
      hba1c: numeric('hba1c', 8.4, [7.9, 7.4]),
      kolesterol: numeric('kolesterol', 218, [205]),
      ldl: numeric('ldl', 142, [128]),
      hdl: numeric('hdl', 38, [41]),
      trigliserida: numeric('trigliserida', 190, [176]),
      kreatininL: numeric('kreatininL', 1.1, [1, 1], 'eGFR 74 mL/menit/1,73 m² (CKD-EPI, dihitung)'),
    };
    results = keys.map((k) => full[k]);
  } else if (sampledAt !== undefined) {
    results = keys.map((k) => pendingResult(k));
  }
  const end = validAt ?? R.clock;
  return {
    id: LAB_SAMPLE_ID.suryo,
    labNo: SURYO_LAB_NO,
    patient: supportPatient(scenarioPatientId('rawat-jalan')),
    location: 'Poli Penyakit Dalam',
    sender: STAF.dpjpPenyakitDalam,
    priority: 'rutin',
    status,
    tests: paket ? 'HbA1c, profil lipid, kreatinin' : 'HbA1c',
    specimen: 'Darah EDTA + serum',
    orderedAt: simIso(R.def, orderAt),
    receivedAt: sampledAt === undefined ? null : simIso(R.def, sampledAt),
    tatMinutes: sampledAt === undefined ? null : Math.max(0, end - sampledAt),
    results,
    qcNote:
      hasilAt !== undefined
        ? 'Hasil dari analyzer kimia klinik (HL7 ORU) · QC harian lolos · delta check tanpa temuan · belum diubah manual'
        : sampledAt !== undefined
          ? 'Sampel diterima dan diverifikasi barcode · analyzer sedang memproses'
          : `Label barcode ${SURYO_LAB_NO} tercetak dari order CPOE · menunggu sampling`,
    technical: validAt === undefined ? null : { by: PERSONA.analisLab, at: simIso(R.def, validAt - 3) },
    clinical: validAt === undefined ? null : { by: STAF.dokterPatologiKlinik, at: simIso(R.def, validAt) },
    critical: null,
  };
}

/** Batas waktu pelaporan nilai kritis (menit). */
export const CRITICAL_LIMIT_MINUTES = 30;

/**
 * Tn. Hartono · IGD: sampel cito muncul setelah `asesmen-dokter.orderset`; hasil (kalium 6,8 KRITIS, troponin I
 * meningkat, kreatinin 1,8 · eGFR 38) keluar pada `nilai-kritis.hasil`; laporan dan read-back mengikuti tugas
 * `lapor` dan `readback`. Waktu lapor = hasil keluar → read-back.
 */
export function hartonoLabSample(R: RunResult): LabSample | null {
  const orderAt = taskAt(R, 'asesmen-dokter', 'orderset');
  if (orderAt === undefined) return null;
  const set = taskValue(R, 'asesmen-dokter', 'orderset') === 'set';
  const hasilAt = taskAt(R, 'nilai-kritis', 'hasil');
  const laporAt = taskAt(R, 'nilai-kritis', 'lapor');
  const readAt = taskAt(R, 'nilai-kritis', 'readback');
  const receivedAt = orderAt + 6;
  const keys = set
    ? ([
        'natrium',
        'kalium',
        'klorida',
        'ureum',
        'kreatininL',
        'troponin',
        'hbL',
        'leukosit',
        'trombosit',
      ] as const)
    : (['natrium', 'kalium', 'klorida', 'kreatininL', 'troponin'] as const);
  const full: Record<(typeof keys)[number], LabResult> = {
    natrium: numeric('natrium', 133),
    kalium: numeric('kalium', 6.8),
    klorida: numeric('klorida', 101),
    ureum: numeric('ureum', 64, [52]),
    kreatininL: numeric('kreatininL', 1.8, [1.5, 1.6], 'eGFR 38 mL/menit/1,73 m² (CKD-EPI, dihitung)'),
    troponin: numeric('troponin', 0.62),
    hbL: numeric('hbL', 14.2),
    leukosit: numeric('leukosit', 11800),
    trombosit: numeric('trombosit', 245000),
  };
  const results = keys.map((k) => (hasilAt === undefined ? pendingResult(k) : full[k]));
  const recipient = taskValue(R, 'nilai-kritis', 'lapor');
  const end = readAt ?? R.clock;
  return {
    id: LAB_SAMPLE_ID.hartono,
    labNo: HARTONO_LAB_NO,
    patient: supportPatient(scenarioPatientId('igd-ranap')),
    location: 'IGD · bed resusitasi 2',
    sender: STAF.dokterJagaIgd,
    priority: 'cito',
    status: hasilAt === undefined ? 'diterima' : 'hasil',
    tests: set
      ? 'Order set nyeri dada: troponin I, elektrolit, DL, ureum/kreatinin'
      : 'Troponin I, elektrolit',
    specimen: 'Serum + darah EDTA',
    orderedAt: simIso(R.def, orderAt),
    receivedAt: simIso(R.def, receivedAt),
    tatMinutes: Math.max(0, (hasilAt ?? R.clock) - receivedAt),
    results,
    qcNote:
      hasilAt === undefined
        ? 'Sampel cito diterima dari IGD · analyzer sedang memproses'
        : 'Kalium melewati batas kritis (> 6,0) · sampel tidak hemolisis · QC harian lolos · hasil dari analyzer',
    technical: null,
    clinical: null,
    critical:
      hasilAt === undefined
        ? null
        : {
            loinc: '2823-3',
            analyte: 'Kalium',
            value: 6.8,
            unit: 'mmol/L',
            decimals: 1,
            resultAt: simIso(R.def, hasilAt),
            limitMinutes: CRITICAL_LIMIT_MINUTES,
            elapsedSeconds: Math.max(0, end - hasilAt) * 60,
            recipient: typeof recipient === 'string' ? recipient : null,
            reportedAt: laporAt === undefined ? null : simIso(R.def, laporAt),
            readBackAt: readAt === undefined ? null : simIso(R.def, readAt),
            minutesToReport: readAt === undefined ? null : readAt - hasilAt,
          },
  };
}

/** Sampel pasien skenario yang sudah ada di worklist lab (urut skenario). */
export function scenarioLabSamples(results: ScenarioResults): LabSample[] {
  return [hartonoLabSample(results['igd-ranap']), suryoLabSample(results['rawat-jalan'])].filter(
    (s): s is LabSample => s !== null,
  );
}

/** Pasien skenario per id pasien (untuk menghubungkan baris layar dengan tugas skenario). */
export function scenarioPatientMap(): Record<string, ScenarioId> {
  const ids: ScenarioId[] = ['rawat-jalan', 'igd-ranap', 'elektif-btn'];
  return Object.fromEntries(ids.map((id) => [scenarioPatientId(id), id]));
}
