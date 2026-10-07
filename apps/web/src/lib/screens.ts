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
  'forms.definition.read',
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
    demoRoles: ['analis_lab', 'dokter'],
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
    demoRoles: ['radiografer', 'dokter'],
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
    demoRoles: ['apoteker', 'dokter'],
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
  // FE3 · fase 4 penunjang lanjutan (mode presentasi, data dummy)
  {
    id: 'kritis',
    label: 'Pusat hasil kritis',
    route: '/penunjang/hasil-kritis',
    mockup: null,
    components: ['S09'],
    phase: 4,
    status: 'demo',
    plannedPermission: 'critical_result.report',
    demoRoles: ['analis_lab', 'radiografer', 'dokter', 'perawat'],
    layout: 'staf',
  },
  {
    id: 'depo',
    label: 'Depo & stok farmasi',
    route: '/penunjang/depo',
    mockup: null,
    components: ['S05'],
    phase: 4,
    status: 'demo',
    plannedPermission: 'stock.write',
    demoRoles: ['apoteker'],
    layout: 'staf',
  },
  {
    id: 'bank-darah',
    label: 'Bank darah',
    route: '/penunjang/bank-darah',
    mockup: null,
    components: ['S08'],
    phase: 4,
    status: 'demo',
    plannedPermission: 'blood.write',
    demoRoles: ['analis_lab', 'perawat', 'bidan', 'dokter'],
    layout: 'staf',
  },
  {
    id: 'gizi',
    label: 'Gizi',
    route: '/penunjang/gizi',
    mockup: null,
    components: ['S07'],
    phase: 4,
    status: 'demo',
    plannedPermission: 'nutrition.write',
    // Peran `nutrisionis` (keputusan fase 4 #21) belum ada di katalog; sementara perawat dan dokter.
    demoRoles: ['perawat', 'dokter'],
    layout: 'staf',
  },
  {
    id: 'mikro',
    label: 'Mikrobiologi & PA',
    route: '/penunjang/mikrobiologi',
    mockup: null,
    components: ['S02'],
    phase: 4,
    status: 'demo',
    plannedPermission: 'lab.write',
    demoRoles: ['analis_lab', 'dokter'],
    layout: 'staf',
  },
  {
    id: 'diagnostik',
    label: 'Diagnostik lain',
    route: '/penunjang/diagnostik',
    mockup: null,
    components: ['S10'],
    phase: 4,
    status: 'demo',
    plannedPermission: 'diagnostic.write',
    demoRoles: ['dokter', 'perawat'],
    layout: 'staf',
  },
  // FE3 · akhir
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
  // FE4 · keuangan lanjutan (U01–U10, I10), tanpa mockup; mode presentasi (ADR-0023).
  {
    id: 'tarif',
    label: 'Tarif & paket',
    route: '/keuangan/tarif',
    mockup: null,
    components: ['U01'],
    phase: 5,
    status: 'demo',
    plannedPermission: 'tariff.write',
    demoRoles: ['akuntan', 'manajemen'],
    layout: 'staf',
  },
  {
    id: 'charge',
    label: 'Charge capture',
    route: '/keuangan/charge-capture',
    mockup: null,
    components: ['U02'],
    phase: 5,
    status: 'demo',
    plannedPermission: 'billing.read',
    demoRoles: ['kasir', 'akuntan'],
    layout: 'staf',
  },
  {
    id: 'piutang',
    label: 'Penjaminan & piutang',
    route: '/keuangan/piutang',
    mockup: null,
    components: ['U04'],
    phase: 5,
    status: 'demo',
    plannedPermission: 'receivable.write',
    demoRoles: ['akuntan', 'manajemen'],
    layout: 'staf',
  },
  {
    id: 'koding',
    label: 'Workbench koder',
    route: '/keuangan/koding',
    mockup: null,
    components: ['U06'],
    phase: 5,
    status: 'demo',
    plannedPermission: 'claim.write',
    demoRoles: ['koder'],
    layout: 'staf',
  },
  {
    id: 'jaspel',
    label: 'Jasa pelayanan',
    route: '/keuangan/jasa-pelayanan',
    mockup: null,
    components: ['U08'],
    phase: 5,
    status: 'demo',
    plannedPermission: 'fee_sharing.read',
    demoRoles: ['akuntan', 'manajemen'],
    layout: 'staf',
  },
  {
    id: 'kas-bank',
    label: 'Kas & bank',
    route: '/keuangan/kas-bank',
    mockup: null,
    components: ['U09'],
    phase: 5,
    status: 'demo',
    plannedPermission: 'cashbank.write',
    demoRoles: ['kasir', 'akuntan'],
    layout: 'staf',
  },
  {
    id: 'hutang',
    label: 'Hutang usaha',
    route: '/keuangan/hutang',
    mockup: null,
    components: ['U10'],
    phase: 5,
    status: 'demo',
    plannedPermission: 'payable.write',
    demoRoles: ['akuntan', 'manajemen'],
    layout: 'staf',
  },
  {
    id: 'costing',
    label: 'Costing & case-mix',
    route: '/keuangan/costing',
    mockup: null,
    components: ['I10'],
    phase: 9,
    status: 'demo',
    plannedPermission: 'costing.read',
    demoRoles: ['manajemen', 'akuntan'],
    layout: 'staf',
  },
  // FE4 · akhir
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
  // FE3 · fase 7 konektor integrasi (mode presentasi, data dummy)
  {
    id: 'satusehat',
    label: 'SATUSEHAT',
    route: '/sistem/integrasi/satusehat',
    mockup: null,
    components: ['I02'],
    phase: 7,
    status: 'demo',
    plannedPermission: 'integration.manage',
    demoRoles: ['admin_tenant'],
    layout: 'staf',
  },
  {
    id: 'bpjs',
    label: 'Konektor BPJS',
    route: '/sistem/integrasi/bpjs',
    mockup: null,
    components: ['I03'],
    phase: 7,
    status: 'demo',
    plannedPermission: 'integration.manage',
    demoRoles: ['admin_tenant'],
    layout: 'staf',
  },
  {
    id: 'kemenkes',
    label: 'Kemenkes (SIRS)',
    route: '/sistem/integrasi/kemenkes',
    mockup: null,
    components: ['I04'],
    phase: 7,
    status: 'demo',
    plannedPermission: 'integration.manage',
    demoRoles: ['admin_tenant'],
    layout: 'staf',
  },
  {
    id: 'perangkat',
    label: 'Perangkat medis',
    route: '/sistem/integrasi/perangkat',
    mockup: null,
    components: ['I06'],
    phase: 7,
    status: 'demo',
    plannedPermission: 'integration.manage',
    demoRoles: ['admin_tenant'],
    layout: 'staf',
  },
  {
    id: 'api-publik',
    label: 'API publik & FHIR',
    route: '/sistem/integrasi/api-publik',
    mockup: null,
    components: ['I12'],
    phase: 7,
    status: 'demo',
    plannedPermission: 'integration.manage',
    demoRoles: ['admin_tenant'],
    layout: 'staf',
  },
  // FE3 · akhir fase 7
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
  // FE2 · Fase 3 rekam medis elektronik (K01, K06–K08, K10–K15): layar demo mode presentasi, tanpa API.
  {
    id: 'worklist',
    label: 'Worklist klinis',
    route: '/klinis/worklist',
    mockup: null,
    components: ['K01'],
    phase: 3,
    status: 'demo',
    plannedPermission: 'clinical.read',
    demoRoles: CLINICIANS,
    layout: 'staf',
  },
  {
    id: 'cppt',
    label: 'CPPT & serah terima',
    route: '/klinis/cppt',
    mockup: 'Ranap',
    components: ['K07'],
    phase: 3,
    status: 'demo',
    plannedPermission: 'cppt.write',
    demoRoles: [...CLINICIANS, 'apoteker'],
    layout: 'staf',
  },
  {
    id: 'asesmen',
    label: 'Asesmen & skrining',
    route: '/klinis/asesmen',
    mockup: 'Formulir',
    components: ['K06'],
    phase: 3,
    status: 'demo',
    plannedPermission: 'forms.response.write',
    demoRoles: CLINICIANS,
    layout: 'staf',
  },
  {
    id: 'diagnosis',
    label: 'Diagnosis & problem list',
    route: '/klinis/diagnosis',
    mockup: null,
    components: ['K08'],
    phase: 3,
    status: 'demo',
    plannedPermission: 'diagnosis.write',
    demoRoles: CLINICIANS,
    layout: 'staf',
  },
  {
    id: 'konsul',
    label: 'Konsultasi & rawat bersama',
    route: '/klinis/konsultasi',
    mockup: null,
    components: ['K10'],
    phase: 3,
    status: 'demo',
    plannedPermission: 'clinical.write',
    permission: 'clinical.write',
    demoRoles: ['dokter', 'dokter_residen'],
    layout: 'staf',
  },
  {
    id: 'edukasi',
    label: 'Edukasi pasien',
    route: '/klinis/edukasi',
    mockup: 'Consent',
    components: ['K11'],
    phase: 3,
    status: 'demo',
    plannedPermission: 'education.write',
    demoRoles: CLINICIANS,
    layout: 'staf',
  },
  {
    id: 'askep',
    label: 'Asuhan keperawatan',
    route: '/klinis/asuhan-keperawatan',
    mockup: 'Ranap',
    components: ['K12'],
    phase: 3,
    status: 'demo',
    plannedPermission: 'nursing.write',
    demoRoles: ['perawat', 'bidan'],
    layout: 'staf',
  },
  {
    id: 'ringkasan',
    label: 'Ringkasan pasien',
    route: '/klinis/ringkasan',
    mockup: null,
    components: ['K14'],
    phase: 3,
    status: 'demo',
    plannedPermission: 'clinical.read',
    demoRoles: CLINICIANS,
    layout: 'staf',
  },
  {
    id: 'paket',
    label: 'Paket layanan khusus',
    route: '/klinis/paket-layanan',
    mockup: null,
    components: ['K15'],
    phase: 3,
    status: 'demo',
    plannedPermission: 'forms.definition.read',
    permission: 'forms.definition.read',
    demoRoles: ['dokter', 'perawat', 'bidan'],
    layout: 'staf',
  },
  {
    id: 'kelengkapan',
    label: 'Kelengkapan rekam medis',
    route: '/klinis/kelengkapan',
    mockup: 'Resume',
    components: ['K13'],
    phase: 3,
    status: 'demo',
    plannedPermission: 'clinical.sign',
    demoRoles: ['dokter', 'dokter_residen', 'petugas_rm'],
    layout: 'staf',
  },
  // FE2 · akhir
  // FE1 · platform fase 1–2 tanpa layar + operasional fase 10 (mode presentasi)
  {
    id: 'struktur',
    label: 'Struktur RS',
    route: '/sistem/struktur',
    mockup: null,
    components: ['P01'],
    phase: 1,
    status: 'demo',
    plannedPermission: 'facility.write',
    demoRoles: ['admin_tenant', 'manajemen'],
    layout: 'staf',
  },
  {
    id: 'pengaturan',
    label: 'Pengaturan RS',
    route: '/sistem/pengaturan',
    mockup: null,
    components: ['P10', 'P12'],
    phase: 1,
    status: 'demo',
    plannedPermission: 'tenant.settings.write',
    demoRoles: ['admin_tenant'],
    layout: 'staf',
  },
  {
    id: 'terminologi',
    label: 'Data rujukan',
    route: '/sistem/terminologi',
    mockup: null,
    components: ['P06'],
    phase: 1,
    status: 'demo',
    plannedPermission: 'ref.write',
    demoRoles: ['admin_tenant', 'koder', 'petugas_rm'],
    layout: 'staf',
  },
  {
    id: 'dokumen',
    label: 'Dokumen & TTE',
    route: '/rekam-medis/dokumen',
    mockup: null,
    components: ['P08'],
    phase: 1,
    status: 'demo',
    plannedPermission: 'documents.write',
    demoRoles: ['petugas_rm', 'dokter'],
    layout: 'staf',
  },
  {
    id: 'penjadwal',
    label: 'Penjadwal pekerjaan',
    route: '/sistem/penjadwal',
    mockup: null,
    components: ['P11'],
    phase: 1,
    status: 'demo',
    plannedPermission: 'jobs.manage',
    demoRoles: ['admin_tenant'],
    layout: 'staf',
  },
  {
    id: 'rujukan',
    label: 'Rujukan',
    route: '/rujukan',
    mockup: null,
    components: ['F07', 'F06'],
    phase: 2,
    status: 'demo',
    plannedPermission: 'referral.write',
    demoRoles: ['petugas_pendaftaran', 'dokter'],
    layout: 'staf',
  },
  {
    id: 'info-publik',
    label: 'Info publik (pratinjau)',
    route: '/pratinjau/info-publik',
    mockup: null,
    components: ['F08'],
    phase: 2,
    status: 'demo',
    // Portal publik tanpa login (gateway `/api/v1/public`); izin katalog terdekat untuk registri fase 2.
    plannedPermission: 'schedule.read',
    demoRoles: 'semua',
    layout: 'perangkat',
  },
  {
    id: 'downtime',
    label: 'Mode downtime',
    route: '/sistem/downtime',
    mockup: null,
    components: ['P13'],
    phase: 10,
    status: 'demo',
    plannedPermission: 'system.downtime.manage',
    demoRoles: ['admin_tenant'],
    layout: 'staf',
  },
  {
    id: 'cadangan',
    label: 'Cadangan & pemulihan',
    route: '/sistem/cadangan',
    mockup: null,
    components: [],
    phase: 10,
    status: 'demo',
    plannedPermission: 'backup.read',
    demoRoles: ['admin_tenant'],
    layout: 'staf',
  },
  {
    id: 'golive',
    label: 'Kesiapan go-live',
    route: '/sistem/go-live',
    mockup: null,
    components: [],
    phase: 10,
    status: 'demo',
    plannedPermission: 'golive.read',
    demoRoles: ['manajemen', 'admin_tenant', 'petugas_rm'],
    layout: 'staf',
  },
  // FE1 · akhir
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
  {
    id: 'aset',
    label: 'Aset & pemeliharaan',
    route: '/manajemen/aset',
    mockup: null,
    components: ['B02'],
    phase: 8,
    status: 'demo',
    plannedPermission: 'asset.write',
    demoRoles: ['manajemen', 'perawat'],
    layout: 'staf',
  },
  {
    id: 'penggajian',
    label: 'Penggajian',
    route: '/manajemen/penggajian',
    mockup: null,
    components: ['B05'],
    phase: 8,
    status: 'demo',
    plannedPermission: 'payroll.approve',
    demoRoles: ['akuntan', 'manajemen'],
    layout: 'staf',
  },
  {
    id: 'ppra',
    label: 'PPRA',
    route: '/manajemen/ppra',
    mockup: null,
    components: ['B08'],
    phase: 8,
    status: 'demo',
    plannedPermission: 'ams.approve',
    demoRoles: ['apoteker', 'dokter'],
    layout: 'staf',
  },
  {
    id: 'regdok',
    label: 'Dokumen & akreditasi',
    route: '/manajemen/dokumen',
    mockup: null,
    components: ['B12'],
    phase: 8,
    status: 'demo',
    plannedPermission: 'regdoc.approve',
    demoRoles: ['auditor_mutu', 'manajemen'],
    layout: 'staf',
  },
  {
    id: 'pengaduan',
    label: 'Pengalaman pasien',
    route: '/manajemen/pengaduan',
    mockup: null,
    components: ['B13'],
    phase: 8,
    status: 'demo',
    plannedPermission: 'complaint.write',
    demoRoles: ['auditor_mutu', 'petugas_pendaftaran', 'manajemen'],
    layout: 'staf',
  },
  {
    id: 'pendidikan',
    label: 'Pendidikan klinik',
    route: '/manajemen/pendidikan',
    mockup: null,
    components: ['B10'],
    phase: 8,
    status: 'demo',
    plannedPermission: 'education.write',
    demoRoles: ['dokter', 'manajemen'],
    layout: 'staf',
  },
  {
    id: 'onkologi',
    label: 'Onkologi',
    route: '/klinis/onkologi',
    mockup: null,
    components: ['B11'],
    phase: 8,
    status: 'demo',
    plannedPermission: 'oncology.verify',
    demoRoles: ['dokter', 'apoteker'],
    layout: 'staf',
  },
  {
    id: 'command-center',
    label: 'Command center',
    route: '/manajemen/command-center',
    mockup: null,
    components: ['I09'],
    phase: 9,
    status: 'demo',
    plannedPermission: 'dashboard.read',
    demoRoles: ['manajemen'],
    layout: 'staf',
  },
  {
    id: 'dataset-riset',
    label: 'Dataset riset',
    route: '/manajemen/dataset-riset',
    mockup: null,
    components: ['I11'],
    phase: 9,
    status: 'demo',
    plannedPermission: 'dataset.approve',
    demoRoles: ['petugas_privasi', 'manajemen'],
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
 * - Mode presentasi: layar `demo` dan layar hibrida (ber-`permission`) mengikuti `demoRoles` (data dummy). Posisi
 *   Superadmin demo (`allAccess`, ADR-0023 keputusan 10) dianggap memegang semua `demoRoles`.
 * - Mode api: layar hibrida hanya untuk peran yang memegang izinnya (`permissions` sesi); layar `api` tanpa izin
 *   terdaftar selalu terbuka (izin ditegakkan API); layar `demo` tertutup. `allAccess` diabaikan total.
 */
export function screenOpen(
  screen: ScreenDef,
  opts: {
    dataSource: 'api' | 'demo';
    role: string | null;
    permissions?: readonly string[];
    /** Sesi Superadmin demo yang sudah diverifikasi server; hanya berlaku di mode presentasi. */
    allAccess?: boolean;
  },
): boolean {
  if (screen.status === 'belum') return false;
  if (screen.apiOnly && opts.dataSource === 'demo') return false;
  if (opts.dataSource === 'demo' && (screen.status === 'demo' || screen.permission)) {
    if (opts.allAccess === true) return true;
    return screen.demoRoles === 'semua' || (!!opts.role && screen.demoRoles.some((r) => r === opts.role));
  }
  if (screen.permission) return opts.permissions?.includes(screen.permission) ?? false;
  return screen.status === 'api';
}

/** Layar registri yang memuat `pathname` (awalan rute terpanjang; query diabaikan), atau undefined. */
export function screenForPath(pathname: string): ScreenDef | undefined {
  const path = pathname.split(/[?#]/)[0] ?? '';
  let best: ScreenDef | undefined;
  for (const s of SCREENS) {
    if (
      (path === s.route || path.startsWith(`${s.route}/`)) &&
      (!best || s.route.length > best.route.length)
    ) {
      best = s;
    }
  }
  return best;
}

/** Pilihan "Bertindak sebagai" di layar ini: posisi pemakainya (kosong bila layar untuk semua posisi). */
export function actingRoleOptions(screen: ScreenDef | undefined): readonly SystemRoleCode[] {
  return screen && screen.demoRoles !== 'semua' ? screen.demoRoles : [];
}

/**
 * Posisi yang dibawakan Superadmin demo di layar ini (ADR-0023 keputusan 10): pilihan presenter bila layar memakai
 * posisi itu, selain itu pemakai pertama layar (bawaan yang sama dengan uji semua layar). Layar untuk semua posisi
 * dan halaman di luar registri memakai pilihan presenter atau peran asli akun. Hanya memilih tampilan di mode
 * presentasi; gerbang keselamatan dan alasan override tetap berlaku untuk posisi mana pun.
 */
export function actingRoleFor(
  screen: ScreenDef | undefined,
  preferred: string | null,
  base: string | null,
): string | null {
  const options = actingRoleOptions(screen);
  if (options.length === 0) return preferred ?? base;
  if (preferred && options.some((r) => r === preferred)) return preferred;
  return options[0] ?? base;
}
