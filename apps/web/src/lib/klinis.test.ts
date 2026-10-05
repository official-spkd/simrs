import { SEED_REF_SAMPLES } from '@simrs/db';
import { cpoeContextSchema, poliEncounterSchema, poliWorklistSchema } from '@simrs/shared';
import { describe, expect, it } from 'vitest';
import { advanceTo, applyAction, runScenario } from './demo/engine/run';
import type { RunResult, ScenarioDef, ScenarioEvent, TaskValue } from './demo/engine/types';
import { ENCOUNTER_ID, PATIENT_ID } from './demo/fixtures/ids';
import {
  CPOE_CATALOG,
  CPOE_ORDER_SETS,
  demoCpoeAvailable,
  demoCpoeContext,
  demoCpoeEncounters,
  doneValue,
  hartonoCpoeOpen,
  demoPoliEncounter,
  demoPoliWorklist,
  SURYO_QUEUE,
  suryoQueueItem,
  suryoVitals,
} from './demo/fixtures/klinis';
import { IGD_RANAP } from './demo/skenario/igd-ranap';
import { RAWAT_JALAN } from './demo/skenario/rawat-jalan';
import {
  canRecordVitals,
  canWriteDoctorNote,
  canWriteOrders,
  cpptNeedsCosign,
  EGFR_LOW_THRESHOLD,
  egfrLow,
  filterQueue,
  ICD10_OPTIONS,
  labValueFlag,
  minutesToJam,
  nextWaiting,
  queueCounts,
  stageSteps,
  VALUE_FLAG_LABEL,
  vitalValueFlag,
} from './klinis';

const seed = (system: keyof typeof SEED_REF_SAMPLES) => new Set(SEED_REF_SAMPLES[system].map((s) => s.code));

function advance(def: ScenarioDef, stepId: string, seq: ScenarioEvent[] = []): ScenarioEvent[] {
  const r = advanceTo(
    def,
    seq,
    def.steps.findIndex((s) => s.id === stepId),
  );
  if (!r.ok) throw new Error(r.error);
  return r.seq;
}

function act(def: ScenarioDef, seq: ScenarioEvent[], task: string, value: TaskValue = true): ScenarioEvent[] {
  const R = runScenario(def, seq);
  const r = applyAction(def, seq, { type: 'task', step: R.step, task, value });
  if (!r.ok) throw new Error(`${task}: ${r.error}`);
  return r.seq;
}

const rj0 = runScenario(RAWAT_JALAN, []);
const igd0 = runScenario(IGD_RANAP, []);
/** Tn. Hartono di langkah asesmen dokter IGD (CPOE IGD terbuka). */
const igdAsesmen = runScenario(IGD_RANAP, advance(IGD_RANAP, 'asesmen-dokter'));

describe('data dummy pemeriksaan poli dan CPOE', () => {
  it('antrean, ringkasan kunjungan, dan konteks CPOE lolos kontrak ketat', () => {
    const rjDone = runScenario(RAWAT_JALAN, advance(RAWAT_JALAN, 'kasir'));
    for (const rj of [rj0, rjDone]) {
      const w = poliWorklistSchema.parse(demoPoliWorklist(rj));
      for (const q of w.items)
        expect(() => poliEncounterSchema.parse(demoPoliEncounter(q.patientId, rj))).not.toThrow();
      for (const igd of [igd0, igdAsesmen]) {
        for (const e of demoCpoeEncounters(rj, igd)) {
          expect(() => cpoeContextSchema.parse(demoCpoeContext(e.encounterId, rj, igd))).not.toThrow();
        }
      }
    }
    expect(demoCpoeContext('kj-tidak-ada', rj0, igd0)).toBeNull();
    expect(demoPoliEncounter('ps-tidak-ada', rj0)).toBeNull();
  });

  it('kode klinis hanya dari rujukan seed (ICD-10, LOINC, KFA, ICD-9-CM)', () => {
    const icd10 = new Map(SEED_REF_SAMPLES.icd10.map((s) => [s.code, s.display]));
    for (const o of ICD10_OPTIONS) expect(icd10.get(o.code), o.code).toBe(o.display);
    const systems = { LOINC: seed('loinc'), KFA: seed('kfa'), 'ICD-9-CM': seed('icd9cm') } as const;
    for (const c of CPOE_CATALOG) {
      if (c.code) expect(systems[c.code.system].has(c.code.code), `${c.id} ${c.code.code}`).toBe(true);
      for (const m of c.meta.match(/\d{3,5}-\d/g) ?? [])
        expect(seed('loinc').has(m), `${c.id} ${m}`).toBe(true);
      if (c.kind === 'obat' && !c.code) expect(c.meta).toContain('KFA belum dipetakan');
    }
    const loinc = seed('loinc');
    for (const q of demoPoliWorklist(rj0).items) {
      const e = demoPoliEncounter(q.patientId, rj0);
      for (const d of e?.diagnoses ?? []) expect(icd10.has(d.code), d.code).toBe(true);
      for (const l of e?.labs ?? []) if (l.loinc) expect(loinc.has(l.loinc), l.loinc).toBe(true);
    }
  });

  it('order set hanya berisi item katalog; tarif bilangan bulat rupiah', () => {
    const ids = new Set(CPOE_CATALOG.map((c) => c.id));
    expect(ids.size).toBe(CPOE_CATALOG.length);
    for (const s of CPOE_ORDER_SETS)
      for (const id of s.itemIds) expect(ids.has(id), `${s.id} → ${id}`).toBe(true);
    for (const c of CPOE_CATALOG) expect(c.tariff).toMatch(/^\d+$/);
  });

  it('CPOE Ny. Rohana tanpa blok di awal; Tn. Darmawan: asam mefenamat diblokir (alergi ibuprofen)', () => {
    const rohana = demoCpoeContext(ENCOUNTER_ID.rohana, rj0, igd0);
    expect(rohana?.patient.allergies).toEqual(['Amoksisilin']);
    expect(rohana?.orders.every((o) => o.cds.level !== 'block')).toBe(true);
    const darmawan = demoCpoeContext(ENCOUNTER_ID.darmawan, rj0, igd0);
    expect(darmawan?.orders.find((o) => o.catalogId === 'asam-mefenamat-500')?.cds.level).toBe('block');
  });
});

describe('antrean poli dan tampilan', () => {
  const items = demoPoliWorklist(rj0).items;

  it('filter chip, pencarian No. RM tanpa tanda hubung, pasien menunggu berikutnya', () => {
    expect(queueCounts(items)).toEqual({ semua: 7, menunggu: 1, hasil: 1 });
    expect(filterQueue(items, 'semua', '00315746').map((i) => i.name)).toEqual(['Ny. Sri Wahyuni']);
    expect(filterQueue(items, 'hasil', '').map((i) => i.queueNo)).toEqual(['PD-023']);
    expect(nextWaiting(items)?.queueNo).toBe('PD-026');
    expect(stageSteps(2).map((s) => s.state)).toEqual([
      'selesai',
      'selesai',
      'aktif',
      'belum',
      'belum',
      'belum',
    ]);
    expect(minutesToJam(7 * 60 + 5)).toBe('07.05');
  });

  it('nilai di luar batas bertulisan: arah tanda vital, bendera lab, eGFR rendah', () => {
    expect(vitalValueFlag('tinggi')).toBe('tinggi');
    expect(vitalValueFlag('rendah')).toBe('rendah');
    expect(vitalValueFlag('normal')).toBeNull();
    expect(vitalValueFlag('belum')).toBeNull();
    expect((['', 'H', 'L', 'A', 'K'] as const).map(labValueFlag)).toEqual([
      null,
      'tinggi',
      'rendah',
      'abnormal',
      'kritis',
    ]);
    expect(Object.values(VALUE_FLAG_LABEL)).toEqual(['Tinggi', 'Rendah', 'Abnormal', 'Kritis']);
    expect(egfrLow(EGFR_LOW_THRESHOLD - 1)).toBe(true);
    expect(egfrLow(EGFR_LOW_THRESHOLD)).toBe(false);
    expect(egfrLow(null)).toBe(false);
  });
});

describe('proyeksi pasien skenario', () => {
  it('Tn. Suryo baru masuk antrean Poli PD (PD-027) setelah SEP terbit', () => {
    let seq = advance(RAWAT_JALAN, 'pendaftaran');
    seq = act(RAWAT_JALAN, act(RAWAT_JALAN, seq, 'panggil'), 'cek');
    const before = runScenario(RAWAT_JALAN, seq);
    expect(suryoQueueItem(before)).toBeNull();
    expect(demoPoliWorklist(before).items.some((i) => i.patientId === PATIENT_ID.suryo)).toBe(false);
    const after = runScenario(RAWAT_JALAN, act(RAWAT_JALAN, seq, 'sep'));
    const item = demoPoliWorklist(after).items.find((i) => i.patientId === PATIENT_ID.suryo);
    expect(item).toMatchObject({
      queueNo: SURYO_QUEUE,
      status: 'menunggu',
      waitNote: 'menunggu asesmen perawat',
    });
    expect(SURYO_QUEUE).toBe('PD-027');
    expect(demoPoliEncounter(PATIENT_ID.suryo, after)?.patient.sep).toBe('0301R0011026V005102');
  });

  it('tanda vital Tn. Suryo berasal dari rekam medis skenario setelah tugas asesmen perawat', () => {
    let seq = advance(RAWAT_JALAN, 'asesmen-perawat');
    expect(
      demoPoliEncounter(PATIENT_ID.suryo, runScenario(RAWAT_JALAN, seq))?.vitals.every(
        (v) => v.flag === 'belum',
      ),
    ).toBe(true);
    seq = act(RAWAT_JALAN, seq, 'td', '150/95');
    seq = act(RAWAT_JALAN, seq, 'gds', '250');
    const R = runScenario(RAWAT_JALAN, act(RAWAT_JALAN, seq, 'jatuh', 'tinggi'));
    expect(R.rec.ttv).toBe('TD 150/95 · GDS 250 mg/dL');
    const e = demoPoliEncounter(PATIENT_ID.suryo, R);
    expect(e?.vitals.find((v) => v.id === 'td')).toMatchObject({ value: '150/95', flag: 'tinggi' });
    expect(e?.vitals.find((v) => v.id === 'gds')).toMatchObject({ value: '250', flag: 'tinggi' });
    expect(e?.patient.fallRisk).toBe('Risiko jatuh tinggi · gelang kuning');
    expect(e?.stage).toBe(2);
    expect(suryoVitals('TD 118/76').find((v) => v.id === 'td')?.flag).toBe('normal');
  });

  it('dokter: diagnosis E11.9 dan order lab dari rekam medis; resep terapi A diblokir CDS riwayat hipoglikemia', () => {
    let seq = advance(RAWAT_JALAN, 'pemeriksaan-dokter');
    seq = act(RAWAT_JALAN, act(RAWAT_JALAN, act(RAWAT_JALAN, seq, 'panggil'), 'dx'), 'order', 'paket');
    const R = runScenario(RAWAT_JALAN, seq);
    expect(demoPoliEncounter(PATIENT_ID.suryo, R)?.diagnoses.map((d) => d.code)).toEqual(['E11.9']);
    expect(suryoQueueItem(R)?.status).toBe('menunggu-hasil');
    seq = act(RAWAT_JALAN, advance(RAWAT_JALAN, 'resep', seq), 'terapi', 'a');
    const cpoe = demoCpoeContext(ENCOUNTER_ID.suryo, runScenario(RAWAT_JALAN, seq), igd0);
    expect(cpoe?.orders.filter((o) => o.kind === 'lab').map((o) => o.status)).toEqual([
      'terkirim',
      'terkirim',
      'terkirim',
    ]);
    expect(cpoe?.orders.find((o) => o.catalogId === 'glimepirid-2')?.cds).toMatchObject({
      level: 'block',
      rule: 'riwayat',
    });
    expect(cpoe?.results.map((r) => r.loinc)).toEqual(['4548-4', '13457-7', '2160-0']);
    const ganti = demoCpoeContext(
      ENCOUNTER_ID.suryo,
      runScenario(RAWAT_JALAN, act(RAWAT_JALAN, seq, 'cds', 'ganti')),
      igd0,
    );
    expect(ganti?.orders.some((o) => o.catalogId === 'glimepirid-2')).toBe(false);
    const lanjut = demoCpoeContext(
      ENCOUNTER_ID.suryo,
      runScenario(RAWAT_JALAN, act(RAWAT_JALAN, seq, 'cds', 'lanjut')),
      igd0,
    );
    expect(lanjut?.orders.find((o) => o.catalogId === 'glimepirid-2')?.cds.message).toMatch(/^Override/);
  });

  it('Tn. Hartono: klopidogrel tertahan interaksi omeprazol sampai CDS ditindaklanjuti', () => {
    let seq = act(IGD_RANAP, advance(IGD_RANAP, 'tata-laksana'), 'k', 'lengkap');
    const pending = demoCpoeContext(ENCOUNTER_ID.hartono, rj0, runScenario(IGD_RANAP, seq));
    const clop = pending?.orders.find((o) => o.catalogId === 'klopidogrel-75');
    expect(clop).toMatchObject({ status: 'draf', cds: { level: 'block', rule: 'interaksi' } });
    seq = act(IGD_RANAP, seq, 'cds', 'ganti');
    const done = demoCpoeContext(ENCOUNTER_ID.hartono, rj0, runScenario(IGD_RANAP, seq));
    expect(done?.orders.find((o) => o.catalogId === 'klopidogrel-75')).toMatchObject({
      status: 'terkirim',
      cds: { level: 'info' },
    });
    expect(done?.orders.some((o) => o.catalogId === 'pantoprazol-40')).toBe(true);
    expect(done?.results.find((r) => r.name === 'Kalium')?.flag).toBe('K');
  });
});

describe('ketersediaan CPOE kunjungan', () => {
  const listed = (igd: RunResult) => demoCpoeEncounters(rj0, igd).map((e) => e.encounterId);

  it('Tn. Hartono: CPOE IGD hanya dari asesmen dokter sampai serah terima admisi; di luar itu 404', () => {
    const triase = runScenario(IGD_RANAP, advance(IGD_RANAP, 'triase'));
    for (const igd of [igd0, triase]) {
      expect(hartonoCpoeOpen(igd)).toBe(false);
      expect(demoCpoeContext(ENCOUNTER_ID.hartono, rj0, igd)).toBeNull();
      expect(listed(igd)).not.toContain(ENCOUNTER_ID.hartono);
    }
    for (const step of ['asesmen-dokter', 'nilai-kritis', 'tata-laksana']) {
      const igd = runScenario(IGD_RANAP, advance(IGD_RANAP, step));
      expect(demoCpoeContext(ENCOUNTER_ID.hartono, rj0, igd)?.setting, step).toBe('igd');
      expect(listed(igd), step).toContain(ENCOUNTER_ID.hartono);
    }
    // Langkah admisi: tetap terbuka sampai tugas `transfer` selesai, lalu tertutup (order lanjut di rawat inap).
    let seq = advance(IGD_RANAP, 'admisi');
    for (let guard = 0; guard < 10; guard++) {
      const R = runScenario(IGD_RANAP, seq);
      if (doneValue(R, 'admisi', 'transfer') !== undefined) break;
      expect(hartonoCpoeOpen(R)).toBe(true);
      const r = applyAction(IGD_RANAP, seq, { type: 'auto' });
      if (!r.ok) throw new Error(r.error);
      seq = r.seq;
    }
    const transferred = runScenario(IGD_RANAP, seq);
    expect(doneValue(transferred, 'admisi', 'transfer')).toBe(true);
    expect(demoCpoeContext(ENCOUNTER_ID.hartono, rj0, transferred)).toBeNull();
    expect(listed(transferred)).not.toContain(ENCOUNTER_ID.hartono);
    const ranap = runScenario(IGD_RANAP, advance(IGD_RANAP, 'rawat-inap'));
    expect(demoCpoeContext(ENCOUNTER_ID.hartono, rj0, ranap)).toBeNull();
  });

  it('demoCpoeAvailable selaras demoCpoeContext (dasar tautan "Order" di layar lain)', () => {
    const ranap = runScenario(IGD_RANAP, advance(IGD_RANAP, 'rawat-inap'));
    const ids = [
      ENCOUNTER_ID.suryo,
      ENCOUNTER_ID.hartono,
      ENCOUNTER_ID.rohana,
      ENCOUNTER_ID.darmawan,
      ENCOUNTER_ID.ratna,
      'kj-tidak-ada',
    ];
    for (const igd of [igd0, igdAsesmen, ranap]) {
      for (const id of ids) {
        expect(demoCpoeAvailable(id, igd), id).toBe(demoCpoeContext(id, rj0, igd) !== null);
      }
    }
    expect(demoCpoeAvailable(ENCOUNTER_ID.rohana, igd0)).toBe(true);
    // Ny. Endang dirawat inap (Melati M-203), bukan pasien poli: tidak punya CPOE rawat jalan.
    expect(demoCpoeAvailable(ENCOUNTER_ID.endang, igd0)).toBe(false);
    expect(demoCpoeAvailable('kj-tidak-ada', igdAsesmen)).toBe(false);
  });
});

describe('posisi dan co-sign CPPT poli', () => {
  it('CPPT dokter dan order: dokter/residen; tanda vital: perawat/bidan; posisi lain tidak keduanya', () => {
    for (const role of ['dokter', 'dokter_residen']) {
      expect(canWriteDoctorNote(role), role).toBe(true);
      expect(canWriteOrders(role), role).toBe(true);
      expect(canRecordVitals(role), role).toBe(false);
    }
    for (const role of ['perawat', 'bidan']) {
      expect(canWriteDoctorNote(role), role).toBe(false);
      expect(canWriteOrders(role), role).toBe(false);
      expect(canRecordVitals(role), role).toBe(true);
    }
    for (const role of [null, undefined, '', 'apoteker', 'kasir']) {
      expect(canWriteDoctorNote(role)).toBe(false);
      expect(canWriteOrders(role)).toBe(false);
      expect(canRecordVitals(role)).toBe(false);
    }
  });

  it('CPPT dokter residen perlu co-sign DPJP sebelum final (selaras CPPT rawat inap)', () => {
    expect(cpptNeedsCosign('dokter_residen')).toBe(true);
    expect(cpptNeedsCosign('dokter')).toBe(false);
    expect(cpptNeedsCosign('perawat')).toBe(false);
    expect(cpptNeedsCosign(null)).toBe(false);
  });
});
