/** Tenant RS fiktif untuk lokal dan tes. Kode Kemenkes berawalan 9999 = jelas fiktif. */
export const SEED_TENANTS = [
  {
    id: '0199a000-0000-7000-8000-000000000001',
    code: 'RSFA',
    name: 'RS Fiktif Andalas',
    kemenkesCode: '9999001',
    bpjsPpkCode: '0301R001',
    satusehatOrgId: 'mock-org-001',
    hospitalClass: 'B',
  },
  {
    id: '0199a000-0000-7000-8000-000000000002',
    code: 'RSFB',
    name: 'RS Fiktif Bahari',
    kemenkesCode: '9999002',
    bpjsPpkCode: '0301R002',
    satusehatOrgId: 'mock-org-002',
    hospitalClass: 'C',
  },
] as const;

/**
 * RS yang dipakai dan didemokan di lingkungan pengembangan (keputusan pengguna 4 Okt 2026: fokus RSCM). Identitas
 * RS asli, tetapi kode resmi (Kemenkes, BPJS, SATUSEHAT) dan SEMUA data pasien/staf tetap fiktif. Hanya di-seed ke
 * DB pengembangan; tes otomatis tetap memakai RSFA/RSFB.
 */
export const SEED_LOCAL_TENANTS = [
  {
    id: '0199a000-0000-7000-8000-000000000003',
    code: 'RSCM',
    name: 'RSUPN Dr. Cipto Mangunkusumo',
    kemenkesCode: '9999003',
    bpjsPpkCode: '0301R003',
    satusehatOrgId: 'mock-org-003',
    hospitalClass: 'A',
  },
] as const;

/**
 * Posisi akun demo lokal (`pnpm db:create-demo`): semua 16 peran bawaan, dengan unit kerja seed yang paling
 * sesuai (null = semua unit). Akun demo hanya untuk mencoba layar per posisi; tidak pernah ada di produksi.
 */
export const DEMO_POSITIONS: ReadonlyArray<readonly [role: string, unitCode: string | null]> = [
  ['dokter', 'POLI-DALAM'],
  ['dokter_residen', 'IGD'],
  ['perawat', 'MELATI'],
  ['bidan', 'MAWAR'],
  ['apoteker', 'FARMASI'],
  ['analis_lab', 'LAB'],
  ['radiografer', 'RAD'],
  ['petugas_pendaftaran', null],
  ['kasir', 'KASIR'],
  ['koder', 'REKAM-MEDIS'],
  ['akuntan', null],
  ['petugas_rm', 'REKAM-MEDIS'],
  ['manajemen', null],
  ['auditor_mutu', null],
  ['petugas_privasi', null],
  ['admin_tenant', null],
];

/**
 * Tenant khusus operator platform (superadmin_platform, ADR-0013). Bukan RS: tanpa struktur, tanpa pasien.
 * Akun superadmin dibuat lewat `pnpm db:create-admin --tenant PLATFORM …`, tidak pernah di-seed.
 */
export const SEED_PLATFORM_TENANT = {
  id: '0199a000-0000-7000-8000-0000000000ff',
  code: 'PLATFORM',
  name: 'Platform SIM RS',
  kind: 'platform',
} as const;

/** Struktur RS fiktif yang sama untuk setiap tenant seed (kode unik per tenant). */
export const SEED_UNITS = [
  { code: 'IGD', name: 'Instalasi Gawat Darurat', kind: 'igd' },
  { code: 'POLI-DALAM', name: 'Poli Penyakit Dalam', kind: 'poli' },
  { code: 'POLI-ANAK', name: 'Poli Anak', kind: 'poli' },
  { code: 'POLI-BEDAH', name: 'Poli Bedah', kind: 'poli' },
  { code: 'MELATI', name: 'Bangsal Melati', kind: 'rawat_inap' },
  { code: 'MAWAR', name: 'Bangsal Mawar', kind: 'rawat_inap' },
  { code: 'LAB', name: 'Laboratorium Patologi Klinik', kind: 'penunjang' },
  { code: 'RAD', name: 'Radiologi', kind: 'penunjang' },
  { code: 'FARMASI', name: 'Instalasi Farmasi', kind: 'farmasi' },
  { code: 'OK', name: 'Kamar Operasi', kind: 'kamar_operasi' },
  { code: 'REKAM-MEDIS', name: 'Unit Rekam Medis', kind: 'administrasi' },
  { code: 'KASIR', name: 'Kasir', kind: 'administrasi' },
] as const;

/** Kamar dan bed: [kode unit, kode kamar, nama, kelas, jumlah bed]. */
export const SEED_ROOMS = [
  ['MELATI', 'MLT-101', 'Melati 101 (VIP)', 'vip', 1],
  ['MELATI', 'MLT-201', 'Melati 201', 'kelas_2', 2],
  ['MELATI', 'MLT-301', 'Melati 301', 'kelas_3', 4],
  ['MAWAR', 'MWR-101', 'Mawar 101', 'kelas_1', 2],
  ['MAWAR', 'MWR-ISO', 'Mawar Isolasi', 'isolasi', 1],
] as const;
