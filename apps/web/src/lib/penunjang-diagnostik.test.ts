import { SEED_REF_SAMPLES } from '@simrs/db';
import { describe, expect, it } from 'vitest';
import { demoDiagOrders } from './demo/fixtures/penunjang-diagnostik';
import { DOKTER } from './demo/fixtures/staf';
import { applyDiag, codeLabel, type DiagOrder, diagStage, TEMPLATES } from './penunjang-diagnostik';

const ctx = { at: '2026-10-05T10:50:00+07:00', by: 'Ns. Maya Sari, S.Kep' };
const order = (id: string): DiagOrder => {
  const o = demoDiagOrders().find((x) => x.id === id);
  if (!o) throw new Error(id);
  return o;
};
const ok = (r: ReturnType<typeof applyDiag>) => {
  if (!r.ok) throw new Error(r.code);
  return r.next;
};

describe('penunjang diagnostik lain', () => {
  it('kode ICD-9-CM hanya dari seed; pembaca ekspertise jantung/PD dari daftar dokter', () => {
    const icd = new Set(SEED_REF_SAMPLES.icd9cm.map((c) => c.code));
    for (const t of Object.values(TEMPLATES)) if (t.icd9cm) expect(icd.has(t.icd9cm), t.label).toBe(true);
    const names = DOKTER.map((d) => d.nama);
    for (const k of ['ekg', 'echo', 'endoskopi'] as const) expect(names).toContain(TEMPLATES[k].reader);
    expect(codeLabel('endoskopi')).toBe('ICD-9-CM belum dipetakan');
  });

  it('tahap awal: order, order, order, terjadwal, ditandatangani', () => {
    expect(demoDiagOrders().map(diagStage)).toEqual([
      'order',
      'order',
      'order',
      'terjadwal',
      'ditandatangani',
    ]);
  });

  it('order → jadwal → laksana (identitas wajib) → ekspertise lengkap → TTE', () => {
    const o = order('dg-01');
    expect(applyDiag(o, { type: 'laksana', identityConfirmed: true }, ctx)).toEqual({
      ok: false,
      code: 'STAGE',
    });
    expect(applyDiag(o, { type: 'jadwal', slot: 'kapan saja' }, ctx)).toEqual({
      ok: false,
      code: 'SLOT_UNKNOWN',
    });
    let next = ok(applyDiag(o, { type: 'jadwal', slot: 'Segera (cito, di tempat)' }, ctx));
    expect(applyDiag(next, { type: 'laksana', identityConfirmed: false }, ctx)).toEqual({
      ok: false,
      code: 'IDENTITY_REQUIRED',
    });
    next = ok(applyDiag(next, { type: 'laksana', identityConfirmed: true }, ctx));
    expect(applyDiag(next, { type: 'tte', findings: { Irama: 'Sinus' }, critical: false }, ctx)).toEqual({
      ok: false,
      code: 'FINDINGS_INCOMPLETE',
    });
    const findings = Object.fromEntries(TEMPLATES.ekg.fields.map((f) => [f, 'isi']));
    const r = applyDiag(next, { type: 'tte', findings, critical: true }, ctx);
    expect(r.ok && r.message).toContain('Pusat hasil kritis');
    expect(r.ok && diagStage(r.next)).toBe('ditandatangani');
  });
});
