import { SEED_REF_SAMPLES } from '@simrs/db';
import {
  consentDocumentSchema,
  consentFinalizeInputSchema,
  consentRefusalInputSchema,
  cpptEntrySchema,
  cpptNoteInputSchema,
  type DischargeSummary,
  dischargeSummarySchema,
  inpatientDetailSchema,
} from '@simrs/shared';
import { describe, expect, it } from 'vitest';
import { advanceTo, applyAction, runScenario } from './demo/engine/run';
import type { ScenarioEvent, TaskValue } from './demo/engine/types';
import { CONSENT_ID, ENCOUNTER_ID } from './demo/fixtures/ids';
import { demoEndangResume, demoHendroConsent, demoInpatients } from './demo/fixtures/rawat-inap';
import { SCENARIOS } from './demo/skenario';
import {
  correctCpptEntry,
  cpptMatches,
  ewsLevel,
  ewsMaxParam,
  ewsScore,
  newCpptEntry,
  observationEwsLevel,
  resumeCompleteness,
  resumeSignBlocker,
  supersededIds,
} from './rawat-inap';
import {
  hartonoConsent,
  hartonoInpatient,
  hartonoResume,
  ratnaConsent,
  ratnaInpatient,
  ratnaResume,
  stepIndexOf,
} from './rawat-inap-scenario';

const icd10 = new Set(SEED_REF_SAMPLES.icd10.map((c) => c.code));
const icd9 = new Set(SEED_REF_SAMPLES.icd9cm.map((c) => c.code));

function play(
  id: keyof typeof SCENARIOS,
  tasks: Array<[string, TaskValue] | 'next'>,
  seq: ScenarioEvent[] = [],
) {
  const def = SCENARIOS[id];
  let cur = seq;
  for (const t of tasks) {
    const R = runScenario(def, cur);
    const r =
      t === 'next'
        ? applyAction(def, cur, { type: 'next' })
        : applyAction(def, cur, { type: 'task', step: R.step, task: t[0], value: t[1] });
    if (!r.ok) throw new Error(`${String(t)}: ${r.error}`);
    cur = r.seq;
  }
  return cur;
}

function jump(id: keyof typeof SCENARIOS, stepId: string): ScenarioEvent[] {
  const def = SCENARIOS[id];
  const r = advanceTo(def, [], stepIndexOf(runScenario(def, []), stepId));
  if (!r.ok) throw new Error(r.error);
  return r.seq;
}

describe('K04/K07/K12 · rawat inap', () => {
  it('pasien rawat inap lolos kontrak ketat; kode diagnosis/prosedur ⊂ seed', () => {
    for (const d of demoInpatients()) {
      expect(() => inpatientDetailSchema.parse(d)).not.toThrow();
      expect(d.medications.length).toBeGreaterThanOrEqual(2);
      for (const c of d.summary.diagnoses) {
        expect(c.system === 'ICD-10' ? icd10.has(c.code) : icd9.has(c.code)).toBe(true);
      }
    }
    const endang = demoInpatients().find((d) => d.summary.encounterId === ENCOUNTER_ID.endang);
    expect(endang?.medications).toHaveLength(7);
    expect(endang?.summary.day).toBe(5);
  });

  it('koreksi CPPT membuat versi baru yang menunjuk entri lama; entri lama tidak berubah', () => {
    const at = '2026-10-05T11:00:00+07:00';
    const v1 = newCpptEntry({
      id: 'c1',
      encounterId: ENCOUNTER_ID.endang,
      role: 'perawat',
      author: 'Ns. Uji',
      at,
      soap: { s: 'Nyeri', o: 'SpO2 69%', a: 'Masalah', p: '' },
    });
    const snapshot = structuredClone(v1);
    const v2 = correctCpptEntry([v1], 'c1', {
      id: 'c2',
      author: 'Ns. Uji',
      role: 'perawat',
      at,
      soap: { s: 'Nyeri', o: 'SpO2 96%', a: 'Masalah', p: '' },
      reason: 'Salah ketik nilai SpO2',
    });
    expect(v2).toMatchObject({ version: 2, supersedesId: 'c1', correctionReason: 'Salah ketik nilai SpO2' });
    expect(v1).toEqual(snapshot);
    expect(() => cpptEntrySchema.parse(v2)).not.toThrow();
    expect(supersededIds([v1, v2]).has('c1')).toBe(true);
    expect(() =>
      correctCpptEntry([v1, v2], 'c1', {
        id: 'c4',
        author: 'Ns. Uji',
        role: 'perawat',
        at,
        soap: v2,
        reason: 'Koreksi lagi versi lama',
      }),
    ).toThrow();
    expect(() =>
      correctCpptEntry([v1], 'c1', {
        id: 'c3',
        author: 'x',
        role: 'perawat',
        at,
        soap: v1,
        reason: 'pendek',
      }),
    ).toThrow();
    const bad = {
      encounterId: ENCOUNTER_ID.endang,
      s: 'a',
      o: '',
      a: 'b',
      p: '',
      supersedesId: 'c1',
      correctionReason: null,
    };
    expect(cpptNoteInputSchema.safeParse(bad).success).toBe(false);
    expect(cpptEntrySchema.safeParse({ ...v2, correctionReason: null }).success).toBe(false);
    expect(newCpptEntry({ ...v1, at, soap: v1, role: 'residen' }).cosignRequired).toBe(true);
    expect(cpptMatches({ role: 'bidan' }, 'perawat')).toBe(true);
  });

  it('EWS dewasa dihitung dari tanda vital; tingkat dan tindak lanjut', () => {
    expect(
      ewsScore({ temp: 37.6, hr: 92, rr: 22, sbp: 128, spo2: 95, onOxygen: false, consciousness: 'A' }),
    ).toBe(4);
    expect(
      ewsScore({ temp: 38.4, hr: 112, rr: 24, sbp: 96, spo2: 93, onOxygen: true, consciousness: 'A' }),
    ).toBe(11);
    expect(ewsLevel(4).level).toBe('rendah');
    expect(ewsLevel(5).level).toBe('sedang');
    expect(ewsLevel(7).level).toBe('tinggi');
  });

  it('EWS: satu parameter bernilai 3 menaikkan ke minimal sedang (NEWS2), juga di rekam rawat inap', () => {
    const o = {
      at: '2026-10-05T08:00:00+07:00',
      temp: 37,
      hr: 80,
      rr: 26,
      sbp: 122,
      dbp: 78,
      spo2: 97,
      onOxygen: false,
      consciousness: 'A' as const,
    };
    const obs = { ...o, score: ewsScore(o) };
    expect([obs.score, ewsMaxParam(obs)]).toEqual([3, 3]);
    expect(ewsLevel(obs.score).level).toBe('rendah');
    expect(observationEwsLevel(obs).level).toBe('sedang');
    expect(observationEwsLevel(obs).action).toMatch(/Satu parameter bernilai 3/);
    expect(observationEwsLevel({ ...obs, rr: 18, score: 0 }).level).toBe('rendah');

    // Ringkasan daftar/banner (lastEws + lastEwsMaxParam) = tingkat observasi terakhir di tabel observasi.
    const all = [
      ...demoInpatients(),
      hartonoInpatient(runScenario(SCENARIOS['igd-ranap'], jump('igd-ranap', 'rawat-inap'))),
    ];
    for (const d of all) {
      const last = d?.observations.at(-1);
      if (!d || !last) continue;
      const s = d.summary;
      expect([s.encounterId, ewsLevel(s.lastEws, s.lastEwsMaxParam).level]).toEqual([
        s.encounterId,
        observationEwsLevel(last).level,
      ]);
    }
  });

  it('Tn. Hartono masuk rawat inap setelah serah terima; CPPT bertambah mengikuti lompatan hari', () => {
    const def = SCENARIOS['igd-ranap'];
    expect(hartonoInpatient(runScenario(def, jump('igd-ranap', 'admisi')))).toBeNull();
    const start = jump('igd-ranap', 'rawat-inap');
    const d0 = hartonoInpatient(runScenario(def, start));
    expect(d0).not.toBeNull();
    expect(() => inpatientDetailSchema.parse(d0)).not.toThrow();
    expect(d0?.summary).toMatchObject({ bed: 'ICU 3', wardCode: 'ICU', scenario: true });
    expect(d0?.summary.flags).toContain('cosign');
    expect(d0?.medications.find((m) => m.kfa === '93002210')?.slots[1]?.state).toBe('jadwal');

    const after = play(
      'igd-ranap',
      [
        ['emar', true],
        ['h1', true],
        ['echo', true],
        ['pindah', true],
      ],
      start,
    );
    const d1 = hartonoInpatient(runScenario(def, after));
    expect(d1?.summary).toMatchObject({ bed: 'A-12', wardCode: 'ANGGREK' });
    expect(d1?.cppt.length).toBeGreaterThan(d0?.cppt.length ?? 0);
    expect(d1?.cppt.find((c) => c.role === 'residen')?.cosignedBy).not.toBeNull();
    expect(d1?.medications.find((m) => m.kfa === '93002210')?.slots[1]?.state).toBe('diberikan');
    expect(d1?.summary.diagnoses.map((x) => x.code)).toEqual(expect.arrayContaining(['I21.4', '88.72']));
    for (const c of d1?.summary.diagnoses ?? []) {
      expect(c.system === 'ICD-10' ? icd10.has(c.code) : icd9.has(c.code)).toBe(true);
    }
  });

  it('Ny. Ratna dirawat sejak SEP; pasca operasi menambah prosedur 51.23', () => {
    const def = SCENARIOS['elektif-btn'];
    expect(ratnaInpatient(runScenario(def, []))).toBeNull();
    const post = jump('elektif-btn', 'pasca-operasi');
    const d = ratnaInpatient(runScenario(def, post));
    expect(() => inpatientDetailSchema.parse(d)).not.toThrow();
    expect(d?.summary.diagnoses.map((x) => x.code)).toEqual(['K80.2', '51.23']);
    expect(d?.summary.bed).toBe('VIP 3');
  });
});

describe('K13 · resume medis', () => {
  const codesOk = (s: DischargeSummary) =>
    s.codes.every((c) => (c.system === 'ICD-10' ? icd10.has(c.code) : icd9.has(c.code)));

  it('aturan kelengkapan: 12 butir; TTE terkunci dengan alasan sampai lengkap, lalu final', () => {
    const s = dischargeSummarySchema.parse(demoEndangResume());
    expect(codesOk(s)).toBe(true);
    const c = resumeCompleteness(s.checklist);
    expect(c).toMatchObject({ done: 11, total: 12, complete: false });
    expect(c.missing).toEqual(['rekonsiliasi obat pulang dikonfirmasi dpjp']);
    expect(resumeSignBlocker(c, true, false)).toMatch(/^TTE terkunci: lengkapi 1 butir lagi/);
    const full = resumeCompleteness(s.checklist.map((x) => ({ ...x, done: true })));
    expect(resumeSignBlocker(full, true, false)).toBeNull();
    expect(resumeSignBlocker(full, false, false)).toMatch(/DPJP/);
    expect(resumeSignBlocker(full, true, true)).toMatch(/addendum/);
  });

  it('resume Tn. Hartono terisi seiring milestone; TTE baru terbuka setelah himpun + rekonsiliasi', () => {
    const def = SCENARIOS['igd-ranap'];
    const early = hartonoResume(runScenario(def, []));
    expect(() => dischargeSummarySchema.parse(early)).not.toThrow();
    expect(early.sections.every((x) => x.body === '')).toBe(true);
    expect(resumeCompleteness(early.checklist).done).toBe(1);

    const atResume = jump('igd-ranap', 'resume');
    const mid = hartonoResume(runScenario(def, atResume));
    const filled = mid.sections.filter((x) => x.body).map((x) => x.id);
    expect(filled).toEqual(expect.arrayContaining(['anamnesis', 'fisik', 'penunjang', 'terapi']));
    expect(filled).not.toContain('obat-pulang');
    expect(resumeCompleteness(mid.checklist).complete).toBe(false);

    const himpun = play('igd-ranap', [['resume', true]], atResume);
    const h = hartonoResume(runScenario(def, himpun));
    expect(h.codes.map((x) => x.code)).toEqual(['I21.4', 'E87.5', 'N18.3', 'I10', '89.52', '88.72']);
    expect(codesOk(h)).toBe(true);
    expect(resumeCompleteness(h.checklist).missing).toEqual(['rekonsiliasi obat pulang dikonfirmasi dpjp']);

    const signed = play(
      'igd-ranap',
      [
        ['rekon', 'stop'],
        ['tte', true],
      ],
      himpun,
    );
    const f = hartonoResume(runScenario(def, signed));
    expect(resumeCompleteness(f.checklist).complete).toBe(true);
    expect(f.medications.find((m) => m.name.startsWith('Amlodipin'))?.change).toBe('dihentikan');
    expect(f.signedBy).not.toBeNull();
    expect(f.sections.find((x) => x.id === 'tindak-lanjut')?.body).toMatch(/Poli Jantung/);
  });

  it('resume Ny. Ratna memuat laporan operasi; kode ⊂ seed', () => {
    const def = SCENARIOS['elektif-btn'];
    const seq = play('elektif-btn', [['resume', true]], jump('elektif-btn', 'resume'));
    const r = ratnaResume(runScenario(def, seq));
    expect(() => dischargeSummarySchema.parse(r)).not.toThrow();
    expect(r.sections.find((x) => x.id === 'operasi')?.body).toMatch(/laparoskopik/);
    expect(r.codes.map((x) => x.code)).toEqual(['K80.2', '51.23']);
    expect(codesOk(r)).toBe(true);
    expect(resumeCompleteness(r.checklist).complete).toBe(true);
  });
});

describe('K11 · persetujuan tindakan', () => {
  it('dokumen lolos kontrak (7 butir informasi); persetujuan Tn. Hartono final setelah tugas consent', () => {
    expect(() => consentDocumentSchema.parse(demoHendroConsent())).not.toThrow();
    const def = SCENARIOS['igd-ranap'];
    const atTl = jump('igd-ranap', 'tata-laksana');
    const before = hartonoConsent(runScenario(def, atTl));
    expect(consentDocumentSchema.parse(before)).toMatchObject({ status: 'draf', finalAt: null });
    const signed = play(
      'igd-ranap',
      [
        ['k', 'lengkap'],
        ['cds', 'ganti'],
        ['dispo', 'icu'],
        ['consent', true],
      ],
      atTl,
    );
    const after = hartonoConsent(runScenario(def, signed));
    expect(after.status).toBe('final');
    expect(after.finalAt).not.toBeNull();
    expect(ratnaConsent(runScenario(SCENARIOS['elektif-btn'], [])).status).toBe('draf');
  });

  it('penolakan wajib alasan; TTE wajib 7 butir dipahami, dua tanda tangan, dan saksi petugas', () => {
    expect(consentRefusalInputSchema.safeParse({ consentId: CONSENT_ID.hendro, reason: '' }).success).toBe(
      false,
    );
    expect(
      consentRefusalInputSchema.safeParse({ consentId: CONSENT_ID.hendro, reason: 'Takut' }).success,
    ).toBe(false);
    expect(
      consentRefusalInputSchema.safeParse({
        consentId: CONSENT_ID.hendro,
        reason: 'Ingin berdiskusi dengan keluarga dulu',
      }).success,
    ).toBe(true);
    const ok = {
      consentId: CONSENT_ID.hendro,
      acknowledged: demoHendroConsent().items.map((i) => i.id),
      patient: { method: 'goresan', name: 'Sekar Gunawan' },
      witness: { method: 'nama', name: 'Dimas Gunawan' },
      staffWitnessPresent: true,
    };
    expect(consentFinalizeInputSchema.safeParse(ok).success).toBe(true);
    expect(consentFinalizeInputSchema.safeParse({ ...ok, staffWitnessPresent: false }).success).toBe(false);
    expect(
      consentFinalizeInputSchema.safeParse({ ...ok, acknowledged: ok.acknowledged.slice(1) }).success,
    ).toBe(false);
  });
});
