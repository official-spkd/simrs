import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import {
  cpptNoteInputSchema,
  type EmarMedication,
  emarAdministrationInputSchema,
  emarWristbandScanInputSchema,
} from '@simrs/shared';
import { describe, expect, it } from 'vitest';
import { MIN_STROKE, StrokeTracker } from '../components/rawat-inap/signature-stroke';
import { advanceTo, applyAction, runScenario } from './demo/engine/run';
import type { ScenarioEvent } from './demo/engine/types';
import { patientById } from './demo/fixtures/pasien';
import { demoHendroConsent, demoInpatients } from './demo/fixtures/rawat-inap';
import { SCENARIOS } from './demo/skenario';
import {
  allDueGiven,
  canCorrectCppt,
  consentFinalizeBlocker,
  consentRefusalBlocker,
  cpptAddendumBlocker,
  cpptCorrectionBlocker,
  cpptNotePayload,
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
  localCpptId,
  SCENARIO_CONSENT_WAIT,
  SCENARIO_EMAR_WAIT,
  wristbandBlocker,
} from './rawat-inap';
import {
  consentScenarioWait,
  hartonoConsent,
  hartonoInpatient,
  isDone,
  RATNA_CONSENT_WAIT,
  ratnaConsent,
  stepIndexOf,
  stepState,
} from './rawat-inap-scenario';

/**
 * Gerbang sisi server rawat inap dan tablet persetujuan (K04/K07/K11/K12), kontrak payload layar ↔ skema bersama,
 * dan model murni goresan tanda tangan (tab ARIA diuji di `packages/ui`). Mode presentasi, ADR-0023.
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

  it('payload CPPT baru, koreksi, dan addendum lolos skema ketat server', () => {
    const soap = { s: 'Nyeri berkurang', o: '', a: 'Nyeri akut', p: '' };
    expect(cpptNoteInputSchema.parse(cpptNotePayload('kj-endang', soap, { kind: 'baru' }))).toMatchObject({
      supersedesId: null,
      addendumOf: null,
    });
    expect(
      cpptNoteInputSchema.parse(
        cpptNotePayload('kj-endang', soap, {
          kind: 'koreksi',
          targetId: 'cppt-endang-4',
          reason: 'Salah ketik skala nyeri',
        }),
      ),
    ).toMatchObject({ supersedesId: 'cppt-endang-4', addendumOf: null });
    expect(
      cpptNoteInputSchema.parse(
        cpptNotePayload('kj-endang', soap, { kind: 'addendum', targetId: 'cppt-endang-2' }),
      ),
    ).toMatchObject({ supersedesId: null, addendumOf: 'cppt-endang-2', correctionReason: null });
    expect(
      cpptNoteInputSchema.safeParse(
        cpptNotePayload('kj-endang', soap, { kind: 'koreksi', targetId: 'cppt-endang-4', reason: 'typo' }),
      ).success,
    ).toBe(false);
  });

  it('layar memanggil Server Action eMAR dan CPPT hanya lewat pembangun payload bertipe kontrak', () => {
    const dir = resolve(__dirname, '../app/(staf)/klinis/rawat-inap/[encounterId]');
    const emar = readFileSync(resolve(dir, 'emar-panel.tsx'), 'utf8');
    const cppt = readFileSync(resolve(dir, 'cppt-panel.tsx'), 'utf8');
    expect(emar).toMatch(/recordAdministrationAction\(\s*emarDosePayload\(/);
    expect(emar).toMatch(/scanWristbandAction\(emarScanPayload\(/);
    expect(cppt).toMatch(/saveCpptAction\(\s*cpptNotePayload\(/);
  });
});

describe('K07 · CPPT: koreksi hanya penulis, PPA lain addendum', () => {
  const entries = endang.cppt;
  const nurse = entries.find((e) => e.id === 'cppt-endang-4');
  if (!nurse) throw new Error('fixture cppt-endang-4 hilang');
  const author = { id: 'u-penulis', name: nurse.author };
  const other = { id: 'u-lain', name: 'Pengguna E2E Fiktif' };

  it('koreksi oleh penulis lolos; PPA lain ditolak dan diarahkan ke addendum', () => {
    expect(canCorrectCppt(nurse, nurse.author)).toBe(true);
    expect(cpptCorrectionBlocker(entries, nurse.id, author)).toBeNull();
    expect(cpptCorrectionBlocker(entries, nurse.id, other)).toMatch(/hanya oleh penulis/);
    expect(cpptAddendumBlocker(entries, nurse.id)).toBeNull();
  });

  it('versi lama tidak bisa dikoreksi/addendum lagi; entri lokal hanya oleh pembuatnya', () => {
    // cppt-endang-5 sudah digantikan koreksi cppt-endang-6 (versi 2).
    expect(cpptCorrectionBlocker(entries, 'cppt-endang-5', { id: 'x', name: 'siapa pun' })).toMatch(
      /sudah dikoreksi/,
    );
    expect(cpptAddendumBlocker(entries, 'cppt-endang-5')).toMatch(/versi terbaru/);
    expect(cpptAddendumBlocker(entries, 'tidak-ada')).toMatch(/tidak ditemukan/);
    const own = localCpptId(other.id, 1_700_000_000_000);
    expect(cpptCorrectionBlocker(entries, own, other)).toBeNull();
    expect(cpptCorrectionBlocker(entries, own, author)).toMatch(/tidak ditemukan/);
  });
});

describe('K11 · tablet persetujuan: giliran skenario dan kunci per status', () => {
  const def = SCENARIOS['igd-ranap'];

  it('Tn. Hartono menunggu giliran tugas consent; setelah final dikunci statusnya', () => {
    const atTl = jump('igd-ranap', 'tata-laksana');
    const R0 = runScenario(def, atTl);
    const doc0 = hartonoConsent(R0);
    expect(consentScenarioWait(doc0, stepState(R0, 'tata-laksana', 0).tasks.consent)).toBe(
      SCENARIO_CONSENT_WAIT,
    );
    const turn = play(
      'igd-ranap',
      [
        ['k', 'lengkap'],
        ['cds', 'ganti'],
        ['dispo', 'icu'],
      ],
      atTl,
    );
    const R1 = runScenario(def, turn);
    expect(
      consentScenarioWait(hartonoConsent(R1), stepState(R1, 'tata-laksana', 0).tasks.consent),
    ).toBeNull();
    const R2 = runScenario(def, play('igd-ranap', [['consent', true]], turn));
    const final = hartonoConsent(R2);
    expect(final.status).toBe('final');
    expect(consentScenarioWait(final, stepState(R2, 'tata-laksana', 0).tasks.consent)).toBeNull();
    expect(consentRefusalBlocker(final)).toMatch(/sudah final/);
  });

  it('persetujuan operasi Ny. Ratna tidak diproses di tablet; final bersama SEP', () => {
    const elektif = SCENARIOS['elektif-btn'];
    const draft = ratnaConsent(runScenario(elektif, []));
    expect(consentScenarioWait(draft, undefined)).toBe(RATNA_CONSENT_WAIT);
    const final = ratnaConsent(runScenario(elektif, jump('elektif-btn', 'deposit')));
    expect(final.status).toBe('final');
    expect(consentScenarioWait(final, undefined)).toBeNull();
  });

  it('dokumen bukan skenario selalu boleh selama draf; ditolak/final terkunci', () => {
    const hendro = demoHendroConsent();
    expect(consentScenarioWait(hendro, undefined)).toBeNull();
    expect(consentRefusalBlocker(hendro)).toBeNull();
    const refused = { ...hendro, status: 'ditolak' as const };
    expect(consentRefusalBlocker(refused)).toMatch(/sudah tercatat/);
    const input = {
      acknowledged: hendro.items.map((i) => i.id),
      patient: { name: hendro.signerName },
      witness: { name: hendro.witness.name },
    };
    expect(consentFinalizeBlocker(hendro, input)).toBeNull();
    expect(consentFinalizeBlocker(refused, input)).toMatch(/menolak/);
    expect(consentFinalizeBlocker({ ...hendro, status: 'final' }, input)).toMatch(/sudah final/);
  });
});

describe('komponen rawat inap: goresan tanda tangan', () => {
  it('pointercancel mengakhiri goresan seperti pointerup; pointer kedua diabaikan', () => {
    const t = new StrokeTracker();
    expect(t.down(1, { x: 0, y: 0 })).toBe(true);
    expect(t.down(2, { x: 5, y: 5 })).toBe(false);
    expect(t.move(2, { x: 50, y: 50 })).toBeNull();
    expect(t.move(1, { x: 30, y: 40 })).toEqual({ from: { x: 0, y: 0 }, to: { x: 30, y: 40 } });
    // Goresan pendek (50 px) dibatalkan sistem: berakhir bersih, belum menjadi tanda tangan.
    expect(t.end(1)).toBe(false);
    expect(t.active).toBe(false);
    expect(t.move(1, { x: 60, y: 60 })).toBeNull();
    // Goresan berikutnya menambah panjang sampai cukup; akhir ganda (up lalu lostpointercapture) tidak berefek.
    expect(t.down(3, { x: 0, y: 0 })).toBe(true);
    t.move(3, { x: MIN_STROKE, y: 0 });
    expect(t.end(3)).toBe(true);
    expect(t.end(3)).toBe(false);
    t.reset();
    expect(t.length).toBe(0);
  });
});
