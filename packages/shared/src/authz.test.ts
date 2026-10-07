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
  isPermissionKey,
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
  SCOPE_RANK,
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

  it('17 peran RS (fase 4: ahli gizi) dan 1 peran platform; peran pelindung memegang izin kelola akses', () => {
    expect(Object.keys(SYSTEM_ROLES)).toHaveLength(17);
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
    expect(isPermissionKey('queue.display.read')).toBe(true);
    expect(isPermissionKey('schedule.sync')).toBe(true);
    expect(isPermissionKey('schedule.delete')).toBe(false);
    expect(isPermissionKey('schedule')).toBe(false);
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
    expect([...DEVICE_ONLY_RESOURCES].sort()).toEqual(['kiosk', 'lab.analyzer', 'queue.display']);
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

describe('izin klinis (fase 3, rencana §3.0a)', () => {
  const CLINICAL_RESOURCES = [
    'clinical',
    'order',
    'medication',
    'triage',
    'bed',
    'consent',
    'result',
  ] as const;
  const holders = (resource: string, action: string) =>
    Object.entries(DEFAULT_ROLE_GRANTS)
      .filter(([, g]) => g.some(([r, a]) => r === resource && a === action))
      .map(([role]) => role)
      .sort();

  it('katalog memuat sumber × aksi klinis', () => {
    expect(PERMISSION_CATALOG.clinical.actions).toEqual(['read', 'write', 'correct', 'cosign', 'sign']);
    expect(PERMISSION_CATALOG.order.actions).toEqual(['read', 'write', 'cancel', 'manage']);
    expect(PERMISSION_CATALOG.medication.actions).toEqual(['administer']);
    expect(PERMISSION_CATALOG.triage.actions).toEqual(['write']);
    expect(PERMISSION_CATALOG.bed.actions).toEqual(['read', 'write']);
    expect(PERMISSION_CATALOG.consent.actions).toEqual(['read', 'write', 'sign']);
    expect(PERMISSION_CATALOG.result.actions).toEqual(['read', 'write']);
    for (const key of ['medication.administer', 'triage.write', 'clinical.cosign', 'order.manage']) {
      expect(isPermissionKey(key), key).toBe(true);
    }
    // Izin klinis baru bukan baseline: sinkron izin menambahkannya ke peran RS yang sudah ada.
    expect(PERMISSION_CATALOG_BASELINE.filter((k) => k.startsWith('clinical.'))).toEqual([]);
  });

  it('dokter: catatan klinis lingkup unit; co-sign, TTE, dan tanda tangan persetujuan hanya relasi', () => {
    const g = DEFAULT_ROLE_GRANTS.dokter;
    for (const action of ['read', 'write', 'correct'] as const) {
      expect(grantOf(g, 'clinical', action)).toBe('unit');
    }
    expect(grantOf(g, 'clinical', 'cosign')).toBe('relationship');
    expect(grantOf(g, 'clinical', 'sign')).toBe('relationship');
    expect(grantOf(g, 'consent', 'sign')).toBe('relationship');
    expect(grantOf(g, 'order', 'write')).toBe('unit');
    expect(grantOf(g, 'order', 'manage')).toBeNull();
  });

  it('residen menulis tanpa co-sign/TTE; order dan triase boleh', () => {
    const g = DEFAULT_ROLE_GRANTS.dokter_residen;
    expect(grantOf(g, 'clinical', 'write')).toBe('unit');
    expect(grantOf(g, 'clinical', 'correct')).toBe('unit');
    expect(grantOf(g, 'clinical', 'cosign')).toBeNull();
    expect(grantOf(g, 'clinical', 'sign')).toBeNull();
    expect(grantOf(g, 'order', 'write')).toBe('unit');
    expect(grantOf(g, 'triage', 'write')).toBe('unit');
    expect(grantOf(g, 'consent', 'sign')).toBeNull();
  });

  it('perawat/bidan: catatan, eMAR, triase, bed — semuanya lingkup unit, tanpa order/co-sign', () => {
    for (const role of ['perawat', 'bidan'] as const) {
      const g = DEFAULT_ROLE_GRANTS[role];
      for (const [resource, action] of [
        ['clinical', 'read'],
        ['clinical', 'write'],
        ['clinical', 'correct'],
        ['medication', 'administer'],
        ['triage', 'write'],
        ['bed', 'read'],
        ['bed', 'write'],
      ] as const) {
        expect(grantOf(g, resource, action), `${role}: ${resource}.${action}`).toBe('unit');
      }
      expect(grantOf(g, 'order', 'write'), role).toBeNull();
      expect(grantOf(g, 'clinical', 'cosign'), role).toBeNull();
      expect(grantOf(g, 'clinical', 'sign'), role).toBeNull();
    }
  });

  it('pendaftaran: bed lingkup all; RM/koder baca klinis all; manajemen baca bed; auditor mutu baca order', () => {
    expect(grantOf(DEFAULT_ROLE_GRANTS.petugas_pendaftaran, 'bed', 'write')).toBe('all');
    // Papan IGD + triase loket IGD: baca klinis dan triase lingkup unit, tanpa menulis catatan klinis.
    expect(grantOf(DEFAULT_ROLE_GRANTS.petugas_pendaftaran, 'clinical', 'read')).toBe('unit');
    expect(grantOf(DEFAULT_ROLE_GRANTS.petugas_pendaftaran, 'triage', 'write')).toBe('unit');
    expect(grantOf(DEFAULT_ROLE_GRANTS.petugas_pendaftaran, 'clinical', 'write')).toBeNull();
    // Perawat/bidan menyiapkan draf persetujuan, menjadi saksi, memandu tablet; tanda tangan hanya dokter.
    for (const role of ['perawat', 'bidan'] as const) {
      expect(grantOf(DEFAULT_ROLE_GRANTS[role], 'consent', 'write'), role).toBe('unit');
      expect(grantOf(DEFAULT_ROLE_GRANTS[role], 'consent', 'read'), role).toBe('unit');
    }
    expect(holders('consent', 'sign')).toEqual(['dokter']);
    expect(grantOf(DEFAULT_ROLE_GRANTS.petugas_rm, 'clinical', 'read')).toBe('all');
    expect(grantOf(DEFAULT_ROLE_GRANTS.koder, 'clinical', 'read')).toBe('all');
    expect(grantOf(DEFAULT_ROLE_GRANTS.koder, 'clinical', 'write')).toBeNull();
    expect(grantOf(DEFAULT_ROLE_GRANTS.manajemen, 'bed', 'read')).toBe('all');
    expect(grantOf(DEFAULT_ROLE_GRANTS.manajemen, 'bed', 'write')).toBeNull();
    expect(grantOf(DEFAULT_ROLE_GRANTS.auditor_mutu, 'order', 'read')).toBe('all');
  });

  it('hak minimum: pemberian obat, co-sign, TTE, dan kelola order set/CDS', () => {
    expect(holders('medication', 'administer')).toEqual(['bidan', 'perawat']);
    expect(holders('clinical', 'cosign')).toEqual(['dokter']);
    expect(holders('clinical', 'sign')).toEqual(['dokter']);
    // Order set institusi dan basis CDS dikelola komite farmasi/PFT yang ditetapkan RS (keputusan 10): tanpa bawaan.
    expect(holders('order', 'manage')).toEqual([]);
    expect(holders('triage', 'write')).toEqual([
      'bidan',
      'dokter',
      'dokter_residen',
      'perawat',
      'petugas_pendaftaran',
    ]);
  });

  it('hak ubah klinis selalu disertai hak baca dengan lingkup tidak lebih sempit', () => {
    for (const [role, grants] of Object.entries(DEFAULT_ROLE_GRANTS)) {
      for (const [r, a, scope] of grants) {
        if (!(CLINICAL_RESOURCES as readonly string[]).includes(r) || a === 'read') continue;
        // eMAR dan triase dibaca lewat catatan klinis pasien.
        const readResource = r === 'medication' || r === 'triage' ? 'clinical' : r;
        const read = grantOf(grants, readResource, 'read');
        expect(read, `${role}: ${r}.${a} tanpa ${readResource}.read`).not.toBeNull();
        if (read) {
          expect(
            SCOPE_RANK[read],
            `${role}: ${readResource}.read lebih sempit dari ${r}.${a}`,
          ).toBeGreaterThanOrEqual(SCOPE_RANK[scope]);
        }
      }
    }
  });
});
