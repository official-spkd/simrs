import { describe, expect, it } from 'vitest';
import { actor, applyAll, denied } from './backoffice-toko.testing';
import { PERSONA } from './demo/fixtures/staf';
import { initialRegDocs, type RegDocsEvent, regDocsDomain } from './dokumen-toko';

const auditor = actor('u-aud', 'auditor_mutu', 'Auditor Uji');
const direktur = actor('u-dir', 'manajemen', 'Direktur Uji');
const note = 'Catatan telaah cukup panjang';

describe('B12 · domain toko dokumen regulasi', () => {
  it('setuju: posisi berhak, bukan penyusun (nama fixture atau ID sesi), catatan wajib', () => {
    const s = applyAll(regDocsDomain, [[{ type: 'dokumen.ditelaah', id: 'doc-kep-014-v3', jam: '10.00' }, auditor]]);
    const ok: RegDocsEvent = { type: 'dokumen.disetujui', id: 'doc-kep-014-v3', note, jam: '10.01' };
    expect(denied(regDocsDomain, s, ok, actor('u-p', 'perawat'))).toMatch(/Auditor mutu atau Manajemen/);
    expect(denied(regDocsDomain, s, ok, actor('u-x', 'manajemen', PERSONA.perawat))).toMatch(/pemisahan tugas/);
    expect(regDocsDomain.eventSchema.safeParse({ ...ok, note: 'pendek' }).success).toBe(false);
    expect(denied(regDocsDomain, s, ok, auditor)).toBeNull();
  });

  it('terbit membuat versi lama usang; versi baru disusun pengguna sesi (tidak mewarisi penyusun)', () => {
    const s = applyAll(regDocsDomain, [
      [{ type: 'dokumen.ditelaah', id: 'doc-kep-014-v3', jam: '10.00' }, auditor],
      [{ type: 'dokumen.disetujui', id: 'doc-kep-014-v3', note, jam: '10.01' }, direktur],
      [{ type: 'dokumen.diterbitkan', id: 'doc-kep-014-v3', jam: '10.02' }, auditor],
      [{ type: 'dokumen.versi-baru', id: 'doc-far-022-v4', jam: '10.03' }, auditor],
      [{ type: 'dokumen.ditelaah', id: 'doc-far-022-v4-r5', jam: '10.04' }, auditor],
    ]);
    expect(s.docs.find((d) => d.id === 'doc-kep-014-v2')?.status).toBe('usang');
    expect(s.docs.find((d) => d.id === 'doc-kep-014-v3')?.status).toBe('terbit');
    const v5 = s.docs.find((d) => d.id === 'doc-far-022-v4-r5');
    expect(v5?.author).toBe('Auditor Uji');
    const approve: RegDocsEvent = { type: 'dokumen.disetujui', id: 'doc-far-022-v4-r5', note, jam: '10.05' };
    expect(denied(regDocsDomain, s, approve, auditor)).toMatch(/pemisahan tugas/);
    expect(denied(regDocsDomain, s, approve, direktur)).toBeNull();
  });

  it('bukti hanya dokumen terbit, maksimal elemen bab; pengingat sekali per unit', () => {
    const s0 = initialRegDocs();
    expect(
      denied(regDocsDomain, s0, { type: 'bukti.ditautkan', chapter: 'MRMIK', docId: 'doc-kep-014-v3', jam: '10.00' }, auditor),
    ).toMatch(/berlaku/);
    const remind: RegDocsEvent = { type: 'baca.diingatkan', docId: 'doc-far-022-v4', unit: 'IGD', jam: '10.00' };
    const s = applyAll(regDocsDomain, [[remind, auditor]]);
    expect(denied(regDocsDomain, s, remind, auditor)).toMatch(/sudah dikirim/);
  });
});
