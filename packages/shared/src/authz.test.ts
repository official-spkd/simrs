import { describe, expect, it } from 'vitest';
import {
  ACCESS_ADMIN_GRANTS,
  catalogPermissionKeys,
  DEFAULT_ROLE_GRANTS,
  defaultRolesFor,
  grantDiffEntry,
  isPermission,
  isProtectedRole,
  parseGrantDiffEntry,
  PERMISSION_CATALOG,
  PERMISSION_CATALOG_BASELINE,
  PERMISSION_CATALOG_RECORD_KEY,
  permissionAllowedFor,
  PLATFORM_ROLE_GRANTS,
  PROTECTED_ROLES,
  SYSTEM_ROLES,
} from './authz';
import { isTenantSettingKey } from './settings';

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

describe('sinkron izin katalog', () => {
  it('baseline = subset katalog (izin tidak pernah dihapus dari katalog tanpa disadari)', () => {
    const keys = catalogPermissionKeys();
    expect(PERMISSION_CATALOG_BASELINE.filter((k) => !keys.includes(k))).toEqual([]);
    expect(new Set(PERMISSION_CATALOG_BASELINE).size).toBe(PERMISSION_CATALOG_BASELINE.length);
    expect(keys).toContain('iam.users.write');
    expect(keys).toEqual([...keys].sort());
  });

  it('matriks bawaan RS tidak pernah memuat izin platform', () => {
    for (const role of defaultRolesFor('hospital')) {
      for (const [resource] of role.grants) {
        expect(permissionAllowedFor('hospital', resource), `${role.code}: ${resource}`).toBe(true);
      }
    }
    expect(permissionAllowedFor('hospital', 'platform.guide')).toBe(false);
    expect(permissionAllowedFor('platform', 'platform.guide')).toBe(true);
  });

  it('catatan katalog bukan pengaturan RS (tidak bisa diubah lewat API pengaturan)', () => {
    expect(isTenantSettingKey(PERMISSION_CATALOG_RECORD_KEY)).toBe(false);
  });

  it('entri selisih audit bolak-balik, termasuk sumber bertitik', () => {
    const entry = grantDiffEntry({ resource: 'iam.users', action: 'write', scope: 'all' });
    expect(entry).toBe('iam.users.write:all');
    expect(parseGrantDiffEntry(entry)).toEqual({ permission: 'iam.users.write', scope: 'all' });
    expect(parseGrantDiffEntry('patient.read:relationship')).toEqual({
      permission: 'patient.read',
      scope: 'relationship',
    });
    for (const bad of ['', 'tanpa-lingkup', ':all', 'audit.read:', 'tanpatitik:all']) {
      expect(parseGrantDiffEntry(bad), bad).toBeNull();
    }
  });
});
