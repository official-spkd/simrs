import { describe, expect, it } from 'vitest';
import { sanitizeForLog } from '../src/common/error.filter';

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
