import { formSchemaSchema, scoreForm, validateAnswers } from '@simrs/shared';
import { describe, expect, it } from 'vitest';
import { ENCOUNTER_ID } from './demo/fixtures/ids';
import {
  ASSESSMENT_FORMS,
  ASSESSMENT_PACKAGES,
  ASSESSMENT_RESPONSES,
  assessmentForm,
  assessmentResponsesFor,
} from './demo/fixtures/rme-asesmen';
import { demoRmeCharts } from './demo/fixtures/rme-pasien';
import {
  type AssessmentForm,
  assessmentStatus,
  canWriteForm,
  latestResponse,
  newResponse,
  packageProgress,
  responseVersions,
  scoreFollowUp,
  statusLabel,
} from './rme-asesmen';

const NOW = '2026-10-05T10:45:00+07:00';
const form = (code: string): AssessmentForm => {
  const f = assessmentForm(code);
  if (!f) throw new Error(code);
  return f;
};

describe('asesmen dan skrining (K06)', () => {
  it('definisi formulir sah menurut skema P07; isian fixture lolos validasi', () => {
    for (const f of ASSESSMENT_FORMS) expect(formSchemaSchema.safeParse(f.schema).success, f.code).toBe(true);
    for (const r of ASSESSMENT_RESPONSES) {
      expect(validateAnswers(form(r.formCode).schema, r.answers), r.id).toEqual({});
    }
    for (const codes of Object.values(ASSESSMENT_PACKAGES))
      for (const c of codes) expect(assessmentForm(c)).toBeDefined();
  });

  it('skor otomatis: Morse Ny. Endang 35 (risiko sedang); MST ikut logika tampil', () => {
    const morse = latestResponse(ASSESSMENT_RESPONSES, 'morse_dewasa');
    expect(morse && scoreForm(form('morse_dewasa').schema, morse.answers)).toMatchObject({
      total: 35,
      band: { label: 'Risiko sedang' },
    });
    const mst = form('skrining_gizi_mst').schema;
    expect(scoreForm(mst, { bb_turun: 'ya', bb_jumlah: 'kg_6_10', asupan_turun: 'ya' }).total).toBe(3);
    expect(validateAnswers(mst, { bb_turun: 'ya', asupan_turun: 'tidak' })).toHaveProperty('bb_jumlah');
  });

  it('status: belum diisi ≤ 24 jam, final, reasesmen jatuh tempo', () => {
    const started = '2026-10-01T09:30:00+07:00';
    const endang = ASSESSMENT_RESPONSES.filter((r) => r.encounterId === ENCOUNTER_ID.endang);
    expect(assessmentStatus(form('morse_dewasa'), endang, started, NOW).kind).toBe('reasesmen');
    const nyeri = assessmentStatus(form('nyeri_nrs'), endang, started, NOW);
    expect(nyeri.kind === 'final' && nyeri.nextDueAt).toBe('2026-10-05T07:00:00.000Z');
    expect(assessmentStatus(form('asesmen_awal_medis'), endang, started, NOW).kind).toBe('final');
    const kosong = assessmentStatus(form('nyeri_nrs'), [], '2026-10-04T20:10:00+07:00', NOW);
    expect(kosong).toMatchObject({ kind: 'belum', overdue: false });
    expect(statusLabel(kosong, NOW)).toEqual({ text: 'Belum diisi · batas 20.10', tone: 'warning' });
    const lewat = assessmentStatus(form('nyeri_nrs'), [], '2026-10-03T08:00:00+07:00', NOW);
    expect(statusLabel(lewat, NOW).tone).toBe('danger');
    expect(packageProgress([kosong, nyeri])).toEqual({ done: 1, total: 2 });
  });

  it('hak tulis per profesi', () => {
    expect(canWriteForm(form('morse_dewasa'), 'perawat')).toBe(true);
    expect(canWriteForm(form('morse_dewasa'), 'dokter')).toBe(false);
    expect(canWriteForm(form('asesmen_awal_medis'), 'dokter_residen')).toBe(true);
    expect(canWriteForm(form('asesmen_awal_medis'), null)).toBe(false);
  });

  it('tindak lanjut skor', () => {
    const s = (total: number) => ({ total, answered: 1, scored: 1, band: null });
    expect(scoreFollowUp('morse_dewasa', s(45))?.tone).toBe('danger');
    expect(scoreFollowUp('morse_dewasa', s(35))?.tone).toBe('warning');
    expect(scoreFollowUp('nyeri_nrs', s(8))?.text).toMatch(/lapor DPJP/);
    expect(scoreFollowUp('skrining_gizi_mst', s(2))?.text).toMatch(/rujuk dietisien/);
    expect(scoreFollowUp('nyeri_nrs', { total: 0, answered: 0, scored: 1, band: null })).toBeNull();
  });

  it('koreksi = versi baru beralasan; isian lama tetap', () => {
    const f = form('nyeri_nrs');
    const v1 = newResponse({
      id: 'a',
      form: f,
      encounterId: 'e',
      answers: { skala: 'n2' },
      by: 'x',
      at: NOW,
    });
    expect(() =>
      newResponse({
        id: 'b',
        form: f,
        encounterId: 'e',
        answers: {},
        by: 'x',
        at: NOW,
        correct: { prev: v1, reason: 'x' },
      }),
    ).toThrow(/minimal 10/);
    const v2 = newResponse({
      id: 'b',
      form: f,
      encounterId: 'e',
      answers: { skala: 'n5' },
      by: 'x',
      at: NOW,
      correct: { prev: v1, reason: 'Salah pilih skala nyeri' },
    });
    expect(v2).toMatchObject({ version: 2, supersedesId: 'a', reason: 'Salah pilih skala nyeri' });
    expect(latestResponse([v1, v2], 'nyeri_nrs')?.id).toBe('b');
    expect(responseVersions([v1, v2], 'b').map((r) => r.version)).toEqual([1, 2]);
  });

  it('pasien rawat inap tanpa isian fixture tetap punya asesmen awal final', () => {
    for (const c of demoRmeCharts().filter((x) => x.setting === 'rawat-inap')) {
      const rs = assessmentResponsesFor({ ...c, riwayat: 'Riwayat uji' });
      expect(latestResponse(rs, 'asesmen_awal_medis'), c.encounterId).not.toBeNull();
      for (const r of rs) expect(validateAnswers(form(r.formCode).schema, r.answers)).toEqual({});
    }
  });
});
