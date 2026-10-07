import { describe, expect, it } from 'vitest';
import { committed } from './rekam';

describe('committed (aksi rekam medis toko demo)', () => {
  it('berhasil: hasil membawa revisi toko baru agar aksi berikutnya tidak basi', () => {
    expect(committed({ ok: true, rev: 42 }, { ok: true, message: 'Tersimpan' })).toEqual({
      ok: true,
      message: 'Tersimpan',
      rev: 42,
    });
  });

  it('basi/gagal: pesan galat, tanpa revisi', () => {
    expect(committed({ ok: false, error: 'Basi', stale: true }, { ok: true, message: 'x' })).toEqual({
      ok: false,
      message: 'Basi',
      stale: true,
    });
  });
});
