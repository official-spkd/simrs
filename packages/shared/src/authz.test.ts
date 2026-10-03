import { describe, expect, it } from 'vitest';
import {
  ACCESS_ADMIN_GRANTS,
  DEFAULT_ROLE_GRANTS,
  defaultRolesFor,
  isPermission,
  isProtectedRole,
  PERMISSION_CATALOG,
  PLATFORM_ROLE_GRANTS,
  PROTECTED_ROLES,
  SYSTEM_ROLES,
} from './authz';

const allDefaults = { ...DEFAULT_ROLE_GRANTS, ...PLATFORM_ROLE_GRANTS };

describe('katalog izin dan matriks bawaan', () => {
  it('setiap izin bawaan ada di katalog (salah ketik tidak diam-diam memberi/menghapus akses)', () => {
    for (const [role, grants] of Object.entries(allDefaults)) {
      for (const [resource, action] of grants) {
        expect(isPermission(resource, action), `${role}: ${resource}.${action}`).toBe(true);
      }
    }
  });

  it('tidak ada izin ganda per peran', () => {
    for (const [role, grants] of Object.entries(allDefaults)) {
      const keys = grants.map(([r, a]) => `${r}.${a}`);
      expect(new Set(keys).size, role).toBe(keys.length);
    }
  });

  it('hak minimum: hanya peran tertentu yang boleh mengubah peran, melihat NIK utuh, atau menggabung pasien', () => {
    const holders = (resource: string, action: string) =>
      Object.entries(DEFAULT_ROLE_GRANTS)
        .filter(([, g]) => g.some(([r, a]) => r === resource && a === action))
        .map(([role]) => role)
        .sort();
    expect(holders('iam.roles', 'write')).toEqual(['admin_tenant']);
    expect(holders('patient', 'merge')).toEqual(['petugas_rm']);
    expect(holders('patient.identity', 'read')).toEqual(['petugas_pendaftaran', 'petugas_rm']);
    expect(holders('break_glass', 'review')).toEqual(['petugas_privasi']);
    // Panduan platform tidak pernah diberikan ke peran RS.
    expect(holders('platform.guide', 'read')).toEqual([]);
  });

  it('16 peran RS dan 1 peran platform; peran pelindung memegang izin kelola akses', () => {
    expect(Object.keys(SYSTEM_ROLES)).toHaveLength(16);
    expect(defaultRolesFor('hospital').map((r) => r.code)).toContain('admin_tenant');
    expect(defaultRolesFor('platform').map((r) => r.code)).toEqual(['superadmin_platform']);
    for (const role of PROTECTED_ROLES) {
      const grants = allDefaults[role];
      for (const [resource, action] of ACCESS_ADMIN_GRANTS) {
        expect(
          grants.some(([r, a, s]) => r === resource && a === action && s === 'all'),
          `${role}: ${resource}.${action}`,
        ).toBe(true);
      }
    }
    expect(isProtectedRole('superadmin_platform')).toBe(true);
    expect(isProtectedRole('perawat')).toBe(false);
    expect(isProtectedRole(null)).toBe(false);
  });

  it('superadmin platform tanpa akses data pasien', () => {
    const resources = PLATFORM_ROLE_GRANTS.superadmin_platform.map(([r]) => r);
    expect(
      resources.filter((r) => r.startsWith('patient') || r.startsWith('forms') || r === 'break_glass'),
    ).toEqual([]);
    expect(isPermission('constructor', 'read')).toBe(false);
    expect(Object.keys(PERMISSION_CATALOG).length).toBeGreaterThan(10);
  });
});
