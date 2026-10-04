import { PRESENTATION_PERSONAS, PRESENTATION_USERNAME_PREFIX as DB_PREFIX } from '@simrs/db';
import { SYSTEM_ROLES } from '@simrs/shared';
import { describe, expect, it } from 'vitest';
import { groupPersonas, PRESENTATION_USERNAME_PREFIX } from './personas';

describe('akun presentasi', () => {
  it('awalan nama pengguna sama dengan pembuatnya di @simrs/db', () => {
    expect(PRESENTATION_USERNAME_PREFIX).toBe(DB_PREFIX);
  });

  it('16 persona = 16 peran sistem, semuanya masuk kelompok yang dikenal (tanpa "Lainnya")', () => {
    expect(new Set(PRESENTATION_PERSONAS.map((p) => p.role))).toEqual(new Set(Object.keys(SYSTEM_ROLES)));
    const groups = groupPersonas(
      PRESENTATION_PERSONAS.map((p) => ({
        username: `${DB_PREFIX}${p.slug}`,
        displayName: p.displayName,
        role: p.role,
        roleName: p.role,
        unitName: null,
      })),
    );
    expect(groups.map((g) => g.title)).toEqual([
      'Front office',
      'Klinis',
      'Penunjang',
      'Keuangan & rekam medis',
      'Manajemen & sistem',
    ]);
    expect(groups.flatMap((g) => g.personas)).toHaveLength(16);
    expect(groups[1]?.personas.map((p) => p.role)).toEqual(['dokter', 'dokter_residen', 'perawat', 'bidan']);
  });

  it('nama pengguna lolos aturan USERNAME (tanpa garis bawah)', () => {
    for (const p of PRESENTATION_PERSONAS)
      expect(`${DB_PREFIX}${p.slug}`).toMatch(/^[a-z0-9][a-z0-9._@-]{2,99}$/);
  });
});
