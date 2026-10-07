import { PRESENTATION_PERSONAS, PRESENTATION_USERNAME_PREFIX as DB_PREFIX } from '@simrs/db';
import { SYSTEM_ROLES } from '@simrs/shared';
import { describe, expect, it } from 'vitest';
import { ALL_ACCESS_USERNAME, groupPersonas, PRESENTATION_USERNAME_PREFIX } from './personas';

describe('akun presentasi', () => {
  it('awalan nama pengguna sama dengan pembuatnya di @simrs/db', () => {
    expect(PRESENTATION_USERNAME_PREFIX).toBe(DB_PREFIX);
  });

  it('17 persona = 17 peran sistem + Superadmin demo paling atas, semuanya di kelompok yang dikenal', () => {
    expect(new Set(PRESENTATION_PERSONAS.map((p) => p.role))).toEqual(new Set(Object.keys(SYSTEM_ROLES)));
    const groups = groupPersonas(
      PRESENTATION_PERSONAS.map((p) => ({
        username: `${DB_PREFIX}${p.slug}`,
        displayName: p.displayName,
        role: p.role,
        roleName: p.role,
        unitName: null,
        ...(p.allAccess ? { allAccess: true as const } : {}),
      })),
    );
    expect(groups.map((g) => g.title)).toEqual([
      'Superadmin demo',
      'Front office',
      'Klinis',
      'Penunjang',
      'Keuangan & rekam medis',
      'Manajemen & sistem',
    ]);
    expect(groups.flatMap((g) => g.personas)).toHaveLength(18);
    expect(groups[0]?.personas.map((p) => p.username)).toEqual([ALL_ACCESS_USERNAME]);
    // Tidak diulang di kelompok Manajemen: posisi manajemen tetap satu akun (direksi).
    expect(groups.flatMap((g) => g.personas).filter((p) => p.role === 'manajemen')).toHaveLength(2);
    expect(groups[5]?.personas.filter((p) => p.role === 'manajemen').map((p) => p.username)).toEqual([
      `${DB_PREFIX}direksi`,
    ]);
    expect(groups[2]?.personas.map((p) => p.role)).toEqual(['dokter', 'dokter_residen', 'perawat', 'bidan']);
  });

  it('nama pengguna Superadmin demo sama dengan persona bertanda allAccess di @simrs/db', () => {
    expect(PRESENTATION_PERSONAS.filter((p) => p.allAccess).map((p) => `${DB_PREFIX}${p.slug}`)).toEqual([
      ALL_ACCESS_USERNAME,
    ]);
  });

  it('nama pengguna lolos aturan USERNAME (tanpa garis bawah)', () => {
    for (const p of PRESENTATION_PERSONAS)
      expect(`${DB_PREFIX}${p.slug}`).toMatch(/^[a-z0-9][a-z0-9._@-]{2,99}$/);
  });
});
