/**
 * P03 · Katalog izin (tetap, di kode) dan matriks bawaan peran (disalin ke database per RS, bisa diubah di layar Akses).
 * Izin = sumber × aksi, dengan lingkup:
 * - `all`          seluruh data tenant,
 * - `unit`         hanya data unit tempat penugasan aktif,
 * - `relationship` hanya pasien yang punya relasi dengan pelaku (DPJP, perawat penanggung jawab, rawat bersama)
 *                  atau akses darurat (break-the-glass) yang masih berlaku.
 */
export const PERMISSION_CATALOG = {
  'tenant.settings': { label: 'Pengaturan & modul RS', actions: ['read', 'write'] },
  facility: { label: 'Struktur RS (faskes, unit, bed)', actions: ['read', 'write'] },
  'iam.users': { label: 'Pengguna & penugasan', actions: ['read', 'write'] },
  'iam.roles': { label: 'Peran & matriks izin', actions: ['read', 'write'] },
  audit: { label: 'Jejak audit', actions: ['read', 'export', 'review'] },
  patient: { label: 'Data pasien (MPI)', actions: ['read', 'write', 'merge', 'export'] },
  'patient.identity': { label: 'Identitas lengkap (NIK tanpa samaran)', actions: ['read'] },
  'forms.definition': { label: 'Definisi formulir klinis', actions: ['read', 'write', 'publish'] },
  'forms.response': { label: 'Isian formulir klinis', actions: ['read', 'write', 'correct'] },
  ref: { label: 'Master rujukan (ICD, LOINC, wilayah)', actions: ['read', 'write'] },
  documents: { label: 'Dokumen & cetak', actions: ['read', 'write', 'print'] },
  break_glass: { label: 'Akses darurat', actions: ['use', 'review'] },
  'dev.tools': { label: 'Alat pengembang (non-produksi)', actions: ['use'] },
  'platform.guide': { label: 'Panduan sistem (operator platform)', actions: ['read'] },
} as const;

export type PermissionResource = keyof typeof PERMISSION_CATALOG;
export type PermissionAction<R extends PermissionResource = PermissionResource> =
  (typeof PERMISSION_CATALOG)[R]['actions'][number];
export const PERMISSION_SCOPES = ['all', 'unit', 'relationship'] as const;
export type PermissionScope = (typeof PERMISSION_SCOPES)[number];

/** Urutan cakupan: all ⊃ unit ⊃ relationship. */
export const SCOPE_RANK: Record<PermissionScope, number> = { relationship: 1, unit: 2, all: 3 };

export function isPermission(resource: string, action: string): resource is PermissionResource {
  return (
    Object.hasOwn(PERMISSION_CATALOG, resource) &&
    (PERMISSION_CATALOG[resource as PermissionResource].actions as readonly string[]).includes(action)
  );
}

/** Kunci satu izin: `sumber.aksi` (mis. `iam.users.write`). Aksi tidak pernah bertitik. */
export const permissionKey = (resource: string, action: string): string => `${resource}.${action}`;

/** Semua kunci izin di katalog saat ini, urut. */
export function catalogPermissionKeys(): string[] {
  return Object.entries(PERMISSION_CATALOG)
    .flatMap(([resource, def]) => def.actions.map((action) => permissionKey(resource, action)))
    .sort();
}

/**
 * Katalog saat sinkron izin (`pnpm db:sync-permissions`) diperkenalkan, 5 Okt 2026. RS yang belum punya
 * catatan katalog (`PERMISSION_CATALOG_RECORD_KEY`) dianggap sudah mengenal semua izin ini, sehingga hanya
 * izin yang ditambahkan ke katalog SESUDAHNYA yang dianggap baru. Jangan diubah: menambah izin cukup di
 * `PERMISSION_CATALOG` + matriks bawaan, lalu jalankan sinkron di setiap lingkungan.
 */
export const PERMISSION_CATALOG_BASELINE: readonly string[] = [
  'audit.export',
  'audit.read',
  'audit.review',
  'break_glass.review',
  'break_glass.use',
  'dev.tools.use',
  'documents.print',
  'documents.read',
  'documents.write',
  'facility.read',
  'facility.write',
  'forms.definition.publish',
  'forms.definition.read',
  'forms.definition.write',
  'forms.response.correct',
  'forms.response.read',
  'forms.response.write',
  'iam.roles.read',
  'iam.roles.write',
  'iam.users.read',
  'iam.users.write',
  'patient.export',
  'patient.identity.read',
  'patient.merge',
  'patient.read',
  'patient.write',
  'platform.guide.read',
  'ref.read',
  'ref.write',
  'tenant.settings.read',
  'tenant.settings.write',
];

/**
 * Kunci `tenant_settings` (internal, bukan pengaturan di `TENANT_SETTINGS`, jadi tidak tampil dan tidak bisa
 * diubah lewat API pengaturan) berisi izin katalog yang sudah dikenal RS: `{ v: 1, permissions: string[] }`.
 * Ditulis hanya oleh sinkron izin; setiap perubahannya diaudit.
 */
export const PERMISSION_CATALOG_RECORD_KEY = 'authz.permission_catalog';

/** Entri selisih matriks di audit (`details.added` / `details.removed`): `sumber.aksi:lingkup`. */
export const grantDiffEntry = (g: { resource: string; action: string; scope: string }): string =>
  `${permissionKey(g.resource, g.action)}:${g.scope}`;

/** Kebalikan `grantDiffEntry`: kunci izin + lingkup, atau null bila formatnya bukan entri selisih. */
export function parseGrantDiffEntry(entry: string): { permission: string; scope: string } | null {
  const at = entry.lastIndexOf(':');
  if (at <= 0 || at === entry.length - 1) return null;
  const permission = entry.slice(0, at);
  return permission.includes('.') ? { permission, scope: entry.slice(at + 1) } : null;
}

/** Peran bawaan (docs/05 §2). `superadmin_platform` hanya ada di tenant khusus PLATFORM (ADR-0010). */
export const SYSTEM_ROLES = {
  admin_tenant: 'Admin SIM RS',
  petugas_pendaftaran: 'Petugas pendaftaran',
  perawat: 'Perawat',
  bidan: 'Bidan',
  dokter: 'Dokter (DPJP)',
  dokter_residen: 'Dokter residen (wajib co-sign)',
  apoteker: 'Apoteker',
  analis_lab: 'Analis laboratorium',
  radiografer: 'Radiografer',
  kasir: 'Kasir',
  koder: 'Koder klinis',
  akuntan: 'Akuntan',
  petugas_rm: 'Petugas rekam medis',
  manajemen: 'Manajemen',
  auditor_mutu: 'Auditor mutu',
  petugas_privasi: 'Petugas privasi',
} as const;
export type SystemRoleCode = keyof typeof SYSTEM_ROLES;

export type RoleGrant = readonly [PermissionResource, string, PermissionScope];
type Grant = RoleGrant;

const CLINICAL_READ: Grant[] = [
  ['patient', 'read', 'relationship'],
  ['forms.definition', 'read', 'all'],
  ['forms.response', 'read', 'relationship'],
  ['ref', 'read', 'all'],
  ['facility', 'read', 'all'],
  ['documents', 'read', 'relationship'],
  ['break_glass', 'use', 'all'],
];

/**
 * Matriks bawaan. Prinsip hak minimum: klinisi hanya pasien berelasi (+ akses darurat berjejak);
 * administrasi tanpa isi klinis; audit/privasi tanpa hak ubah data pasien.
 */
export const DEFAULT_ROLE_GRANTS: Record<SystemRoleCode, readonly Grant[]> = {
  admin_tenant: [
    ['tenant.settings', 'read', 'all'],
    ['tenant.settings', 'write', 'all'],
    ['facility', 'read', 'all'],
    ['facility', 'write', 'all'],
    ['iam.users', 'read', 'all'],
    ['iam.users', 'write', 'all'],
    ['iam.roles', 'read', 'all'],
    ['iam.roles', 'write', 'all'],
    ['audit', 'read', 'all'],
    ['forms.definition', 'read', 'all'],
    ['ref', 'read', 'all'],
    ['ref', 'write', 'all'],
    ['dev.tools', 'use', 'all'],
  ],
  petugas_pendaftaran: [
    ['patient', 'read', 'all'],
    ['patient', 'write', 'all'],
    ['patient.identity', 'read', 'all'],
    ['facility', 'read', 'all'],
    ['ref', 'read', 'all'],
    ['documents', 'print', 'all'],
  ],
  perawat: [
    ...CLINICAL_READ,
    ['forms.response', 'write', 'relationship'],
    ['forms.response', 'correct', 'relationship'],
  ],
  bidan: [
    ...CLINICAL_READ,
    ['forms.response', 'write', 'relationship'],
    ['forms.response', 'correct', 'relationship'],
  ],
  dokter: [
    ...CLINICAL_READ,
    ['forms.response', 'write', 'relationship'],
    ['forms.response', 'correct', 'relationship'],
    ['documents', 'write', 'relationship'],
  ],
  dokter_residen: [...CLINICAL_READ, ['forms.response', 'write', 'relationship']],
  apoteker: [...CLINICAL_READ],
  analis_lab: [
    ['patient', 'read', 'unit'],
    ['ref', 'read', 'all'],
    ['facility', 'read', 'all'],
  ],
  radiografer: [
    ['patient', 'read', 'unit'],
    ['ref', 'read', 'all'],
    ['facility', 'read', 'all'],
  ],
  kasir: [
    ['patient', 'read', 'all'],
    ['facility', 'read', 'all'],
    ['documents', 'print', 'all'],
  ],
  koder: [
    ['patient', 'read', 'all'],
    ['forms.response', 'read', 'all'],
    ['ref', 'read', 'all'],
    ['documents', 'read', 'all'],
  ],
  akuntan: [['facility', 'read', 'all']],
  petugas_rm: [
    ['patient', 'read', 'all'],
    ['patient', 'write', 'all'],
    ['patient', 'merge', 'all'],
    ['patient', 'export', 'all'],
    ['patient.identity', 'read', 'all'],
    ['forms.definition', 'read', 'all'],
    ['forms.definition', 'write', 'all'],
    ['forms.definition', 'publish', 'all'],
    ['forms.response', 'read', 'all'],
    ['documents', 'read', 'all'],
    ['documents', 'print', 'all'],
    ['ref', 'read', 'all'],
    ['facility', 'read', 'all'],
  ],
  manajemen: [
    ['facility', 'read', 'all'],
    ['audit', 'read', 'all'],
    ['tenant.settings', 'read', 'all'],
  ],
  auditor_mutu: [
    ['audit', 'read', 'all'],
    ['audit', 'export', 'all'],
    ['facility', 'read', 'all'],
  ],
  petugas_privasi: [
    ['audit', 'read', 'all'],
    ['audit', 'export', 'all'],
    ['audit', 'review', 'all'],
    ['break_glass', 'review', 'all'],
    ['iam.users', 'read', 'all'],
  ],
};

/** Jenis tenant: RS, atau satu tenant khusus untuk operator platform (ADR-0010, ADR-0013). */
export const TENANT_KINDS = ['hospital', 'platform'] as const;
export type TenantKind = (typeof TENANT_KINDS)[number];

/** Peran tenant PLATFORM. Tidak punya akses data pasien RS mana pun (ADR-0010). */
export const PLATFORM_ROLES = { superadmin_platform: 'Superadmin platform' } as const;
export type PlatformRoleCode = keyof typeof PLATFORM_ROLES;

export const PLATFORM_ROLE_GRANTS: Record<PlatformRoleCode, readonly Grant[]> = {
  superadmin_platform: [
    ['platform.guide', 'read', 'all'],
    ['iam.users', 'read', 'all'],
    ['iam.users', 'write', 'all'],
    ['iam.roles', 'read', 'all'],
    ['iam.roles', 'write', 'all'],
    ['audit', 'read', 'all'],
  ],
};

/** Peran bawaan beserta matriks bawaannya untuk satu jenis tenant. */
export function defaultRolesFor(
  kind: TenantKind,
): Array<{ code: string; name: string; grants: readonly Grant[] }> {
  if (kind === 'platform') {
    return (Object.keys(PLATFORM_ROLES) as PlatformRoleCode[]).map((code) => ({
      code,
      name: PLATFORM_ROLES[code],
      grants: PLATFORM_ROLE_GRANTS[code],
    }));
  }
  return (Object.keys(SYSTEM_ROLES) as SystemRoleCode[]).map((code) => ({
    code,
    name: SYSTEM_ROLES[code],
    grants: DEFAULT_ROLE_GRANTS[code],
  }));
}

/**
 * Peran pelindung (admin RS di tenant RS, superadmin di tenant PLATFORM): selalu tersisa minimal satu
 * penugasan aktif, sehingga tenant tidak pernah terkunci dari pengaturan aksesnya sendiri.
 */
export const PROTECTED_ROLES = ['admin_tenant', 'superadmin_platform'] as const;

/**
 * Peran sensitif (docs/05 §1: admin, keuangan, rekam medis; ditambah koding, audit, privasi, manajemen, operator
 * platform). Bawaan pengaturan `login.totp_only_roles` (tanpa kode cadangan WhatsApp/email, ADR-0022) dan tidak
 * pernah boleh memakai PIN masuk cepat (ADR-0024).
 */
export const SENSITIVE_ROLES = [
  'admin_tenant',
  'kasir',
  'koder',
  'akuntan',
  'petugas_rm',
  'manajemen',
  'auditor_mutu',
  'petugas_privasi',
  'superadmin_platform',
] as const;

export function isProtectedRole(code: string | null | undefined): boolean {
  return (PROTECTED_ROLES as readonly (string | null | undefined)[]).includes(code);
}

/** Sumber `platform.*` hanya bermakna di tenant PLATFORM; tidak boleh diberikan ke peran RS. */
export function permissionAllowedFor(kind: TenantKind, resource: string): boolean {
  return kind === 'platform' || !resource.startsWith('platform.');
}

/**
 * Izin kelola akses. Peran yang memegang salah satunya setara admin: selalu dimiliki peran pelindung, dan
 * akun/peran yang memegangnya hanya boleh dikelola oleh peran pelindung (cegah eskalasi lewat delegasi).
 */
export const ACCESS_ADMIN_GRANTS = [
  ['iam.users', 'write'],
  ['iam.roles', 'write'],
] as const satisfies ReadonlyArray<readonly [PermissionResource, string]>;
