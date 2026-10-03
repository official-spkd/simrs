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

type Grant = readonly [PermissionResource, string, PermissionScope];

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

/** Kode peran yang wajib selalu ada minimal satu penugasan aktif (mencegah RS terkunci dari pengaturannya). */
export const PROTECTED_ROLE = 'admin_tenant' satisfies SystemRoleCode;

/**
 * Izin kelola akses. Peran yang memegang salah satunya setara admin: selalu dimiliki PROTECTED_ROLE, dan
 * akun/peran yang memegangnya hanya boleh dikelola oleh PROTECTED_ROLE (cegah eskalasi lewat delegasi).
 */
export const ACCESS_ADMIN_GRANTS = [
  ['iam.users', 'write'],
  ['iam.roles', 'write'],
] as const satisfies ReadonlyArray<readonly [PermissionResource, string]>;
