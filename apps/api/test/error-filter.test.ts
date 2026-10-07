import { describe, expect, it } from 'vitest';
import { mapDbError, sanitizeForLog } from '../src/common/error.filter';

describe('sanitizeForLog', () => {
  it('membuang pesan galat (bisa memuat PHI) dan menyimpan nama, kode, frame stack', () => {
    const err = Object.assign(
      new Error('Invalid create: { name: "Pasien Fiktif", nik: "9999010101900001" }'),
      {
        code: 'P2009',
      },
    );
    const out = sanitizeForLog(err);
    expect(out.name).toBe('Error');
    expect(out.code).toBe('P2009');
    expect(JSON.stringify(out)).not.toContain('9999010101900001');
    expect(JSON.stringify(out)).not.toContain('Pasien Fiktif');
    expect(out.stack).toMatch(/^\s*at /);
  });

  it('nilai non-Error hanya dicatat tipenya', () => {
    expect(sanitizeForLog('rahasia')).toEqual({ name: 'string' });
  });
});

describe('mapDbError (galat Prisma yang bukan bug program)', () => {
  it('deadlock/konflik tulis serentak (P2034) → 409 CONFLICT, bukan 500', () => {
    expect(mapDbError({ code: 'P2034' })).toEqual([409, expect.objectContaining({ code: 'CONFLICT' })]);
  });

  it('transaksi tidak bisa dimulai dalam batas tunggu (P2028) → 503 SERVICE_BUSY', () => {
    expect(mapDbError({ code: 'P2028' })).toEqual([503, expect.objectContaining({ code: 'SERVICE_BUSY' })]);
  });

  it('kode lain tetap tidak dipetakan (jatuh ke INTERNAL_ERROR)', () => {
    expect(mapDbError({ code: 'P2009' })).toBeNull();
  });
});
