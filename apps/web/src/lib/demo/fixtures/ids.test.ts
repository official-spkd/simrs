import { describe, expect, it } from 'vitest';
import { demoKasirBoard, demoAccountingBoard, demoClaimBoard } from '../../keuangan-skenario';
import { demoFinancingOverview, demoOrSchedule, demoPaymentOverview } from '../../btn-skenario';
import { doctorAppInbox, patientAppHome } from '../../manajemen-aplikasi';
import { scenarioLabSamples } from '../../penunjang-skenario';
import { scenarioPrescriptions } from '../../penunjang-skenario-farmasi';
import { scenarioRadiologyExams } from '../../penunjang-skenario-radiologi';
import {
  applyScenarioBeds,
  hartonoBedRequest,
  hartonoConsent,
  hartonoEdItem,
  hartonoInpatient,
  hartonoResume,
  ratnaBedRequest,
  ratnaConsent,
  ratnaInpatient,
  ratnaResume,
} from '../../rawat-inap-scenario';
import { advanceTo, runScenario } from '../engine/run';
import type { RunResult, ScenarioId } from '../engine/types';
import { SCENARIO_ORDER, SCENARIOS } from '../skenario';
import { CICILAN, KAMAR_OK, REFUND, REKONSILIASI, TRANSAKSI } from './btn';
import {
  demoQueueBoard,
  demoRegistrationDesk,
  demoWeeklySchedule,
  registrationPatients,
  scenarioRegistrationPatient,
} from './front-office';
import * as IDS from './ids';
import { STATIC_CLAIMS, STATIC_INVOICES, STATIC_JOURNALS } from './keuangan';
import { demoCpoeContext, demoCpoeEncounters, demoPoliEncounter, demoPoliWorklist } from './klinis';
import { COSIGN_NOTES, DOCTOR_PATIENTS } from './manajemen';
import { ANTREAN_POLI_PD, encounterIdOf, PASIEN, ROSTER } from './pasien';
import { demoLabSamples, demoPrescriptions, demoRadiologyExams } from './penunjang';
import {
  demoBedRequests,
  demoBeds,
  demoEdBoardBase,
  demoEndangResume,
  demoHendroConsent,
  demoInpatients,
} from './rawat-inap';
import { DOKTER } from './staf';
import { DEMO_NOW } from './waktu';

/**
 * Id fixture mode presentasi opak (rencana fase 2 potongan 0c): URL (`?pilih=`, `/klinis/order/<id>`), payload
 * Server Action, dan keadaan simulasi tidak boleh memuat nama orang fiktif.
 */

const UUID_V7 = /^[0-9a-f]{8}-[0-9a-f]{4}-7[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;
const UUID_GROUPS: Array<[string, Readonly<Record<string, string>>]> = Object.entries(IDS).flatMap(
  ([name, v]) => (typeof v === 'object' && name !== 'CDS_ALERT_ID' ? [[name, v]] : []),
);

/** Kata nama orang fiktif (pasien dan dokter), tanpa gelar dan spesialisasi, huruf kecil, ≥ 3 huruf. */
const NAME_WORDS = [...new Set([...PASIEN.map((p) => p.nama), ...DOKTER.map((d) => d.nama)])].flatMap((n) =>
  (n.split(',')[0] ?? '')
    .replace(/^(Tn|Ny|An|dr)\.\s*/i, '')
    .toLowerCase()
    .split(/\s+/)
    .filter((w) => /^[a-z]{3,}$/.test(w)),
);

/** Semua nilai string di kunci `id`, `…Id`, dan `…Ids` (bertingkat), beserta jalurnya. */
function collectIds(value: unknown, path = '$', out: Array<[string, string]> = []): Array<[string, string]> {
  if (Array.isArray(value)) {
    value.forEach((v, i) => collectIds(v, `${path}[${i}]`, out));
  } else if (value && typeof value === 'object') {
    for (const [k, v] of Object.entries(value)) {
      const idKey = k === 'id' || /Ids?$/.test(k);
      if (idKey && typeof v === 'string') out.push([`${path}.${k}`, v]);
      else if (idKey && Array.isArray(v)) {
        v.forEach((x, i) => typeof x === 'string' && out.push([`${path}.${k}[${i}]`, x]));
      } else collectIds(v, `${path}.${k}`, out);
    }
  }
  return out;
}

/** Hasil replay tiap skenario di setiap batas langkah (awal sampai selesai). */
function scenarioStages(): Array<Record<ScenarioId, RunResult>> {
  const stages: Array<Record<ScenarioId, RunResult>> = [];
  const max = Math.max(...SCENARIO_ORDER.map((id) => SCENARIOS[id].steps.length));
  for (let target = 0; target <= max; target++) {
    const entry = {} as Record<ScenarioId, RunResult>;
    for (const id of SCENARIO_ORDER) {
      const def = SCENARIOS[id];
      const r = advanceTo(def, [], Math.min(target, def.steps.length));
      if (!r.ok) throw new Error(r.error);
      entry[id] = runScenario(def, r.seq);
    }
    stages.push(entry);
  }
  return stages;
}

/** Data layar mode presentasi yang membawa id: fixture statis + proyeksi pasien skenario di setiap tahap. */
function screenData(): unknown[] {
  const rj0 = runScenario(SCENARIOS['rawat-jalan'], []);
  const igd0 = runScenario(SCENARIOS['igd-ranap'], []);
  const statics: unknown[] = [
    PASIEN,
    ROSTER,
    ANTREAN_POLI_PD,
    DOKTER,
    demoWeeklySchedule(),
    demoQueueBoard(),
    demoRegistrationDesk(),
    registrationPatients(),
    scenarioRegistrationPatient(),
    demoPoliWorklist(rj0),
    PASIEN.map((p) => demoPoliEncounter(p.id, rj0)),
    PASIEN.map((p) => demoCpoeContext(encounterIdOf(p.id), rj0, igd0)),
    demoEdBoardBase(DEMO_NOW),
    demoBeds(),
    demoBedRequests(demoBeds()),
    demoInpatients(),
    demoEndangResume(),
    demoHendroConsent(),
    demoLabSamples(),
    demoPrescriptions(),
    demoRadiologyExams(),
    STATIC_INVOICES,
    STATIC_CLAIMS,
    STATIC_JOURNALS,
    TRANSAKSI,
    REKONSILIASI,
    REFUND,
    CICILAN,
    KAMAR_OK,
    DOCTOR_PATIENTS,
    COSIGN_NOTES,
  ];
  const projected = scenarioStages().flatMap((R) => [
    demoCpoeEncounters(R['rawat-jalan'], R['igd-ranap']),
    demoCpoeContext(encounterIdOf(IDS.PATIENT_ID.suryo), R['rawat-jalan'], R['igd-ranap']),
    demoCpoeContext(encounterIdOf(IDS.PATIENT_ID.hartono), R['rawat-jalan'], R['igd-ranap']),
    demoKasirBoard(R),
    demoClaimBoard(R),
    demoAccountingBoard(R),
    scenarioLabSamples(R),
    scenarioPrescriptions(R),
    scenarioRadiologyExams(R),
    applyScenarioBeds(demoBeds(), R['igd-ranap'], R['elektif-btn']),
    hartonoBedRequest(R['igd-ranap']),
    ratnaBedRequest(R['elektif-btn']),
    hartonoEdItem(R['igd-ranap'], DEMO_NOW),
    hartonoInpatient(R['igd-ranap']),
    ratnaInpatient(R['elektif-btn']),
    hartonoResume(R['igd-ranap']),
    ratnaResume(R['elektif-btn']),
    hartonoConsent(R['igd-ranap']),
    ratnaConsent(R['elektif-btn']),
    demoPaymentOverview(R['elektif-btn']),
    demoFinancingOverview(R['elektif-btn']),
    demoOrSchedule(R['elektif-btn']),
    patientAppHome(R['rawat-jalan']),
    doctorAppInbox(R['igd-ranap']),
  ]);
  return [...statics, ...projected];
}

describe('id fixture opak', () => {
  it('id konstan berbentuk UUID v7, unik di seluruh kelompok, dan tidak dipakai ulang antar-entitas', () => {
    const all = UUID_GROUPS.flatMap(([, g]) => Object.values(g));
    expect(all.length).toBeGreaterThan(150);
    for (const id of all) expect(id).toMatch(UUID_V7);
    expect(new Set(all).size).toBe(all.length);
    expect(new Set(Object.values(IDS.CDS_ALERT_ID)).size).toBe(Object.keys(IDS.CDS_ALERT_ID).length);
  });

  it('kata nama pasien dan dokter fiktif terkumpul (penjaga tes di bawah tidak kosong)', () => {
    for (const w of ['suryo', 'endang', 'rohana', 'andini', 'fauzi']) expect(NAME_WORDS).toContain(w);
  });

  it('tidak ada id di data layar (fixture + proyeksi skenario di setiap tahap) yang memuat nama orang fiktif', () => {
    const ids = screenData().flatMap((d) => collectIds(d));
    expect(ids.length).toBeGreaterThan(500);
    // Dibandingkan per kata (`r0881-sitikolin` dan `nadi` bukan nama), seperti nama dulu muncul di id (awalan + nama pasien).
    const words = new Set(NAME_WORDS);
    const leaks = ids.filter(([, v]) =>
      v
        .toLowerCase()
        .split(/[^a-z]+/)
        .some((w) => words.has(w)),
    );
    expect(leaks.map(([path, v]) => `${path} = ${v}`)).toEqual([]);
  });
});
