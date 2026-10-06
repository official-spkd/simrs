import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { GOLIVE_CHECKLIST, MRMIK_EPS } from './demo/fixtures/golive';
import { canDecide, epGroup, itemStateFrom, matrixSummary, openCritical } from './golive';
import { SCREENS } from './screens';

const doc = readFileSync(
  fileURLToPath(new URL('../../../../docs/03-regulasi-mrmik.md', import.meta.url)),
  'utf8',
);

describe('kesiapan go-live · matriks MRMIK', () => {
  it('51 EP sama dengan peta docs/03 (nomor, kode EP, klasifikasi kunci/pendukung/tata kelola)', () => {
    const rows = [
      ...doc.matchAll(/^\| (\d+) \| (MRMIK [0-9.]+[a-e]) \| [^|]+\| (Kunci|Pendukung|Tata kelola) \|/gm),
    ];
    expect(rows).toHaveLength(51);
    expect(MRMIK_EPS).toHaveLength(51);
    for (const [, no, ep, kelas] of rows) {
      const e = MRMIK_EPS[Number(no) - 1];
      expect(e?.ep, `EP no ${no}`).toBe(ep);
      expect(e?.kelas).toBe(kelas === 'Tata kelola' ? 'tata-kelola' : kelas?.toLowerCase());
    }
    expect(matrixSummary(MRMIK_EPS)).toMatchObject({ kunci: 21, pendukung: 16, tataKelola: 14 });
  });

  it('tata kelola selalu ranah RS; rute bukti adalah layar terdaftar', () => {
    const routes = SCREENS.map((s) => s.route);
    for (const e of MRMIK_EPS) {
      if (e.kelas === 'tata-kelola') expect(e.status, e.ep).toBe('ranah-rs');
      if (e.route) {
        const known =
          routes.some((r) => e.route === r || e.route?.startsWith(`${r}/`)) ||
          ['/sistem/akses', '/sistem/audit', '/sistem/formulir', '/rekam-medis/mpi'].includes(e.route);
        expect(known, `${e.ep} → ${e.route}`).toBe(true);
      }
    }
    expect(epGroup('MRMIK 2.1a')).toBe('a');
    expect(epGroup('MRMIK 13.1c')).toBe('d');
  });
});

describe('kesiapan go-live · keputusan', () => {
  it('GO terkunci sampai semua item kritis selesai dan berpemilik; catatan wajib', () => {
    const state = itemStateFrom(GOLIVE_CHECKLIST);
    const open = openCritical(GOLIVE_CHECKLIST, state).map((i) => i.id);
    expect(open).toEqual(['k3', 'p2', 'c1']);
    const note = 'Pilot mulai Senin 12 Okt, hypercare 2 minggu';
    expect(canDecide('go', note, GOLIVE_CHECKLIST, state).ok).toBe(false);
    expect(canDecide('nogo', note, GOLIVE_CHECKLIST, state).ok).toBe(true);
    expect(canDecide('nogo', 'pendek', GOLIVE_CHECKLIST, state).ok).toBe(false);
    const fixed = {
      ...state,
      k3: { done: true, owner: 'Direktur' },
      p2: { done: true, owner: 'Kabid keperawatan' },
      c1: { done: true, owner: '' },
    };
    expect(openCritical(GOLIVE_CHECKLIST, fixed).map((i) => i.id)).toEqual(['c1']);
    expect(
      canDecide('go', note, GOLIVE_CHECKLIST, { ...fixed, c1: { done: true, owner: 'Kepala IT' } }).ok,
    ).toBe(true);
  });
});
