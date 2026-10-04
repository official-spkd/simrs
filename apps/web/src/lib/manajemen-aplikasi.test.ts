import { type DoctorAppInbox, doctorAppInboxSchema, patientAppHomeSchema } from '@simrs/shared';
import { describe, expect, it } from 'vitest';
import { advanceTo, applyAction, runScenario } from './demo/engine/run';
import type { ScenarioDef, ScenarioEvent } from './demo/engine/types';
import { SCENARIOS } from './demo/skenario';
import {
  doctorAppInbox,
  hartonoLabOrdered,
  labRow,
  medicineRow,
  patientAppHome,
  taskDone,
} from './manajemen-aplikasi';

/** Putar otomatis (nilai bawaan) sampai tugas `stepId.taskId` selesai. */
function until(def: ScenarioDef, stepId: string, taskId: string): ScenarioEvent[] {
  const target = def.steps.findIndex((s) => s.id === stepId);
  const jumped = advanceTo(def, [], target);
  if (!jumped.ok) throw new Error(jumped.error);
  let seq = jumped.seq;
  for (let guard = 0; guard < 40; guard++) {
    if (taskDone(runScenario(def, seq), stepId, taskId)) return seq;
    const r = applyAction(def, seq, { type: 'auto' });
    if (!r.ok) throw new Error(r.error);
    seq = r.seq;
  }
  throw new Error(`Tugas ${stepId}.${taskId} tidak tercapai`);
}

const RJ = SCENARIOS['rawat-jalan'];
const IGD = SCENARIOS['igd-ranap'];
const home = (seq: ScenarioEvent[]) => patientAppHomeSchema.parse(patientAppHome(runScenario(RJ, seq)));
const inbox = (seq: ScenarioEvent[]) => doctorAppInboxSchema.parse(doctorAppInbox(runScenario(IGD, seq)));

describe('aplikasi pasien mengikuti skenario rawat jalan (Tn. Suryo)', () => {
  it('sebelum skenario: kode booking, belum ada hasil/obat/kontrol', () => {
    const h = home([]);
    expect(h.greeting).toBe('Pak Suryo');
    expect(h.queue).toMatchObject({ stage: 'booking', number: '2610050117', numberLabel: 'Kode booking' });
    expect(h.labResults).toEqual([]);
    expect(h.medicines).toEqual([]);
    expect(h.controlVisit).toBeNull();
    expect(h.feed.map((f) => f.id)).toEqual(['booking']);
  });

  it('tiket admisi A-031, lalu antrean poli PD-027 setelah SEP', () => {
    expect(home(until(RJ, 'kedatangan', 'tiket')).queue).toMatchObject({ stage: 'admisi', number: 'A-031' });
    const h = home(until(RJ, 'pendaftaran', 'sep'));
    expect(h.queue).toMatchObject({ stage: 'poli', number: 'PD-027', ahead: 6 });
    expect(h.feed[0]?.id).toBe('sep');
  });

  it('hasil lab baru tampil setelah validasi dokter patologi klinik', () => {
    const before = home(until(RJ, 'laboratorium', 'hasil'));
    expect(before.labResults).toEqual([]);
    expect(before.labStatus).toMatch(/divalidasi/);
    const seq = until(RJ, 'laboratorium', 'validasi');
    const after = home(seq);
    const R = runScenario(RJ, seq);
    expect(after.labResults).toHaveLength(R.rec.hasil.length);
    expect(after.labResults[0]).toMatchObject({
      name: 'HbA1c',
      value: '8,4%',
      flag: 'tinggi',
      loinc: '4548-4',
    });
    expect(after.feed[0]?.id).toBe('lab');
  });

  it('obat setelah serah terima farmasi; jadwal kontrol setelah pasca.kontrol; selesai = pulang', () => {
    expect(home(until(RJ, 'resep', 'tte')).medicines).toEqual([]);
    const seq = until(RJ, 'farmasi', 'serah');
    const h = home(seq);
    expect(h.medicines).toHaveLength(runScenario(RJ, seq).rec.obat.length);
    expect(h.medicines[0]?.name).toMatch(/^Metformin/);
    expect(home(until(RJ, 'pasca', 'notif')).controlVisit).toBeNull();
    const done = home(until(RJ, 'pasca', 'kontrol'));
    expect(done.controlVisit?.date).toMatch(/2026|2027/);
    expect(done.queue.stage).toBe('pulang');
  });

  it('baris hasil dan obat ramah pasien', () => {
    expect(labRow('Kreatinin 1,1 mg/dL · eGFR 74', 0)).toMatchObject({
      value: '1,1 mg/dL',
      flag: 'normal',
      reference: 'Rujukan 0,7–1,3 mg/dL · eGFR 74',
      loinc: '2160-0',
    });
    expect(medicineRow('Atorvastatin 20 mg 1×1 malam · 30 hari', 0)).toEqual({
      id: 'obat-1',
      name: 'Atorvastatin 20 mg',
      instruction: '1× sehari, malam sebelum tidur · 30 hari',
    });
  });
});

describe('aplikasi dokter mengikuti nilai kritis Tn. Hartono (skenario IGD)', () => {
  const ks = IGD.steps.findIndex((s) => s.id === 'nilai-kritis');

  it('skenario belum disentuh: pratinjau lokal siap read-back', () => {
    const c = inbox([]).critical;
    expect(c).toMatchObject({ state: 'perlu-readback', mode: 'lokal', stepIndex: null, value: '6,8' });
  });

  it('menunggu hasil → menunggu laporan → read-back menjalankan tugas skenario → diterima', () => {
    const atStep = advanceTo(IGD, [], ks);
    if (!atStep.ok) throw new Error(atStep.error);
    expect(inbox(atStep.seq).critical.state).toBe('menunggu-hasil');
    expect(inbox(until(IGD, 'nilai-kritis', 'hasil')).critical.state).toBe('menunggu-laporan');
    const reported = inbox(until(IGD, 'nilai-kritis', 'lapor'));
    expect(reported.critical).toMatchObject({ state: 'perlu-readback', mode: 'skenario', stepIndex: ks });
    expect(reported.critical.reportedTo).toMatch(/dr\./);
    const accepted = inbox(until(IGD, 'nilai-kritis', 'readback')).critical;
    expect(accepted.state).toBe('diterima');
    expect(accepted.acceptedAt).toMatch(/\d{2}\.\d{2}/);
  });

  it('daftar pasien memuat Tn. Hartono dan pasien rawat lain dari fixture bersama', () => {
    const d = inbox([]);
    expect(d.patients[0]).toMatchObject({ name: 'Tn. Hartono Wibisono', rm: '00-61-30-05', level: 'tinggi' });
    expect(d.patients.length).toBeGreaterThanOrEqual(5);
    expect(d.cosign).toHaveLength(3);
  });
});

describe('aplikasi dokter tidak mendahului cerita IGD (milestone per milestone)', () => {
  const stepAt = (id: string) => IGD.steps.findIndex((s) => s.id === id);
  const hartono = (d: DoctorAppInbox) => d.patients.find((p) => p.id === 'pt-hartono');
  const detail = (d: DoctorAppInbox, label: string) =>
    hartono(d)?.details.find((r) => r.label === label)?.value;
  const ordered = (seq: ScenarioEvent[]) => hartonoLabOrdered(runScenario(IGD, seq));

  it('kedatangan: belum ada Tn. Hartono, order lab, EKG, nilai, maupun hiperkalemia', () => {
    const seq = until(IGD, 'kedatangan', 'id');
    const d = inbox(seq);
    expect(hartono(d)).toBeUndefined();
    expect(d.critical).toMatchObject({
      state: 'menunggu-hasil',
      mode: 'skenario',
      ecg: 'Belum direkam',
      value: '—',
      resultAt: null,
    });
    expect(ordered(seq)).toBe(false);
    const text = JSON.stringify(d);
    for (const spoiler of ['iperkalemia', 'runcing', '158/94', '6,8']) expect(text).not.toContain(spoiler);
  });

  it('asesmen dokter dimulai: Tn. Hartono masuk daftar dengan TTV dari rekam medis, tanpa EKG/hiperkalemia', () => {
    const atTriase = advanceTo(IGD, [], stepAt('triase'));
    if (!atTriase.ok) throw new Error(atTriase.error);
    const ttv = applyAction(IGD, atTriase.seq, {
      type: 'task',
      step: stepAt('triase'),
      task: 'ttv',
      value: '150/90 · 104 · 22 · 95%',
    });
    if (!ttv.ok) throw new Error(ttv.error);
    const atDoctor = advanceTo(IGD, ttv.seq, stepAt('asesmen-dokter'));
    if (!atDoctor.ok) throw new Error(atDoctor.error);
    const d = inbox(atDoctor.seq);
    expect(hartono(d)).toMatchObject({
      location: 'IGD · bed resusitasi 2',
      note: 'Suspek SKA · belum ada order lab',
    });
    expect(detail(d, 'Tanda vital (TD · N · RR · SpO2)')).toBe('150/90 · 104 · 22 · 95%');
    expect(detail(d, 'EKG')).toBe('Belum direkam');
    expect(detail(d, 'Diagnosis kerja')).toBe('Suspek sindrom koroner akut');
    expect(ordered(atDoctor.seq)).toBe(false);
  });

  it('EKG dari rekam medis setelah asesmen-dokter.ekg; order set → "menunggu hasil lab"', () => {
    expect(detail(inbox(until(IGD, 'asesmen-dokter', 'ekg')), 'EKG')).toBe(
      'Depresi ST V4–V6, T tinggi runcing',
    );
    const seq = until(IGD, 'asesmen-dokter', 'orderset');
    const d = inbox(seq);
    expect(ordered(seq)).toBe(true);
    expect(d.critical).toMatchObject({ state: 'menunggu-hasil', value: '—' });
    expect(hartono(d)?.note).toBe('Suspek SKA · menunggu hasil lab');
    expect(detail(d, 'Diagnosis kerja')).not.toMatch(/hiperkalemia/i);
  });

  it('nilai-kritis.hasil: nilai 6,8 dan hiperkalemia baru muncul', () => {
    const d = inbox(until(IGD, 'nilai-kritis', 'hasil'));
    expect(d.critical).toMatchObject({ state: 'menunggu-laporan', value: '6,8' });
    expect(detail(d, 'Diagnosis kerja')).toBe('Suspek sindrom koroner akut · hiperkalemia');
    expect(hartono(d)?.note).toBe('Suspek SKA, K 6,8 · nilai kritis belum diterima');
  });

  it('pratinjau lokal (skenario belum disentuh) memakai isi mockup', () => {
    const d = inbox([]);
    expect(ordered([])).toBe(true);
    expect(detail(d, 'EKG')).toBe('Irama sinus, gelombang T tinggi runcing');
    expect(detail(d, 'Tanda vital (TD · N · RR · SpO2)')).toBe('158/94 · 112 · 24 · 94%');
    expect(detail(d, 'Diagnosis kerja')).toMatch(/hiperkalemia/);
  });

  it('id tugas salah ketik → galat, bukan diam-diam "belum"', () => {
    expect(() => taskDone(runScenario(IGD, []), 'asesmen-dokter', 'ekgg')).toThrow(/tidak ada/);
  });
});
