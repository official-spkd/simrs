import { describe, expect, it } from 'vitest';
import {
  ACCESS_ADMIN_GRANTS,
  catalogPermissionKeys,
  DEFAULT_ROLE_GRANTS,
  defaultRolesFor,
  DEVICE_GRANTS,
  DEVICE_KINDS,
  DEVICE_ONLY_RESOURCES,
  grantDiffEntry,
  isDeviceOnlyResource,
  isPermission,
  isProtectedRole,
  parseGrantDiffEntry,
  PERMISSION_CATALOG,
  PERMISSION_CATALOG_BASELINE,
  PERMISSION_CATALOG_RECORD_KEY,
  permissionAllowedFor,
  PLATFORM_ROLE_GRANTS,
  PROTECTED_ROLES,
  type RoleGrant,
  SYSTEM_ROLES,
} from './authz';
import { rolePermissionsSchema } from './schemas/iam';
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

const FRONT_OFFICE_RESOURCES = ['schedule', 'booking', 'encounter', 'coverage', 'queue', 'referral'] as const;
const grantOf = (grants: readonly RoleGrant[], resource: string, action: string) =>
  grants.find(([r, a]) => r === resource && a === action)?.[2] ?? null;

describe('izin front office (fase 2)', () => {
  it('katalog memuat sumber × aksi rencana fase 2 §0a', () => {
    expect(PERMISSION_CATALOG.schedule.actions).toEqual(['read', 'write', 'sync']);
    expect(PERMISSION_CATALOG.booking.actions).toEqual(['read', 'write', 'cancel']);
    expect(PERMISSION_CATALOG.encounter.actions).toEqual(['read', 'write', 'cancel']);
    expect(PERMISSION_CATALOG.coverage.actions).toEqual(['read', 'write']);
    expect(PERMISSION_CATALOG.queue.actions).toEqual(['read', 'call', 'manage']);
    expect(PERMISSION_CATALOG.referral.actions).toEqual(['read', 'write']);
    expect(isPermission('kiosk', 'use')).toBe(true);
    expect(isPermission('queue.display', 'read')).toBe(true);
    expect(isPermission('queue.display', 'write')).toBe(false);
  });

  it('petugas pendaftaran memegang semua izin front office berlingkup all', () => {
    const g = DEFAULT_ROLE_GRANTS.petugas_pendaftaran;
    for (const resource of FRONT_OFFICE_RESOURCES) {
      for (const action of PERMISSION_CATALOG[resource].actions) {
        expect(grantOf(g, resource, action), `${resource}.${action}`).toBe('all');
      }
    }
  });

  it('klinisi: panggil antrean lingkup unit, jadwal, kunjungan berelasi; tanpa hak ubah registrasi', () => {
    for (const role of ['dokter', 'perawat', 'bidan'] as const) {
      const g = DEFAULT_ROLE_GRANTS[role];
      expect(grantOf(g, 'queue', 'call'), role).toBe('unit');
      expect(grantOf(g, 'queue', 'read'), role).toBe('unit');
      expect(grantOf(g, 'schedule', 'read'), role).toBe('all');
      expect(grantOf(g, 'encounter', 'read'), role).toBe('relationship');
      for (const [resource, action] of [
        ['encounter', 'write'],
        ['coverage', 'write'],
        ['booking', 'write'],
        ['queue', 'manage'],
        ['schedule', 'write'],
      ] as const) {
        expect(grantOf(g, resource, action), `${role}: ${resource}.${action}`).toBeNull();
      }
    }
  });

  it('kasir, koder, RM membaca kunjungan + penjaminan; admin mengelola jadwal dan antrean', () => {
    for (const role of ['kasir', 'koder', 'petugas_rm'] as const) {
      const g = DEFAULT_ROLE_GRANTS[role];
      expect(grantOf(g, 'encounter', 'read'), role).toBe('all');
      expect(grantOf(g, 'coverage', 'read'), role).toBe('all');
      expect(grantOf(g, 'encounter', 'write'), role).toBeNull();
    }
    const admin = DEFAULT_ROLE_GRANTS.admin_tenant;
    for (const [resource, action] of [
      ['schedule', 'write'],
      ['schedule', 'sync'],
      ['queue', 'manage'],
    ] as const) {
      expect(grantOf(admin, resource, action), `${resource}.${action}`).toBe('all');
    }
    // Admin bukan petugas pendaftaran: tidak mendaftarkan pasien, tidak menerbitkan SEP.
    expect(grantOf(admin, 'encounter', 'write')).toBeNull();
    expect(grantOf(admin, 'coverage', 'write')).toBeNull();
  });

  it('hak ubah/panggil/kelola front office selalu disertai hak baca (lingkup tidak lebih sempit)', () => {
    const rank = { relationship: 1, unit: 2, all: 3 } as const;
    for (const [role, grants] of Object.entries(DEFAULT_ROLE_GRANTS)) {
      for (const resource of FRONT_OFFICE_RESOURCES) {
        for (const [r, a, scope] of grants) {
          if (r !== resource || a === 'read') continue;
          const read = grantOf(grants, resource, 'read');
          expect(read, `${role}: ${resource}.${a} tanpa ${resource}.read`).not.toBeNull();
          if (read)
            expect(rank[read], `${role}: ${resource}.read lebih sempit`).toBeGreaterThanOrEqual(rank[scope]);
        }
      }
    }
  });

  it('izin perangkat tidak pernah ada di matriks peran dan tidak bisa diberikan ke peran', () => {
    expect([...DEVICE_ONLY_RESOURCES].sort()).toEqual(['kiosk', 'queue.display']);
    for (const [role, grants] of Object.entries(allDefaults)) {
      expect(
        grants.filter(([r]) => isDeviceOnlyResource(r)),
        role,
      ).toEqual([]);
    }
    for (const resource of DEVICE_ONLY_RESOURCES) {
      expect(permissionAllowedFor('hospital', resource)).toBe(false);
      expect(permissionAllowedFor('platform', resource)).toBe(false);
    }
    const attempt = rolePermissionsSchema.safeParse({
      grants: [{ resource: 'kiosk', action: 'use', scope: 'unit' }],
    });
    expect(attempt.success).toBe(false);
    expect(
      rolePermissionsSchema.safeParse({ grants: [{ resource: 'queue', action: 'call', scope: 'unit' }] })
        .success,
    ).toBe(true);
  });

  it('perangkat: izin tetap per jenis, hanya izin perangkat, ada di katalog', () => {
    expect(Object.keys(DEVICE_GRANTS).sort()).toEqual(Object.keys(DEVICE_KINDS).sort());
    for (const [kind, grants] of Object.entries(DEVICE_GRANTS)) {
      expect(grants.length, kind).toBeGreaterThan(0);
      for (const [resource, action, scope] of grants) {
        expect(isPermission(resource, action), `${kind}: ${resource}.${action}`).toBe(true);
        expect(isDeviceOnlyResource(resource), kind).toBe(true);
        expect(scope).toBe('unit');
      }
    }
    expect(DEVICE_GRANTS.kiosk.map(([r, a]) => `${r}.${a}`)).toEqual(['kiosk.use']);
    expect(DEVICE_GRANTS.queue_display.map(([r, a]) => `${r}.${a}`)).toEqual(['queue.display.read']);
  });

  it('aturan platform.* tidak berubah; superadmin platform tanpa izin front office', () => {
    expect(permissionAllowedFor('hospital', 'platform.guide')).toBe(false);
    expect(permissionAllowedFor('platform', 'platform.guide')).toBe(true);
    expect(permissionAllowedFor('hospital', 'queue')).toBe(true);
    const platform = PLATFORM_ROLE_GRANTS.superadmin_platform.map(([r, a]) => `${r}.${a}`);
    expect(platform).toEqual([
      'platform.guide.read',
      'iam.users.read',
      'iam.users.write',
      'iam.roles.read',
      'iam.roles.write',
      'audit.read',
    ]);
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
