import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import {
  type EmarMedication,
  emarAdministrationInputSchema,
  emarWristbandScanInputSchema,
} from '@simrs/shared';
import { describe, expect, it } from 'vitest';
import { advanceTo, applyAction, runScenario } from './demo/engine/run';
import type { ScenarioEvent } from './demo/engine/types';
import { patientById } from './demo/fixtures/pasien';
import { demoInpatients } from './demo/fixtures/rawat-inap';
import { SCENARIOS } from './demo/skenario';
import {
  allDueGiven,
  dueProgress,
  dueSlots,
  emarDosePayload,
  emarGivenFacts,
  emarGivenLabel,
  emarKey,
  emarLabelCode,
  emarRecordBlocker,
  emarScanPayload,
  emarTurnBlocker,
  SCENARIO_EMAR_WAIT,
  wristbandBlocker,
} from './rawat-inap';
import { hartonoInpatient, isDone, stepIndexOf, stepState } from './rawat-inap-scenario';

/**
 * Gerbang sisi server rawat inap dan tablet persetujuan (K04/K07/K11/K12), kontrak payload layar ↔ skema bersama,
 * dan model murni komponen (tab ARIA, goresan tanda tangan). Mode presentasi, ADR-0023.
 */

type Id = keyof typeof SCENARIOS;

function jump(id: Id, stepId: string): ScenarioEvent[] {
  const def = SCENARIOS[id];
  const r = advanceTo(def, [], stepIndexOf(runScenario(def, []), stepId));
  if (!r.ok) throw new Error(r.error);
  return r.seq;
}

/** Kerjakan tugas-tugas langkah aktif berurutan dengan nilai yang diberikan. */
function play(id: Id, tasks: Array<[string, true | string]>, seq: ScenarioEvent[]): ScenarioEvent[] {
  const def = SCENARIOS[id];
  let cur = seq;
  for (const [task, value] of tasks) {
    const R = runScenario(def, cur);
    const r = applyAction(def, cur, { type: 'task', step: R.step, task, value });
    if (!r.ok) throw new Error(`${task}: ${r.error}`);
    cur = r.seq;
  }
  return cur;
}

/** Putar otomatis sampai syarat terpenuhi (maks. 40 langkah). */
function autoUntil(id: Id, seq: ScenarioEvent[], stop: (seq: ScenarioEvent[]) => boolean): ScenarioEvent[] {
  const def = SCENARIOS[id];
  let cur = seq;
  for (let i = 0; i < 40 && !stop(cur); i += 1) {
    const r = applyAction(def, cur, { type: 'auto' });
    if (!r.ok) throw new Error(r.error);
    cur = r.seq;
  }
  return cur;
}

const endang = demoInpatients().find((d) => d.summary.encounterId === 'kj-endang');
if (!endang) throw new Error('fixture kj-endang hilang');
const ENDANG_RM = patientById(endang.summary.patientId)?.rm ?? '';
const med = (name: string): EmarMedication => {
  const m = endang.medications.find((x) => x.name.startsWith(name));
  if (!m) throw new Error(`obat ${name} hilang`);
  return m;
};
const insulin = med('Insulin aspart');
const omeprazol = med('Omeprazol');
const seftriakson = med('Seftriakson');

const dose = (
  m: EmarMedication,
  time: '08.00' | '12.00',
  over: Partial<Parameters<typeof emarRecordBlocker>[0]['input']> = {},
) => ({
  meds: endang.medications,
  rm: ENDANG_RM,
  nurse: 'Ns. Pemberi Uji',
  input: {
    medicationId: m.id,
    time,
    wristbandCode: ENDANG_RM,
    labelCode: emarLabelCode(m),
    lateReason: null,
    doubleCheckedBy: null,
    ...over,
  },
});

describe('K12 · eMAR: satu dosis per aksi, diperiksa server', () => {
  it('slot, gelang, label obat, alasan terlambat, dan cek ganda dibaca dari rekam server', () => {
    expect(emarRecordBlocker(dose(insulin, '12.00', { doubleCheckedBy: 'Ns. Kedua Uji' }))).toBeNull();
    expect(emarRecordBlocker(dose(insulin, '12.00', { medicationId: 'obat-lain' }))).toMatch(/tidak ada/);
    // Slot yang sudah diberikan (08.05) tidak bisa dicatat ulang; slot tanpa jadwal juga tidak.
    expect(emarRecordBlocker(dose(seftriakson, '08.00'))).toMatch(/tidak bisa dicatat \(diberikan\)/);
    expect(emarRecordBlocker(dose(seftriakson, '12.00'))).toMatch(/tidak bisa dicatat/);
    // Gelang pasien lain ditolak; override (kode null, alasan diperiksa skema) lolos ke gerbang berikutnya.
    expect(
      emarRecordBlocker(dose(insulin, '12.00', { wristbandCode: '99-99-99-99', doubleCheckedBy: 'Ns. B' })),
    ).toMatch(/Gelang tidak cocok/);
    expect(
      emarRecordBlocker(dose(insulin, '12.00', { wristbandCode: null, doubleCheckedBy: 'Ns. Kedua' })),
    ).toBeNull();
    expect(
      emarRecordBlocker(
        dose(insulin, '12.00', { wristbandCode: ENDANG_RM.replaceAll('-', ' '), doubleCheckedBy: 'Ns. B2' }),
      ),
    ).toBeNull();
    // Label obat lain (salah obat) ditolak; pemisah/huruf besar diabaikan.
    expect(emarRecordBlocker(dose(insulin, '12.00', { labelCode: emarLabelCode(omeprazol) }))).toMatch(
      /Label obat tidak cocok dengan Insulin aspart/,
    );
    expect(
      emarRecordBlocker(
        dose(insulin, '12.00', { labelCode: emarLabelCode(insulin).toUpperCase(), doubleCheckedBy: 'Ns. B' }),
      ),
    ).toBeNull();
    // Terlambat menurut rekam server: wajib alasan.
    expect(emarRecordBlocker(dose(omeprazol, '08.00'))).toMatch(/terlambat wajib alasan/);
    expect(
      emarRecordBlocker(dose(omeprazol, '08.00', { lateReason: 'Pasien sedang foto toraks' })),
    ).toBeNull();
    // Kewaspadaan tinggi menurut rekam server: cek ganda wajib, oleh orang lain.
    expect(emarRecordBlocker(dose(insulin, '12.00'))).toMatch(/wajib cek ganda/);
    expect(emarRecordBlocker(dose(insulin, '12.00', { doubleCheckedBy: 'ns. pemberi  uji' }))).toMatch(
      /petugas lain/,
    );
  });

  it('fakta dosis tercatat dari rekam server, bukan klaim klien', () => {
    expect(emarGivenFacts(omeprazol, '08.00', null)).toEqual({ late: true, doubleCheckedBy: null });
    // Klien mengirim nama cek ganda untuk obat biasa: diabaikan.
    expect(emarGivenFacts(omeprazol, '08.00', 'Ns. B')).toEqual({ late: true, doubleCheckedBy: null });
    expect(emarGivenFacts(insulin, '12.00', ' Ns. B ')).toEqual({ late: false, doubleCheckedBy: 'Ns. B' });
    expect(emarGivenLabel('12.04', { late: false, doubleCheckedBy: 'Ns. B' })).toBe('✓ 12.04 · cek ganda');
    expect(emarGivenLabel('12.05', { late: true, doubleCheckedBy: null })).toBe('✓ 12.05 · telat');
  });

  it('gerbang pindai gelang: kode cocok RM atau override', () => {
    expect(wristbandBlocker(ENDANG_RM, ENDANG_RM)).toBeNull();
    expect(wristbandBlocker(ENDANG_RM.replaceAll('-', ''), ENDANG_RM)).toBeNull();
    expect(wristbandBlocker('99-99-99-99', ENDANG_RM)).toMatch(/tidak cocok/);
    expect(wristbandBlocker(null, ENDANG_RM)).toBeNull();
  });

  it('Tn. Hartono: lima dosis 08.00 diberikan satu per satu; tugas Simulasi hanya pada gilirannya', () => {
    const def = SCENARIOS['igd-ranap'];
    // Serah terima selesai tetapi langkah rawat inap belum dimulai: pasien sudah di ruang, eMAR menunggu giliran.
    const handed = autoUntil('igd-ranap', jump('igd-ranap', 'admisi'), (s) =>
      isDone(runScenario(def, s), 'admisi', 'transfer'),
    );
    const R0 = runScenario(def, handed);
    expect(hartonoInpatient(R0)).not.toBeNull();
    expect(emarTurnBlocker(stepState(R0, 'rawat-inap', 0).tasks.emar)).toBe(SCENARIO_EMAR_WAIT);

    const start = jump('igd-ranap', 'rawat-inap');
    const R1 = runScenario(def, start);
    const turn = stepState(R1, 'rawat-inap', 0).tasks.emar;
    expect(turn?.enabled).toBe(true);
    expect(emarTurnBlocker(turn)).toBeNull();
    const d1 = hartonoInpatient(R1);
    if (!d1) throw new Error('Tn. Hartono belum dirawat');
    const due = dueSlots(d1.medications, d1.emarNow, {});
    // Amlodipin ditunda (TD rendah) bukan dosis wajib; enoksaparin kewaspadaan tinggi.
    expect(due).toHaveLength(5);
    expect(d1.medications.filter((m) => m.highAlert).map((m) => m.name)).toEqual([
      'Enoksaparin 60 mg/0,6 mL',
    ]);
    const given: Record<string, string> = {};
    for (const key of due.slice(0, 4)) given[key] = '✓ 08.20';
    expect(allDueGiven(d1.medications, d1.emarNow, given)).toBe(false);
    expect(dueProgress(d1.medications, d1.emarNow, given)).toEqual({ given: 4, total: 5 });
    const last = due[4] ?? '';
    expect(allDueGiven(d1.medications, d1.emarNow, { ...given, [last]: '✓ 08.21' })).toBe(true);

    // Setelah tugas `emar` tercatat, dosis 08.00 sudah "diberikan" di rekam: tidak bisa dicatat ulang.
    const after = play('igd-ranap', [['emar', true]], start);
    const R2 = runScenario(def, after);
    expect(emarTurnBlocker(stepState(R2, 'rawat-inap', 0).tasks.emar)).toBeNull();
    const d2 = hartonoInpatient(R2);
    const enox = d2?.medications.find((m) => m.highAlert);
    if (!d2 || !enox) throw new Error('enoksaparin hilang');
    expect(dueSlots(d2.medications, d2.emarNow, {})).toEqual([]);
    expect(
      emarRecordBlocker({
        meds: d2.medications,
        rm: patientById(d2.summary.patientId)?.rm ?? '',
        nurse: 'Ns. A',
        input: {
          medicationId: enox.id,
          time: '08.00',
          wristbandCode: null,
          labelCode: emarLabelCode(enox),
          lateReason: null,
          doubleCheckedBy: 'Ns. B',
        },
      }),
    ).toMatch(/tidak bisa dicatat \(diberikan\)/);
    expect(emarKey(enox.id, '08.00')).toBe(`${enox.id}|08.00`);
  });

  it('pasien bukan skenario dan tugas yang tidak ada: giliran ditolak bila tugas tidak dikenal', () => {
    expect(emarTurnBlocker(undefined)).toBe(SCENARIO_EMAR_WAIT);
    expect(emarTurnBlocker({ enabled: false, done: false })).toBe(SCENARIO_EMAR_WAIT);
    expect(emarTurnBlocker({ enabled: false, done: true })).toBeNull();
  });
});

describe('kontrak payload layar ↔ skema bersama (tidak boleh menyimpang lagi)', () => {
  const base = { encounterId: 'kj-endang', medicationId: insulin.id, time: '12.00' as const, rm: ENDANG_RM };
  const doseInput = { labelCode: emarLabelCode(insulin), lateReason: null, doubleCheckedBy: 'Ns. Kedua' };

  it('payload pemberian dosis dan pindai gelang lolos skema ketat server', () => {
    const cocok = emarDosePayload({ ...base, identity: { status: 'cocok', reason: null }, dose: doseInput });
    expect(emarAdministrationInputSchema.parse(cocok)).toMatchObject({ wristbandCode: ENDANG_RM });
    const override = emarDosePayload({
      ...base,
      identity: { status: 'override', reason: 'Gelang basah, tidak terbaca pemindai' },
      dose: doseInput,
    });
    expect(emarAdministrationInputSchema.parse(override)).toMatchObject({ wristbandCode: null });
    // Override tanpa alasan cukup ditolak skema.
    const bare = emarDosePayload({ ...base, identity: { status: 'override', reason: 'x' }, dose: doseInput });
    expect(emarAdministrationInputSchema.safeParse(bare).success).toBe(false);
    // Bentuk lama (`wristband: 'cocok'`) ditolak: kontrak ketat.
    expect(
      emarAdministrationInputSchema.safeParse({ ...cocok, wristband: 'cocok', wristbandCode: undefined })
        .success,
    ).toBe(false);

    expect(emarWristbandScanInputSchema.parse(emarScanPayload('kj-endang', ENDANG_RM, null))).toEqual({
      encounterId: 'kj-endang',
      wristbandCode: ENDANG_RM,
      scanOverrideReason: null,
    });
    expect(
      emarWristbandScanInputSchema.safeParse(
        emarScanPayload('kj-endang', null, 'Gelang rusak terkena cairan'),
      ).success,
    ).toBe(true);
    expect(emarWristbandScanInputSchema.safeParse(emarScanPayload('kj-endang', null, 'pendek')).success).toBe(
      false,
    );
  });

  it('layar memanggil Server Action eMAR hanya lewat pembangun payload bertipe kontrak', () => {
    const dir = resolve(__dirname, '../app/(staf)/klinis/rawat-inap/[encounterId]');
    const emar = readFileSync(resolve(dir, 'emar-panel.tsx'), 'utf8');
    expect(emar).toMatch(/recordAdministrationAction\(\s*emarDosePayload\(/);
    expect(emar).toMatch(/scanWristbandAction\(emarScanPayload\(/);
  });
});
