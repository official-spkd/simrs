import { describe, expect, it } from 'vitest';
import { actor, applyAll, denied } from './backoffice-toko.testing';
import { initialPpra, type PpraEvent, ppraDomain } from './ppra-toko';

const apoteker = actor('u-apt', 'apoteker', 'Apoteker Uji');
const approve: PpraEvent = {
  type: 'putusan.dicatat',
  id: 'ams-1',
  kind: 'setuju',
  reason: 'Syok septik dengan riwayat ESBL',
  alternative: '',
  jam: '10.00',
};

describe('B08 · domain toko PPRA', () => {
  it('putusan hanya tim PPRA, bukan penulis resep, belum kedaluwarsa, sekali', () => {
    const s0 = initialPpra();
    expect(denied(ppraDomain, s0, approve, actor('u-r', 'dokter_residen'))).toMatch(/tim PPRA/);
    expect(denied(ppraDomain, s0, approve, actor('u-k', 'dokter', 'dr. Kartika Sari, Sp.P'))).toMatch(
      /pemisahan tugas/,
    );
    expect(denied(ppraDomain, s0, { ...approve, id: 'ams-3' }, apoteker)).toMatch(/kedaluwarsa/);
    const s = applyAll(ppraDomain, [[approve, apoteker]]);
    expect(s.decisions['ams-1']?.by.name).toBe('Apoteker Uji');
    expect(denied(ppraDomain, s, approve, apoteker)).toMatch(/sudah diputus/);
  });

  it('audit Gyssens berurutan menambah hasil; modul mati membuat layar baca saja', () => {
    const steps: Array<readonly [PpraEvent, ReturnType<typeof actor>]> = [
      ...Array.from({ length: 6 }, () => [{ type: 'gyssens.dijawab', caseId: 'gys-1', answer: false, jam: '10.00' }, apoteker] as const),
      [{ type: 'gyssens.dijawab', caseId: 'gys-1', answer: true, jam: '10.01' }, apoteker],
    ];
    const s = applyAll(ppraDomain, steps);
    expect(s.results.at(-1)).toBe('IIIA');
    const off = applyAll(ppraDomain, [
      [{ type: 'modul.diubah', on: false, reason: 'Uji konfigurasi RS tipe C', jam: '10.02' }, apoteker],
    ]);
    expect(off.moduleOn).toBe(false);
    expect(denied(ppraDomain, off, approve, apoteker)).toMatch(/tidak aktif/);
  });
});
