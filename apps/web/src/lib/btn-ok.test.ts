import { SEED_REF_SAMPLES } from '@simrs/db';
import type { OrCase } from '@simrs/shared';
import { describe, expect, it } from 'vitest';
import {
  canConfirmPhase,
  checkCounts,
  COUNT_ITEM,
  currentPhase,
  ganttBox,
  incisionGate,
  itemChecked,
  timeOutComplete,
} from './btn-ok';
import { KAMAR_OK, KASUS_SKENARIO_OK } from './demo/fixtures/btn';
import { DOKTER, STAF_LAIN } from './demo/fixtures/staf';

const icd10 = new Set(SEED_REF_SAMPLES.icd10.map((c) => c.code));
const icd9 = new Set(SEED_REF_SAMPLES.icd9cm.map((c) => c.code));
const cases = KAMAR_OK.flatMap((r) => r.cases);

const check = (c: OrCase, phase: number, ids: string[]): OrCase => ({
  ...c,
  checklist: c.checklist.map((p, i) =>
    i === phase
      ? { ...p, items: p.items.map((it) => (ids.includes(it.id) ? { ...it, checked: true } : it)) }
      : p,
  ),
});
const confirm = (c: OrCase, phase: number): OrCase => ({
  ...c,
  checklist: c.checklist.map((p, i) =>
    i === phase ? { ...p, confirmedAt: '2026-10-05T10:47:00+07:00', confirmedBy: STAF_LAIN.perawat[0] } : p,
  ),
});

describe('jadwal kamar operasi', () => {
  it('kode prosedur/diagnosis hanya dari seed; tim dari daftar staf fiktif', () => {
    const names = new Set<string>([...DOKTER.map((d) => d.nama), ...STAF_LAIN.perawat, ...STAF_LAIN.bidan]);
    for (const c of cases) {
      if (c.icd9cm) expect(icd9.has(c.icd9cm), c.icd9cm).toBe(true);
      if (c.diagnosis) expect(icd10.has(c.diagnosis.icd10), c.diagnosis.icd10).toBe(true);
      for (const n of [c.operator, c.anesthetist, c.nurses.scrub, c.nurses.circulating])
        expect(names.has(n), n).toBe(true);
    }
    expect(cases.map((c) => c.icd9cm)).toEqual(expect.arrayContaining(['51.23', '74.1', '79.35']));
    expect(new Set(cases.map((c) => c.status))).toEqual(
      new Set(['selesai', 'berjalan', 'terjadwal', 'cito']),
    );
  });

  it('posisi blok Gantt 07.00–16.00 dan garis sekarang 10.45', () => {
    expect(ganttBox(10 * 60 + 30, 120, 420, 960)).toEqual({
      left: (210 / 540) * 100,
      width: (120 / 540) * 100,
    });
    expect(ganttBox(15 * 60, 120, 420, 960).width).toBeCloseTo((60 / 540) * 100);
    expect(ganttBox(10 * 60 + 45, 0, 420, 960).left).toBeCloseTo(41.666, 2);
  });
});

describe('gerbang time out (surgical safety checklist)', () => {
  it('kasus skenario: sign in lengkap, time out 3/5 → insisi terkunci', () => {
    const c = KASUS_SKENARIO_OK;
    expect(currentPhase(c.checklist)).toBe(1);
    expect(timeOutComplete(c.checklist)).toBe(false);
    const gate = incisionGate(c);
    expect(gate.allowed).toBe(false);
    if (!gate.allowed) expect(gate.remaining).toBe(2);
    expect(canConfirmPhase(c, 1)).toBe(false);
    expect(canConfirmPhase(c, 2)).toBe(false);
  });

  it('time out lengkap tapi belum dikonfirmasi tetap terkunci; setelah konfirmasi insisi terbuka', () => {
    const full = check(KASUS_SKENARIO_OK, 1, ['time-out-4', 'time-out-5']);
    expect(canConfirmPhase(full, 1)).toBe(true);
    const gate = incisionGate(full);
    expect(gate.allowed).toBe(false);
    if (!gate.allowed) expect(gate.reason).toMatch(/belum dikonfirmasi/);
    expect(incisionGate(confirm(full, 1)).allowed).toBe(true);
  });

  it('fase tidak bisa dilompati: sign out tidak bisa dikonfirmasi sebelum time out', () => {
    const c = check(KASUS_SKENARIO_OK, 2, ['sign-out-1', 'sign-out-3', 'sign-out-4', 'sign-out-5']);
    expect(canConfirmPhase(c, 2)).toBe(false);
  });

  it('hitung akhir harus lengkap dan sama dengan hitung awal; butir hitung sign out mengikuti hasilnya', () => {
    const base = KASUS_SKENARIO_OK;
    expect(checkCounts(base.counts)).toMatchObject({ filled: 0, ok: false });
    const wrong = base.counts.map((x) => ({ ...x, final: x.id === 'kb' ? 19 : x.initial }));
    expect(checkCounts(wrong)).toMatchObject({ ok: false, mismatches: ['kasa besar 19 dari 20'] });
    const right = base.counts.map((x) => ({ ...x, final: x.initial }));
    expect(checkCounts(right).ok).toBe(true);
    const signOut = base.checklist[2];
    if (!signOut) throw new Error('sign out');
    expect(itemChecked(signOut, COUNT_ITEM, wrong)).toBe(false);
    expect(itemChecked(signOut, COUNT_ITEM, right)).toBe(true);
  });
});
