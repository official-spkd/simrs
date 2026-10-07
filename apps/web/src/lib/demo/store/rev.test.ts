import { describe, expect, it } from 'vitest';
import { DomainRevisions, revAfterAction } from './rev';

describe('revAfterAction (aksi berantai toko demo)', () => {
  it('aksi berhasil: revisi berikutnya = revisi dari server, tanpa menunggu prop halaman', () => {
    expect(revAfterAction(7, { ok: true, rev: 8 })).toBe(8);
  });

  it('aksi gagal atau basi: revisi tetap (prop halaman yang dimuat ulang menjadi sumbernya)', () => {
    expect(revAfterAction(7, { ok: false })).toBe(7);
    expect(revAfterAction(7, { ok: false, rev: 9 })).toBe(7);
  });

  it('aksi khusus domain tanpa revisi di hasilnya: perilaku lama', () => {
    expect(revAfterAction(7, { ok: true })).toBe(7);
    expect(revAfterAction(7, { ok: true, rev: '8' })).toBe(7);
  });
});

describe('DomainRevisions (komponen lain di domain yang sama)', () => {
  it('tab kedua yang terpasang dengan prop lama memakai revisi aksi terakhir domain itu', () => {
    const revs = new DomainRevisions();
    revs.record('rekam-medis-adm', { ok: true, rev: 12 });
    expect(revs.toSend('rekam-medis-adm', 11)).toBe(12);
    // Domain lain tidak terpengaruh (revisi proyeksinya sendiri).
    expect(revs.toSend('sdm', 5)).toBe(5);
  });

  it('prop halaman yang lebih baru (perubahan di tab lain) menang', () => {
    const revs = new DomainRevisions();
    revs.record('ppi', { ok: true, rev: 12 });
    expect(revs.toSend('ppi', 15)).toBe(15);
  });

  it('basi → ingatan dilupakan; prop halaman yang dimuat ulang jadi sumber (mis. data demo dibuat ulang)', () => {
    const revs = new DomainRevisions();
    revs.record('ppi', { ok: true, rev: 40 });
    revs.record('ppi', { ok: false, stale: true });
    expect(revs.toSend('ppi', 3)).toBe(3);
  });

  it('aksi gagal biasa atau tanpa revisi tidak mengubah ingatan', () => {
    const revs = new DomainRevisions();
    revs.record('ppi', { ok: true, rev: 9 });
    revs.record('ppi', { ok: false });
    revs.record('ppi', { ok: true });
    expect(revs.toSend('ppi', 8)).toBe(9);
  });
});
