import { describe, expect, it } from 'vitest';
import { LOGBOOK, TRAINEES } from './demo/fixtures/pendidikan';
import { cosignRule, levelUpBlock, returnBlock, verifiedCount } from './pendidikan';

describe('B10 · pendidikan klinik', () => {
  it('aturan co-sign mengikuti tingkat supervisi', () => {
    expect(cosignRule(1)).toMatch(/sebelum/);
    expect(cosignRule(2)).toMatch(/sebelum/);
    expect(cosignRule(3)).toMatch(/retrospektif/);
    expect(cosignRule(4)).toMatch(/Tanpa co-sign/);
  });

  it('residen: 4 tindakan terverifikasi (observasi tidak dihitung); verifikasi kelima membuka kenaikan tingkat', () => {
    const t = TRAINEES[0];
    if (!t) throw new Error('fixture');
    const n = verifiedCount(LOGBOOK, t.id, t.competency);
    expect(n).toBe(4);
    expect(levelUpBlock(t.level, n)).toMatch(/baru 4/);
    const after = LOGBOOK.map((e) => (e.id === 'lb-05' ? { ...e, status: 'terverifikasi' as const } : e));
    expect(levelUpBlock(t.level, verifiedCount(after, t.id, t.competency))).toBeNull();
    const obs = LOGBOOK.map((e) => (e.id === 'lb-06' ? { ...e, status: 'terverifikasi' as const } : e));
    expect(verifiedCount(obs, t.id, t.competency)).toBe(4);
    expect(levelUpBlock(4, 10)).toMatch(/tertinggi/);
  });

  it('pengembalian logbook wajib umpan balik', () => {
    expect(returnBlock('kurang')).toMatch(/10 huruf/);
    expect(returnBlock('Lokasi tusukan belum didokumentasikan')).toBeNull();
  });
});
