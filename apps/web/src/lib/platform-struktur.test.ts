import { SEED_UNITS } from '@simrs/db';
import { describe, expect, it } from 'vitest';
import { DEMO_STRUCTURE } from './demo/fixtures/platform';
import {
  addChild,
  bedCountUnder,
  bedSummary,
  canDeactivate,
  canReactivate,
  deactivate,
  pathOf,
  reactivate,
  unitOf,
} from './platform-struktur';

const nodes = [...DEMO_STRUCTURE];

describe('P01 · fixture struktur', () => {
  it('id unik; setiap induk ada; jenis anak sesuai tingkat', () => {
    expect(new Set(nodes.map((n) => n.id)).size).toBe(nodes.length);
    const byId = new Map(nodes.map((n) => [n.id, n]));
    const order = ['faskes', 'unit', 'ruang', 'kamar', 'bed'];
    for (const n of nodes) {
      if (n.parentId === null) {
        expect(n.kind).toBe('faskes');
        continue;
      }
      const parent = byId.get(n.parentId);
      expect(parent, n.id).toBeDefined();
      expect(order.indexOf(n.kind)).toBe(order.indexOf(parent?.kind ?? '') + 1);
    }
  });

  it('semua unit seed ada dengan jenis yang sama', () => {
    for (const u of SEED_UNITS) {
      const found = nodes.find((n) => n.kind === 'unit' && n.code === u.code);
      expect(found?.unitKind, u.code).toBe(u.kind);
    }
  });
});

describe('P01 · aturan struktur', () => {
  it('jalur dan unit simpul', () => {
    const bed = 'u-melati/mlt-lt3/m-203/a';
    expect(pathOf(nodes, bed).map((n) => n.kind)).toEqual(['faskes', 'unit', 'ruang', 'kamar', 'bed']);
    expect(unitOf(nodes, bed)?.code).toBe('MELATI');
  });

  it('rekap bed per kelas: nonaktif tidak dihitung tersedia', () => {
    const k1 = bedSummary(nodes).find((r) => r.careClass === 'kelas_1');
    expect(k1).toEqual({ careClass: 'kelas_1', total: 6, occupied: 4, inactive: 2 });
    expect(bedCountUnder(nodes, 'u-melati')).toEqual({ total: 18, occupied: 10 });
  });

  it('tidak bisa menonaktifkan faskes utama atau simpul dengan bed terisi', () => {
    expect(canDeactivate(nodes, 'f-utama').ok).toBe(false);
    const ranap = canDeactivate(nodes, 'u-melati');
    expect(ranap.ok).toBe(false);
    if (!ranap.ok) expect(ranap.reason).toMatch(/10 bed masih terisi/);
    expect(canDeactivate(nodes, 'u-melati/mlt-lt3/m-212').ok).toBe(true);
    expect(canDeactivate(nodes, 'u-lab').ok).toBe(true);
  });

  it('nonaktifkan menurun ke semua turunan; aktifkan kembali butuh induk aktif', () => {
    const after = deactivate(nodes, 'u-melati/mlt-lt3/m-212');
    expect(after.filter((n) => n.id.startsWith('u-melati/mlt-lt3/m-212')).every((n) => !n.active)).toBe(true);
    expect(canReactivate(after, 'u-melati/mlt-lt3/m-212/a').ok).toBe(false);
    expect(canReactivate(after, 'u-melati/mlt-lt3/m-212').ok).toBe(true);
    const back = reactivate(after, 'u-melati/mlt-lt3/m-212');
    expect(back.find((n) => n.id === 'u-melati/mlt-lt3/m-212')?.active).toBe(true);
  });

  it('tambah kamar: kode baku, unik per induk, kelas wajib di rawat inap; bed mewarisi kelas', () => {
    const ruang = 'u-melati/mlt-lt3';
    expect(addChild(nodes, ruang, { code: 'm 214', name: 'Kamar M-214' })).toMatchObject({
      ok: false,
      field: 'code',
    });
    expect(addChild(nodes, ruang, { code: 'M-203', name: 'Kamar M-203' })).toMatchObject({
      ok: false,
      field: 'code',
    });
    expect(addChild(nodes, ruang, { code: 'M-214', name: 'Kamar M-214' })).toMatchObject({
      ok: false,
      field: 'careClass',
    });
    const r = addChild(nodes, ruang, { code: 'm-214', name: 'Kamar M-214', careClass: 'kelas_2' });
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.node).toMatchObject({ kind: 'kamar', code: 'M-214', careClass: 'kelas_2', active: true });
    const bed = addChild(r.nodes, r.node.id, { code: 'A', name: 'Bed M-214-A' });
    expect(bed.ok && bed.node).toMatchObject({ kind: 'bed', careClass: 'kelas_2', occupied: false });
  });

  it('unit baru: kode unik se-RS dan jenis wajib; induk nonaktif ditolak', () => {
    expect(addChild(nodes, 'f-utama', { code: 'LAB', name: 'Lab 2', unitKind: 'penunjang' })).toMatchObject({
      ok: false,
      field: 'code',
    });
    expect(addChild(nodes, 'f-utama', { code: 'HEMODIALISIS', name: 'Unit Hemodialisis' })).toMatchObject({
      ok: false,
      field: 'unitKind',
    });
    expect(
      addChild(nodes, 'f-utama', { code: 'HEMODIALISIS', name: 'Unit Hemodialisis', unitKind: 'instalasi' })
        .ok,
    ).toBe(true);
    expect(addChild(nodes, 'u-poli-gigi-cpk', { code: 'R1', name: 'Ruang 1' })).toMatchObject({
      ok: false,
      field: 'parent',
    });
    expect(addChild(nodes, 'u-melati/mlt-lt3/m-203/a', { code: 'X', name: 'Xx' })).toMatchObject({
      ok: false,
      field: 'parent',
    });
  });
});
