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
 * Akun presentasi (mode presentasi ADR-0023, permintaan pengguna 4 Okt 2026): satu akun per posisi dengan nama
 * fiktif, dipilih sekali klik di layar masuk saat `pnpm dev:demo`. Dibuat lewat `pnpm db:akun-presentasi` (hanya
 * APP_ENV=local); kredensialnya hanya di `.local/demo-accounts.json`. Nama tidak merujuk staf RS mana pun.
 */
export const PRESENTATION_PERSONAS: ReadonlyArray<{
  slug: string;
  role: string;
  unitCode: string | null;
  displayName: string;
}> = [
  { slug: 'pendaftaran', role: 'petugas_pendaftaran', unitCode: null, displayName: 'Bambang Kurniawan' },
  { slug: 'perawat', role: 'perawat', unitCode: 'MELATI', displayName: 'Ns. Maya Sari, S.Kep' },
  { slug: 'bidan', role: 'bidan', unitCode: 'MAWAR', displayName: 'Bd. Ratih Puspitasari, S.Tr.Keb' },
  { slug: 'dokter', role: 'dokter', unitCode: 'POLI-DALAM', displayName: 'dr. Andini Prameswari, Sp.PD' },
  { slug: 'dokter-residen', role: 'dokter_residen', unitCode: 'IGD', displayName: 'dr. Rina Kusuma' },
  { slug: 'apoteker', role: 'apoteker', unitCode: 'FARMASI', displayName: 'apt. Dewi Anggraini, S.Farm.' },
  { slug: 'analis-lab', role: 'analis_lab', unitCode: 'LAB', displayName: 'Fitri Handayani, A.Md.AK' },
  { slug: 'radiografer', role: 'radiografer', unitCode: 'RAD', displayName: 'Bayu Saputra, A.Md.Rad' },
  { slug: 'kasir', role: 'kasir', unitCode: 'KASIR', displayName: 'Hendra Wijaya' },
  { slug: 'koder', role: 'koder', unitCode: 'REKAM-MEDIS', displayName: 'Arif Nugroho, A.Md.RMIK' },
  { slug: 'akuntan', role: 'akuntan', unitCode: null, displayName: 'Yulia Permatasari, S.E., Ak.' },
  {
    slug: 'rekam-medis',
    role: 'petugas_rm',
    unitCode: 'REKAM-MEDIS',
    displayName: 'Dian Lestari, A.Md.RMIK',
  },
  { slug: 'direksi', role: 'manajemen', unitCode: null, displayName: 'dr. Satria Wibisana, MARS' },
  { slug: 'mutu', role: 'auditor_mutu', unitCode: null, displayName: 'Ns. Lina Marlina, M.Kep' },
  { slug: 'privasi', role: 'petugas_privasi', unitCode: null, displayName: 'Teguh Prasetyo, S.H.' },
  { slug: 'admin', role: 'admin_tenant', unitCode: null, displayName: 'Admin SIM RS (presentasi)' },
];

/** Awalan nama pengguna akun presentasi (web memakainya untuk berbagi keadaan simulasi antar-persona). */
export const PRESENTATION_USERNAME_PREFIX = 'presentasi.';

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
