import type { SystemRoleCode } from '@simrs/shared';

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
   * Izin yang direncanakan untuk backend (belum ada di PERMISSION_CATALOG). Di mode demo layar dibatasi per peran
   * (`demoRoles`) hanya di sisi UI; penegakan sungguhan lewat izin ini saat backend dibangun.
   */
  plannedPermission: string;
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
    status: 'belum',
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
    status: 'belum',
    plannedPermission: 'encounter.write',
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
    status: 'belum',
    plannedPermission: 'schedule.read',
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
    status: 'belum',
    plannedPermission: 'kiosk.use',
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
    status: 'belum',
    plannedPermission: 'queue.display',
    demoRoles: ['petugas_pendaftaran'],
    layout: 'perangkat',
  },
  {
    id: 'poli',
    label: 'Pemeriksaan poli',
    route: '/klinis/poli',
    mockup: 'Main',
    components: ['K01', 'K02'],
    phase: 3,
    status: 'belum',
    plannedPermission: 'clinical.write',
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
    status: 'belum',
    plannedPermission: 'order.write',
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
    status: 'belum',
    plannedPermission: 'clinical.write',
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
    status: 'belum',
    plannedPermission: 'bed.write',
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
    status: 'belum',
    plannedPermission: 'clinical.write',
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
    status: 'belum',
    plannedPermission: 'clinical.sign',
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
    status: 'belum',
    plannedPermission: 'consent.write',
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
    status: 'belum',
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
    status: 'belum',
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
    status: 'belum',
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
    status: 'belum',
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
    status: 'belum',
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
    status: 'belum',
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
    status: 'belum',
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
    status: 'belum',
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
    status: 'belum',
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
    status: 'belum',
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
    status: 'belum',
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
    status: 'belum',
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
    status: 'belum',
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
    status: 'belum',
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
    status: 'belum',
    plannedPermission: 'preview.read',
    demoRoles: 'semua',
    layout: 'perangkat',
  },
];

const BY_ID = new Map(SCREENS.map((s) => [s.id, s]));

export function screenById(id: string): ScreenDef | undefined {
  return BY_ID.get(id);
}

/** Layar terbuka untuk posisi ini di sumber data aktif? (`belum` tidak pernah; `demo` hanya di mode demo.) */
export function screenOpen(
  screen: ScreenDef,
  opts: { dataSource: 'api' | 'demo'; role: string | null },
): boolean {
  if (screen.status === 'belum') return false;
  if (screen.status === 'api') return true;
  if (opts.dataSource !== 'demo') return false;
  return screen.demoRoles === 'semua' || (!!opts.role && screen.demoRoles.some((r) => r === opts.role));
}
