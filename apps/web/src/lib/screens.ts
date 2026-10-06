import type { PermissionKey, SystemRoleCode } from '@simrs/shared';

/**
 * Izin front office fase 2 yang dipakai gerbang layar hibrida demo/api (`requireScreen`, menu): kunci katalog bersama
 * `PERMISSION_CATALOG` (potongan 0a), sehingga salah ketik tertangkap typecheck. `kiosk.use` dan `queue.display.read`
 * adalah izin khusus perangkat (ADR-0027, `DEVICE_ONLY_RESOURCES`): tidak bisa diberikan ke peran, jadi sampai
 * prinsipal perangkat ada layar itu hanya terbuka di mode presentasi.
 */
export const FRONT_OFFICE_PERMISSIONS = [
  'schedule.read',
  'booking.read',
  'queue.read',
  'encounter.write',
  'kiosk.use',
  'queue.display.read',
] as const satisfies readonly PermissionKey[];

/**
 * Izin layar hibrida klinis fase 3 (rencana fase 3 potongan 3.0d), dipilih agar cocok dengan posisi pemakai layar
 * (`demoRoles`) menurut matriks bawaan potongan 3.0a: Pemeriksaan poli, Rawat inap, dan Resume `clinical.write` (TTE
 * resume tetap `clinical.sign` di API), IGD `clinical.read` (petugas pendaftaran membuka papan; triase `triage.write`
 * dan aksi klinis lain diperiksa API), CPOE `order.write`, Tempat tidur `bed.read` (manajemen hanya membaca),
 * Persetujuan tindakan `consent.write` (perawat/bidan dan dokter; TTE tetap `consent.sign`). Kunci katalog bersama
 * (potongan 3.0a), sehingga salah ketik tertangkap typecheck.
 */
export const CLINICAL_PERMISSIONS = [
  'clinical.read',
  'clinical.write',
  'order.write',
  'bed.read',
  'consent.write',
] as const satisfies readonly PermissionKey[];
export type ScreenPermission =
  (typeof FRONT_OFFICE_PERMISSIONS)[number] | (typeof CLINICAL_PERMISSIONS)[number];

/**
 * Registri layar fase 2–10 (ADR-0023, peta docs/08 §4). Satu tempat yang menentukan sumber data tiap layar:
 * - `belum`: belum dibangun; menu redup di semua mode.
 * - `demo`: sudah dibangun dengan data dummy fiktif; hanya tampil di mode presentasi (lokal + DATA_SOURCE=demo).
 * - `api`: tersambung ke backend; tampil di semua lingkungan (penegakan izin di API).
 * Saat backend sebuah domain jadi, cukup ubah status di sini (dan ganti `requires` menu ke izin sungguhan).
 */
export type ScreenStatus = 'belum' | 'demo' | 'api';

export interface ScreenDef {
  /** Sama dengan id menu (`nav.ts`) bila layar punya menu. */
  id: string;
  label: string;
  /** Rute final (docs/08 §4); layar berparameter memakai awalan rutenya. */
  route: string;
  /** Mockup acuan di `design/mockups/`, null bila belum ada mockup. */
  mockup: string | null;
  /** Kode komponen katalog (docs/02). */
  components: readonly string[];
  phase: number;
  status: ScreenStatus;
  /**
   * Izin yang direncanakan untuk backend (`sumber.aksi`; layar fase 2 sudah ada di PERMISSION_CATALOG, fase berikutnya
   * belum). Di mode demo layar dibatasi per peran (`demoRoles`) hanya di sisi UI; penegakan sungguhan lewat izin ini
   * saat backend dibangun.
   */
  plannedPermission: string;
  /**
   * Izin sungguhan untuk layar hibrida demo/api (`requireScreen`): mode presentasi tetap memakai data dummy, mode api
   * membuka rute untuk peran yang memegang izin ini (isi api diisi potongan fase 2–3). Kosong = layar hanya ada di mode
   * presentasi sampai domainnya punya izin di katalog.
   */
  permission?: ScreenPermission;
  /**
   * Layar hanya ada di mode api (tanpa mockup dan tanpa jalur data dummy, mis. Kendali antrean): di mode presentasi
   * tertutup (menu tersembunyi, rute 404).
   */
  apiOnly?: true;
  /** Posisi (peran) yang melihat layar ini di mode presentasi. */
  demoRoles: readonly SystemRoleCode[] | 'semua';
  /** `staf` = di kerangka staf (sidebar); `perangkat` = layar penuh (anjungan, TV, tablet, pratinjau ponsel). */
  layout: 'staf' | 'perangkat';
}

const CLINICIANS: readonly SystemRoleCode[] = ['dokter', 'dokter_residen', 'perawat', 'bidan'];

export const SCREENS: readonly ScreenDef[] = [
  {
    id: 'simulasi',
    label: 'Simulasi pasien',
    route: '/simulasi',
    mockup: 'Simulasi',
    components: [],
    phase: 10,
    status: 'demo',
    plannedPermission: 'simulation.use',
    demoRoles: 'semua',
    layout: 'staf',
  },
  {
    id: 'daftar',
    label: 'Pendaftaran',
    route: '/pendaftaran',
    mockup: 'Registrasi',
    components: ['F03', 'F06'],
    phase: 2,
    status: 'demo',
    plannedPermission: 'encounter.write',
    permission: 'encounter.write',
    demoRoles: ['petugas_pendaftaran'],
    layout: 'staf',
  },
  {
    id: 'jadwal',
    label: 'Jadwal dokter',
    route: '/jadwal',
    mockup: 'Jadwal',
    components: ['F01'],
    phase: 2,
    status: 'demo',
    plannedPermission: 'schedule.read',
    permission: 'schedule.read',
    demoRoles: ['petugas_pendaftaran', 'dokter', 'manajemen'],
    layout: 'staf',
  },
  {
    id: 'kiosk',
    label: 'Anjungan mandiri',
    route: '/kiosk',
    mockup: 'Anjungan',
    components: ['F05'],
    phase: 2,
    status: 'demo',
    plannedPermission: 'kiosk.use',
    permission: 'kiosk.use',
    demoRoles: ['petugas_pendaftaran'],
    layout: 'perangkat',
  },
  {
    id: 'antrean',
    label: 'Display antrean',
    route: '/display/antrean',
    mockup: 'DisplayAntrean',
    components: ['F04'],
    phase: 2,
    status: 'demo',
    plannedPermission: 'queue.display.read',
    permission: 'queue.display.read',
    demoRoles: ['petugas_pendaftaran'],
    layout: 'perangkat',
  },
  {
    id: 'kendali',
    label: 'Kendali antrean',
    route: '/antrean',
    mockup: null,
    components: ['F04'],
    phase: 2,
    status: 'api',
    plannedPermission: 'queue.read',
    permission: 'queue.read',
    demoRoles: ['petugas_pendaftaran'],
    apiOnly: true,
    layout: 'staf',
  },
  {
    id: 'poli',
    label: 'Pemeriksaan poli',
    route: '/klinis/poli',
    mockup: 'Main',
    components: ['K01', 'K02'],
    phase: 3,
    status: 'demo',
    plannedPermission: 'clinical.write',
    permission: 'clinical.write',
    demoRoles: CLINICIANS,
    layout: 'staf',
  },
  {
    id: 'order',
    label: 'Order & resep (CPOE)',
    route: '/klinis/order',
    mockup: 'CPOE',
    components: ['K09'],
    phase: 3,
    status: 'demo',
    plannedPermission: 'order.write',
    permission: 'order.write',
    demoRoles: ['dokter', 'dokter_residen'],
    layout: 'staf',
  },
  {
    id: 'igd',
    label: 'IGD',
    route: '/klinis/igd',
    mockup: 'IGD',
    components: ['K03'],
    phase: 3,
    status: 'demo',
    plannedPermission: 'clinical.read',
    permission: 'clinical.read',
    // Admisi IGD (petugas pendaftaran) membuka kunjungan gawat darurat dari papan IGD.
    demoRoles: ['dokter', 'dokter_residen', 'perawat', 'petugas_pendaftaran'],
    layout: 'staf',
  },
  {
    id: 'bed',
    label: 'Tempat tidur',
    route: '/klinis/tempat-tidur',
    mockup: 'BedManagement',
    components: ['K05'],
    phase: 3,
    status: 'demo',
    plannedPermission: 'bed.read',
    permission: 'bed.read',
    demoRoles: ['perawat', 'petugas_pendaftaran', 'manajemen'],
    layout: 'staf',
  },
  {
    id: 'ranap',
    label: 'Rawat inap',
    route: '/klinis/rawat-inap',
    mockup: 'Ranap',
    components: ['K04', 'K07', 'K12'],
    phase: 3,
    status: 'demo',
    plannedPermission: 'clinical.write',
    permission: 'clinical.write',
    demoRoles: CLINICIANS,
    layout: 'staf',
  },
  {
    id: 'resume',
    label: 'Resume medis',
    route: '/klinis/resume',
    mockup: 'Resume',
    components: ['K13'],
    phase: 3,
    status: 'demo',
    plannedPermission: 'clinical.write',
    permission: 'clinical.write',
    demoRoles: ['dokter', 'dokter_residen'],
    layout: 'staf',
  },
  {
    id: 'consent',
    label: 'Persetujuan tindakan',
    route: '/tablet/persetujuan',
    mockup: 'Consent',
    components: ['K11'],
    phase: 3,
    status: 'demo',
    plannedPermission: 'consent.write',
    permission: 'consent.write',
    demoRoles: ['dokter', 'perawat'],
    layout: 'perangkat',
  },
  {
    id: 'lab',
    label: 'Laboratorium',
    route: '/penunjang/lab',
    mockup: 'Lab',
    components: ['S01', 'S09'],
    phase: 4,
    status: 'demo',
    plannedPermission: 'lab.write',
    demoRoles: ['analis_lab'],
    layout: 'staf',
  },
  {
    id: 'rad',
    label: 'Radiologi',
    route: '/penunjang/radiologi',
    mockup: null,
    components: ['S03'],
    phase: 4,
    status: 'demo',
    plannedPermission: 'radiology.write',
    demoRoles: ['radiografer'],
    layout: 'staf',
  },
  {
    id: 'farmasi',
    label: 'Farmasi',
    route: '/penunjang/farmasi',
    mockup: 'Farmasi',
    components: ['S04', 'S05'],
    phase: 4,
    status: 'demo',
    plannedPermission: 'pharmacy.write',
    demoRoles: ['apoteker'],
    layout: 'staf',
  },
  {
    id: 'ok',
    label: 'Kamar operasi',
    route: '/penunjang/kamar-operasi',
    mockup: 'OK',
    components: ['S06'],
    phase: 4,
    status: 'demo',
    plannedPermission: 'surgery.write',
    demoRoles: ['dokter', 'perawat'],
    layout: 'staf',
  },
  {
    id: 'kasir',
    label: 'Kasir',
    route: '/keuangan/kasir',
    mockup: 'Kasir',
    components: ['U02', 'U03'],
    phase: 5,
    status: 'demo',
    plannedPermission: 'billing.write',
    demoRoles: ['kasir'],
    layout: 'staf',
  },
  {
    id: 'klaim',
    label: 'Klaim & koding',
    route: '/keuangan/klaim',
    mockup: 'Klaim',
    components: ['U05', 'U06'],
    phase: 5,
    status: 'demo',
    plannedPermission: 'claim.write',
    demoRoles: ['koder'],
    layout: 'staf',
  },
  {
    id: 'akuntansi',
    label: 'Akuntansi',
    route: '/keuangan/akuntansi',
    mockup: 'Akuntansi',
    components: ['U04', 'U07', 'U09'],
    phase: 5,
    status: 'demo',
    plannedPermission: 'accounting.write',
    demoRoles: ['akuntan'],
    layout: 'staf',
  },
  {
    id: 'pembayaran',
    label: 'Pembayaran digital',
    route: '/keuangan/pembayaran',
    mockup: 'PembayaranBTN',
    components: ['I05', 'U09'],
    phase: 6,
    status: 'demo',
    plannedPermission: 'payment.write',
    demoRoles: ['kasir', 'akuntan'],
    layout: 'staf',
  },
  {
    id: 'pembiayaan',
    label: 'Pembiayaan BTN',
    route: '/keuangan/pembiayaan',
    mockup: 'PembiayaanBTN',
    components: ['U04'],
    phase: 6,
    status: 'demo',
    plannedPermission: 'financing.write',
    demoRoles: ['akuntan', 'manajemen'],
    layout: 'staf',
  },
  {
    id: 'integrasi',
    label: 'Integrasi',
    route: '/sistem/integrasi',
    mockup: 'Integrasi',
    components: ['I01', 'I02', 'I03', 'I04', 'I05', 'I06'],
    phase: 7,
    status: 'demo',
    plannedPermission: 'integration.read',
    demoRoles: ['admin_tenant'],
    layout: 'staf',
  },
  {
    id: 'logistik',
    label: 'Logistik',
    route: '/manajemen/logistik',
    mockup: 'Logistik',
    components: ['B01'],
    phase: 8,
    status: 'demo',
    plannedPermission: 'inventory.write',
    demoRoles: ['manajemen', 'apoteker'],
    layout: 'staf',
  },
  {
    id: 'mutu',
    label: 'Mutu & keselamatan',
    route: '/manajemen/mutu',
    mockup: null,
    components: ['B06'],
    phase: 8,
    status: 'demo',
    plannedPermission: 'quality.read',
    demoRoles: ['auditor_mutu', 'manajemen'],
    layout: 'staf',
  },
  {
    id: 'dasbor',
    label: 'Dasbor eksekutif',
    route: '/manajemen/dasbor',
    mockup: 'Dasbor',
    components: ['I09'],
    phase: 9,
    status: 'demo',
    plannedPermission: 'dashboard.read',
    demoRoles: ['manajemen'],
    layout: 'staf',
  },
  {
    id: 'app-pasien',
    label: 'Aplikasi pasien (pratinjau)',
    route: '/pratinjau/aplikasi-pasien',
    mockup: 'AppPasien',
    components: ['I07'],
    phase: 9,
    status: 'demo',
    plannedPermission: 'preview.read',
    demoRoles: 'semua',
    layout: 'perangkat',
  },
  {
    id: 'app-dokter',
    label: 'Aplikasi dokter (pratinjau)',
    route: '/pratinjau/aplikasi-dokter',
    mockup: 'AppDokter',
    components: ['I08'],
    phase: 9,
    status: 'demo',
    plannedPermission: 'preview.read',
    demoRoles: 'semua',
    layout: 'perangkat',
  },
  // FE5 · back office fase 8 dan kanal fase 9 (mode presentasi, tanpa mockup; isi dari prototipe alur)
  {
    id: 'rm-adm',
    label: 'RM administratif',
    route: '/rekam-medis/administrasi',
    mockup: null,
    components: ['B09'],
    phase: 8,
    status: 'demo',
    plannedPermission: 'record.release.read',
    demoRoles: ['petugas_rm', 'petugas_privasi', 'manajemen'],
    layout: 'staf',
  },
  {
    id: 'sdm',
    label: 'SDM & kepegawaian',
    route: '/manajemen/sdm',
    mockup: null,
    components: ['B03'],
    phase: 8,
    status: 'demo',
    plannedPermission: 'hr.read',
    demoRoles: ['manajemen'],
    layout: 'staf',
  },
  {
    id: 'kredensial',
    label: 'Kredensial & kewenangan',
    route: '/manajemen/kredensial',
    mockup: null,
    components: ['B04'],
    phase: 8,
    status: 'demo',
    plannedPermission: 'credential.verify',
    demoRoles: ['manajemen', 'dokter'],
    layout: 'staf',
  },
  {
    id: 'ppi',
    label: 'PPI',
    route: '/manajemen/ppi',
    mockup: null,
    components: ['B07'],
    phase: 8,
    status: 'demo',
    plannedPermission: 'ipc.read',
    demoRoles: ['auditor_mutu', 'perawat'],
    layout: 'staf',
  },
  // FE5 · akhir
];

const BY_ID = new Map(SCREENS.map((s) => [s.id, s]));

export function screenById(id: string): ScreenDef | undefined {
  return BY_ID.get(id);
}

/**
 * Layar terbuka untuk posisi ini di sumber data aktif?
 * - `belum`: tidak pernah; `apiOnly` tidak pernah di mode presentasi.
 * - Mode presentasi: layar `demo` dan layar hibrida (ber-`permission`) mengikuti `demoRoles` (data dummy).
 * - Mode api: layar hibrida hanya untuk peran yang memegang izinnya (`permissions` sesi); layar `api` tanpa izin
 *   terdaftar selalu terbuka (izin ditegakkan API); layar `demo` tertutup.
 */
export function screenOpen(
  screen: ScreenDef,
  opts: { dataSource: 'api' | 'demo'; role: string | null; permissions?: readonly string[] },
): boolean {
  if (screen.status === 'belum') return false;
  if (screen.apiOnly && opts.dataSource === 'demo') return false;
  if (opts.dataSource === 'demo' && (screen.status === 'demo' || screen.permission)) {
    return screen.demoRoles === 'semua' || (!!opts.role && screen.demoRoles.some((r) => r === opts.role));
  }
  if (screen.permission) return opts.permissions?.includes(screen.permission) ?? false;
  return screen.status === 'api';
}
