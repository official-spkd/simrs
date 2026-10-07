import { describe, expect, it } from 'vitest';
import { revAfterAction } from './rev';

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
