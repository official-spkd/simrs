import type { SystemRoleCode } from '@simrs/shared';

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
 *
 * `allAccess` (ADR-0023 keputusan 10, permintaan pemilik produk 6 Okt 2026): posisi "Superadmin demo" yang di mode
 * presentasi melihat semua layar tanpa ganti posisi. Tanda ini hanya ditulis ke berkas kredensial lokal dan dibaca
 * web di mode presentasi; di database akun ini akun biasa dengan satu penugasan peran bawaan yang hanya-baca
 * (`manajemen`, tanpa akses data pasien), tanpa peran atau izin baru di API. Diletakkan paling akhir agar pencarian
 * persona per peran (`find((p) => p.role === …)`) tetap menemukan persona posisi itu sendiri.
 */
export const PRESENTATION_PERSONAS: ReadonlyArray<{
  slug: string;
  role: string;
  unitCode: string | null;
  displayName: string;
  allAccess?: true;
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
  {
    slug: 'superadmin-demo',
    role: 'manajemen',
    unitCode: null,
    displayName: 'Superadmin demo (presentasi)',
    allAccess: true,
  },
];

/** Label posisi Superadmin demo di layar masuk dan berkas kredensial (`roleName`). */
export const PRESENTATION_ALL_ACCESS_LABEL = 'Superadmin demo · semua layar';

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

/** Kode unit seed (`SEED_UNITS`). */
export type SeedUnitCode = (typeof SEED_UNITS)[number]['code'];

/** Satu staf fiktif seed (`seedStaff`). */
export interface SeedStaffMember {
  /**
   * NIP fiktif 18 digit, sekaligus nama pengguna untuk masuk. Struktur NIP PNS (tanggal lahir, TMT pengangkatan
   * YYYYMM, jenis kelamin 1 = laki-laki / 2 = perempuan, nomor urut 3 digit), tetapi tahun lahir diganti `9999`
   * (jelas fiktif, tidak ada orang lahir tahun 9999). Nomor urut unik dan menurunkan no. HP fiktif staf.
   */
  nip: string;
  /** Nama + gelar, seperti yang tampil di layar. */
  displayName: string;
  /** Posisi: [kode peran sistem, kode unit seed | null = semua unit]. */
  positions: ReadonlyArray<readonly [role: SystemRoleCode, unitCode: SeedUnitCode | null]>;
}

/**
 * Staf fiktif per RS seed (fase 1 potongan 10d, docs/09: "±30 staf lintas peran"): 33 orang yang mencakup
 * 16 peran bawaan dan unit seed. Daftar yang sama dipakai di setiap RS seed (NIP hanya unik per RS).
 *
 * Akun dibuat TANPA kata sandi dan tanpa MFA, jadi tidak ada yang bisa masuk sebagai staf seed sampai admin SIM RS
 * memberi sandi sementara lewat "Reset kata sandi" di layar Akses (lalu login pertama: daftar MFA + ganti sandi).
 * Nama dibuat-buat, tidak merujuk staf RS mana pun; dokter, perawat, bidan, apoteker, dan analis yang juga tampil di
 * layar mode presentasi (`apps/web/src/lib/demo/fixtures/staf.ts`) memakai nama yang sama agar layar Akses dan
 * layar demo konsisten. Nama persona akun presentasi (`PRESENTATION_PERSONAS`) tidak dipakai di sini.
 */
export const SEED_STAFF: readonly SeedStaffMember[] = [
  // Dokter (DPJP) per poli, rawat inap, kamar operasi, IGD, dan penunjang.
  {
    nip: '999905172008031001',
    displayName: 'dr. Rahmat Hidayat, Sp.PD',
    positions: [
      ['dokter', 'POLI-DALAM'],
      ['dokter', 'MELATI'],
    ],
  },
  {
    nip: '999911022010012002',
    displayName: 'dr. Sinta Maharani, Sp.PD-KGH',
    positions: [['dokter', 'POLI-DALAM']],
  },
  {
    nip: '999908242012032003',
    displayName: 'dr. Nadia Rahmawati, Sp.A',
    positions: [['dokter', 'POLI-ANAK']],
  },
  {
    nip: '999903092006041004',
    displayName: 'dr. Yohanes Kurnia, Sp.B',
    positions: [
      ['dokter', 'POLI-BEDAH'],
      ['dokter', 'OK'],
    ],
  },
  { nip: '999907212011021005', displayName: 'dr. Ferry Setiawan, Sp.An', positions: [['dokter', 'OK']] },
  { nip: '999901152009022006', displayName: 'dr. Hana Wijayanti, Sp.OG', positions: [['dokter', 'MAWAR']] },
  { nip: '999912062013052007', displayName: 'dr. Maya Lestari, Sp.PK', positions: [['dokter', 'LAB']] },
  { nip: '999904302007021008', displayName: 'dr. Arman Siregar, Sp.Rad', positions: [['dokter', 'RAD']] },
  { nip: '999909112019031009', displayName: 'dr. Damar Wicaksono', positions: [['dokter', 'IGD']] },
  // Dokter residen (PPDS, wajib co-sign).
  { nip: '999902282022011010', displayName: 'dr. Reza Firmansyah', positions: [['dokter_residen', 'IGD']] },
  {
    nip: '999906132022012011',
    displayName: 'dr. Laila Fitriani',
    positions: [['dokter_residen', 'POLI-DALAM']],
  },
  // Perawat per bangsal, IGD, kamar operasi, poli.
  { nip: '999910192015021012', displayName: 'Ns. Yudi Pratama, S.Kep', positions: [['perawat', 'IGD']] },
  { nip: '999911052023032033', displayName: 'Indri Astuti, A.Md.Kep', positions: [['perawat', 'IGD']] },
  { nip: '999905052014042013', displayName: 'Ns. Rosa Elvira, S.Kep', positions: [['perawat', 'MELATI']] },
  { nip: '999908272018021014', displayName: 'Ns. Fikri Ananda, S.Kep', positions: [['perawat', 'MELATI']] },
  { nip: '999901022016041015', displayName: 'Ns. Galih Saputra, S.Kep', positions: [['perawat', 'OK']] },
  { nip: '999903182012032016', displayName: 'Ns. Retno Wulandari, S.Kep', positions: [['perawat', 'MAWAR']] },
  {
    nip: '999909222020032017',
    displayName: 'Novita Sembiring, A.Md.Kep',
    positions: [['perawat', 'POLI-ANAK']],
  },
  // Bidan.
  {
    nip: '999907112017032018',
    displayName: 'Bd. Wina Kartikasari, S.Tr.Keb',
    positions: [['bidan', 'MAWAR']],
  },
  { nip: '999912252021042019', displayName: 'Sekar Ayuningtyas, A.Md.Keb', positions: [['bidan', 'MAWAR']] },
  // Penunjang: farmasi, laboratorium, radiologi.
  {
    nip: '999902042011021020',
    displayName: 'apt. Rudi Hermawan, S.Farm.',
    positions: [['apoteker', 'FARMASI']],
  },
  { nip: '999906162019042021', displayName: 'Sari Rahmawati, A.Md.AK', positions: [['analis_lab', 'LAB']] },
  {
    nip: '999911082021021022',
    displayName: 'Stefanus Hutapea, S.Tr.Kes',
    positions: [['analis_lab', 'LAB']],
  },
  {
    nip: '999904202018031023',
    displayName: 'Krisna Mahendra, A.Md.Rad',
    positions: [['radiografer', 'RAD']],
  },
  // Administrasi pelayanan dan keuangan.
  { nip: '999908142023052024', displayName: 'Siti Khodijah', positions: [['petugas_pendaftaran', null]] },
  { nip: '999901292022022025', displayName: 'Meiliana Gunawan', positions: [['kasir', 'KASIR']] },
  {
    nip: '999910132019052026',
    displayName: 'Aisyah Nurfadilah, A.Md.RMIK',
    positions: [['koder', 'REKAM-MEDIS']],
  },
  {
    // Kepala unit rekam medis: juga mengoding (dua posisi, dipilih saat masuk).
    nip: '999905262010021027',
    displayName: 'Wisnu Hardiansyah, S.Tr.RMIK',
    positions: [
      ['petugas_rm', 'REKAM-MEDIS'],
      ['koder', 'REKAM-MEDIS'],
    ],
  },
  {
    nip: '999903072015022028',
    displayName: 'Kristina Simanjuntak, S.E., Ak.',
    positions: [['akuntan', null]],
  },
  // Manajemen, komite mutu, privasi, admin SIM RS.
  { nip: '999912012003031029', displayName: 'dr. Gede Arya Wiguna, MARS', positions: [['manajemen', null]] },
  {
    nip: '999909182009042030',
    displayName: 'Ns. Larasati Wardhani, M.Kep',
    positions: [['auditor_mutu', null]],
  },
  {
    nip: '999906102016031031',
    displayName: 'Haris Munandar, S.H., M.H.',
    positions: [['petugas_privasi', null]],
  },
  {
    nip: '999902232019051032',
    displayName: 'Andreas Tumbelaka, S.Kom.',
    positions: [['admin_tenant', null]],
  },
];

/** Awal semua penugasan staf seed (mulai pemakaian SIM RS fiktif), WIB. */
export const SEED_STAFF_VALID_FROM = '2026-01-01T00:00:00+07:00';

/** No. HP fiktif staf seed (bentuk baku `62…`): 0813-0000-1 + nomor urut NIP, mis. 0813-0000-1001. */
export function seedStaffPhone(member: Pick<SeedStaffMember, 'nip'>): string {
  return `6281300001${member.nip.slice(-3)}`;
}

/** Struktur RS fiktif yang sama untuk setiap tenant seed (kode unik per tenant). */
export const SEED_UNITS = [
  { code: 'IGD', name: 'Instalasi Gawat Darurat', kind: 'igd' },
  { code: 'POLI-DALAM', name: 'Poli Penyakit Dalam', kind: 'poli' },
  { code: 'POLI-ANAK', name: 'Poli Anak', kind: 'poli' },
  { code: 'POLI-BEDAH', name: 'Poli Bedah', kind: 'poli' },
  // Fase 2: poli rawat jalan yang tampil di jadwal dan papan antrean (kode layanan JT/SR/PR).
  { code: 'POLI-JANTUNG', name: 'Poli Jantung', kind: 'poli' },
  { code: 'POLI-SARAF', name: 'Poli Saraf', kind: 'poli' },
  { code: 'POLI-PARU', name: 'Poli Paru', kind: 'poli' },
  { code: 'MELATI', name: 'Bangsal Melati', kind: 'rawat_inap' },
  { code: 'MAWAR', name: 'Bangsal Mawar', kind: 'rawat_inap' },
  // Fase 3 · 3.0c: bangsal Anggrek (kelas 1) dan ruang isolasi (rencana fase 3 §3.0c).
  { code: 'ANGGREK', name: 'Bangsal Anggrek', kind: 'rawat_inap' },
  { code: 'ISOLASI', name: 'Ruang Isolasi', kind: 'rawat_inap' },
  { code: 'LAB', name: 'Laboratorium Patologi Klinik', kind: 'penunjang' },
  { code: 'RAD', name: 'Radiologi', kind: 'penunjang' },
  { code: 'FARMASI', name: 'Instalasi Farmasi', kind: 'farmasi' },
  { code: 'OK', name: 'Kamar Operasi', kind: 'kamar_operasi' },
  { code: 'REKAM-MEDIS', name: 'Unit Rekam Medis', kind: 'administrasi' },
  { code: 'KASIR', name: 'Kasir', kind: 'administrasi' },
] as const;

/**
 * Kamar dan bed: [kode unit, kode kamar, nama, kelas, jumlah bed]. Kelas null = bed tanpa kelas rawat (IGD).
 * Fase 3 (3.0c): Melati 12 bed kelas 2 (MLT-201..206), Anggrek 8 bed kelas 1, Isolasi 4 bed, IGD zona R/B/K.
 */
export const SEED_ROOMS: ReadonlyArray<readonly [string, string, string, string | null, number]> = [
  ['MELATI', 'MLT-101', 'Melati 101 (VIP)', 'vip', 1],
  ['MELATI', 'MLT-201', 'Melati 201', 'kelas_2', 2],
  ['MELATI', 'MLT-202', 'Melati 202', 'kelas_2', 2],
  ['MELATI', 'MLT-203', 'Melati 203', 'kelas_2', 2],
  ['MELATI', 'MLT-204', 'Melati 204', 'kelas_2', 2],
  ['MELATI', 'MLT-205', 'Melati 205', 'kelas_2', 2],
  ['MELATI', 'MLT-206', 'Melati 206', 'kelas_2', 2],
  ['MELATI', 'MLT-301', 'Melati 301', 'kelas_3', 4],
  ['MAWAR', 'MWR-101', 'Mawar 101', 'kelas_1', 2],
  ['MAWAR', 'MWR-ISO', 'Mawar Isolasi', 'isolasi', 1],
  ['ANGGREK', 'AGR-101', 'Anggrek 101', 'kelas_1', 2],
  ['ANGGREK', 'AGR-102', 'Anggrek 102', 'kelas_1', 2],
  ['ANGGREK', 'AGR-103', 'Anggrek 103', 'kelas_1', 2],
  ['ANGGREK', 'AGR-104', 'Anggrek 104', 'kelas_1', 2],
  ['ISOLASI', 'ISO-101', 'Isolasi 101', 'isolasi', 1],
  ['ISOLASI', 'ISO-102', 'Isolasi 102', 'isolasi', 1],
  ['ISOLASI', 'ISO-103', 'Isolasi 103', 'isolasi', 1],
  ['ISOLASI', 'ISO-104', 'Isolasi 104', 'isolasi', 1],
  ['IGD', 'IGD-R', 'IGD zona resusitasi', null, 2],
  ['IGD', 'IGD-B', 'IGD zona akut', null, 8],
  ['IGD', 'IGD-K', 'IGD zona fast track', null, 4],
];
