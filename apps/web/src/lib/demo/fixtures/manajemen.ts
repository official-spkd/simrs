import type {
  DlqMessage,
  DoctorAppInbox,
  ExpiryAlert,
  IncidentReport,
  IntegrationOverview,
  InterfaceCard,
  InterfaceId,
  InventoryItem,
  LogisticsOverview,
  PatientAppHome,
  PurchaseOrder,
  QualityIndicator,
  QualityOverview,
  RiskEntry,
} from '@simrs/shared';
import type { LogEntry } from '../engine/types';
import { countInterfaceLogs, daysOfCover, reorderPoint } from '../../manajemen';
import { demoExecutiveDashboard } from './dasbor';
import { COSIGN_NOTE_ID, DOCTOR_APP_PATIENT_ID, PATIENT_ID } from './ids';
import { PERSONA } from './staf';
import { DEMO_NOW, DEMO_TODAY, shiftDate } from './waktu';

/**
 * Data dummy domain manajemen (ADR-0023): integration hub (I01–I06), logistik (B01), mutu (B06), dan basis
 * aplikasi pasien/dokter (I07–I08). Semua fiktif; pemasok dan fasilitas memakai nama generik. Payload
 * dead-letter hanya berisi pengenal teknis (tanpa nama, NIK, atau isi klinis) — dijaga tes.
 */

const at = (hhmm: string) => `${DEMO_TODAY}T${hhmm}:00+07:00`;

// ─── I01–I06 · Integration hub ──────────────────────────────────────────────────────────────────────────────

/** Bentuk volume per jam 24 jam terakhir (indeks 0 = 11.00 kemarin, 23 = 10.00 hari ini): ramai jam layanan. */
const DAY_SHAPE = [
  0.9, 0.85, 0.8, 0.75, 0.7, 0.55, 0.45, 0.4, 0.35, 0.3, 0.2, 0.15, 0.12, 0.1, 0.1, 0.12, 0.18, 0.3, 0.55,
  0.8, 1, 1.05, 1, 0.85,
];

/** Deret per jam deterministik (tanpa acak): bentuk hari × puncak × variasi kecil per antarmuka. */
function hourly(peak: number, seed: number): number[] {
  return DAY_SHAPE.map((f, i) =>
    Math.max(0, Math.round(peak * f * (0.88 + ((i * 37 + seed * 13) % 25) / 100))),
  );
}

type InterfaceBase = Omit<InterfaceCard, 'scenarioVolume'>;

/** Volume hari ini SEBELUM jejak skenario (modul data menambahkan jejak skenario Simulasi). */
export const INTERFACES: readonly InterfaceBase[] = [
  {
    id: 'satusehat',
    name: 'SATUSEHAT',
    protocol: 'FHIR R4 · OAuth2 client credentials',
    status: 'lambat',
    external: true,
    volumeToday: 18_402,
    failedToday: 37,
    p95Ms: 820,
    hourly: hourly(1_600, 1),
    errorHours: [20, 21],
  },
  {
    id: 'bpjs-vclaim',
    name: 'BPJS VClaim',
    protocol: 'REST · signature HMAC',
    status: 'normal',
    external: true,
    volumeToday: 1_312,
    failedToday: 0,
    p95Ms: 410,
    hourly: hourly(120, 2),
    errorHours: [],
  },
  {
    id: 'bpjs-antrean',
    name: 'BPJS Antrean',
    protocol: 'REST · task ID 1–7',
    status: 'normal',
    external: true,
    volumeToday: 7_886,
    failedToday: 4,
    p95Ms: 290,
    hourly: hourly(700, 3),
    errorHours: [21],
  },
  {
    id: 'eklaim',
    name: 'E-Klaim INA-CBG',
    protocol: 'REST lokal · payload terenkripsi',
    status: 'normal',
    external: false,
    volumeToday: 214,
    failedToday: 0,
    p95Ms: 180,
    hourly: hourly(22, 4),
    errorHours: [],
  },
  {
    id: 'lis',
    name: 'LIS analyzer',
    protocol: 'HL7 v2 ORU/ORM · MLLP',
    status: 'normal',
    external: false,
    volumeToday: 3_920,
    failedToday: 0,
    p95Ms: 40,
    hourly: hourly(330, 5),
    errorHours: [],
  },
  {
    id: 'pacs',
    name: 'PACS radiologi',
    protocol: 'DICOM · HL7 ORM',
    status: 'gangguan',
    external: false,
    volumeToday: 96,
    failedToday: 12,
    p95Ms: null,
    hourly: hourly(14, 6),
    errorHours: [22, 23],
  },
  {
    id: 'tpdi',
    name: 'TPDI · VA BTN, QRIS',
    protocol: 'REST · webhook HMAC · idempotensi',
    status: 'normal',
    external: true,
    volumeToday: 611,
    failedToday: 1,
    p95Ms: 350,
    hourly: hourly(60, 7),
    errorHours: [19],
  },
  {
    id: 'btn-h2h',
    name: 'API BTN (mutasi H2H)',
    protocol: 'H2H · mTLS · tarik mutasi tiap 5 mnt',
    status: 'normal',
    external: true,
    volumeToday: 1_284,
    failedToday: 0,
    p95Ms: 620,
    hourly: hourly(80, 9),
    errorHours: [],
  },
  {
    id: 'notifikasi',
    name: 'Notifikasi pasien',
    protocol: 'Push aplikasi · pesan singkat (SMS)',
    status: 'normal',
    external: true,
    volumeToday: 4_207,
    failedToday: 9,
    p95Ms: 1_200,
    hourly: hourly(380, 8),
    errorHours: [18],
  },
];

export const INTERFACE_NAME: Record<InterfaceId, string> = Object.fromEntries(
  INTERFACES.map((i) => [i.id, i.name]),
) as Record<InterfaceId, string>;

/** Pesan gagal setelah 5× retry eksponensial (terbaru dulu). Payload = pengenal saja. */
export const DEAD_LETTERS: readonly DlqMessage[] = [
  {
    id: 'dlq-0118',
    at: at('10:41'),
    target: 'pacs',
    operation: 'ORM^O01 · RAD-2610-118',
    errorCode: 'ECONNREFUSED',
    errorMessage: 'Koneksi MLLP ke PACS ditolak (port 2575)',
    attempts: 5,
    maxAttempts: 5,
    critical: true,
    request: 'MLLP 10.20.4.15:2575 → ECONNREFUSED (backoff terakhir 16 dtk)',
    payload: {
      messageControlId: 'RAD-2610-118',
      encounterId: 'ENC-2610-0841',
      procedureCode: 'ICD-9-CM 87.03',
      idempotencyKey: 'orm-RAD-2610-118-01',
    },
  },
  {
    id: 'dlq-0117',
    at: at('10:39'),
    target: 'pacs',
    operation: 'ORM^O01 · RAD-2610-117',
    errorCode: 'ECONNREFUSED',
    errorMessage: 'Koneksi MLLP ke PACS ditolak (port 2575)',
    attempts: 5,
    maxAttempts: 5,
    critical: true,
    request: 'MLLP 10.20.4.15:2575 → ECONNREFUSED (backoff terakhir 16 dtk)',
    payload: {
      messageControlId: 'RAD-2610-117',
      encounterId: 'ENC-2610-0836',
      procedureCode: 'ICD-9-CM 88.76',
      idempotencyKey: 'orm-RAD-2610-117-01',
    },
  },
  {
    id: 'dlq-0103',
    at: at('10:22'),
    target: 'satusehat',
    operation: 'Encounter',
    errorCode: 'HTTP 422',
    errorMessage: 'IHS number pasien belum ada (identitas belum tervalidasi)',
    attempts: 5,
    maxAttempts: 5,
    critical: false,
    request: 'POST /fhir/Encounter → 422 Unprocessable Entity',
    payload: {
      resource: 'Encounter',
      encounterId: 'ENC-2610-0794',
      patientId: 'PAS-000731',
      issue: 'required · Encounter.subject',
    },
  },
  {
    id: 'dlq-0099',
    at: at('10:18'),
    target: 'satusehat',
    operation: 'Observation',
    errorCode: 'HTTP 400',
    errorMessage: 'Kode lab lokal belum dipetakan ke LOINC',
    attempts: 5,
    maxAttempts: 5,
    critical: false,
    request: 'POST /fhir/Observation → 400 Bad Request',
    payload: {
      resource: 'Observation',
      observationId: 'OBS-2610-5521',
      localCode: 'lokal-HbA1c',
      expectedSystem: 'http://loinc.org (4548-4)',
    },
  },
  {
    id: 'dlq-0087',
    at: at('09:57'),
    target: 'satusehat',
    operation: 'MedicationRequest',
    errorCode: 'HTTP 400',
    errorMessage: 'Racikan wajib Medication dengan daftar bahan (KFA)',
    attempts: 5,
    maxAttempts: 5,
    critical: false,
    request: 'POST /fhir/MedicationRequest → 400 Bad Request',
    payload: {
      resource: 'MedicationRequest',
      prescriptionId: 'RSP-2610-0412',
      compounded: 'ya',
      kfa: 'belum dipetakan',
    },
  },
  {
    id: 'dlq-0072',
    at: at('09:40'),
    target: 'bpjs-antrean',
    operation: 'updatewaktu · task 5',
    errorCode: 'metadata 201',
    errorMessage: 'Task 4 belum dikirim untuk kode booking ini',
    attempts: 5,
    maxAttempts: 5,
    critical: false,
    request: 'POST /antreanrs/antrean/updatewaktu → 200 OK (ditolak di level bisnis)',
    payload: { bookingCode: '2610050093', taskId: '5', pendingTask: '4' },
  },
  {
    id: 'dlq-0041',
    at: at('08:12'),
    target: 'notifikasi',
    operation: 'Pengingat kontrol',
    errorCode: 'NO_PUSH_TOKEN',
    errorMessage: 'Aplikasi belum terpasang di perangkat → dialihkan ke SMS',
    attempts: 1,
    maxAttempts: 5,
    critical: false,
    request: 'POST /push/messages → 404 token tidak terdaftar · SMS 202 Accepted 08.13',
    payload: { template: 'pengingat_kontrol', messageId: 'NTF-2610-2231', fallback: 'sms' },
  },
  {
    id: 'dlq-0035',
    at: at('07:58'),
    target: 'tpdi',
    operation: 'POST /v1/invoices · VA BTN',
    errorCode: 'HTTP 504',
    errorMessage: 'API VA BTN tidak merespons 30 dtk (via TPDI)',
    attempts: 5,
    maxAttempts: 5,
    critical: false,
    request: 'POST /v1/invoices (TPDI) → 504 Gateway Timeout',
    payload: {
      invoice: 'INV-2610-02240',
      idempotencyKey: 'INV-2610-02240-VA-01',
      channel: 'VA_BTN',
      amount: '1320000',
    },
  },
];

export function demoIntegrationBase(): Omit<IntegrationOverview, 'interfaces'> {
  return {
    asOf: DEMO_NOW,
    replicationLagSeconds: 2,
    deadLetters: [...DEAD_LETTERS],
    fhirCompliance: [
      { resource: 'Encounter', percent: 98 },
      { resource: 'Condition', percent: 96 },
      { resource: 'Observation', percent: 93 },
      { resource: 'Procedure', percent: 97 },
      { resource: 'MedicationRequest', percent: 89 },
      { resource: 'Composition (resume)', percent: 99 },
    ],
    credentials: [
      { id: 'ss', label: 'Client secret SATUSEHAT', status: 'aman', detail: 'berlaku 214 hari' },
      { id: 'bpjs', label: 'Cons ID / secret BPJS', status: 'aman', detail: 'aktif' },
      { id: 'tte', label: 'Sertifikat TTE', status: 'perhatian', detail: 'habis 23 hari' },
      { id: 'tpdi', label: 'Secret webhook TPDI', status: 'aman', detail: 'dirotasi 12 Sep' },
      { id: 'btn', label: 'Sertifikat mTLS H2H BTN', status: 'aman', detail: 'berlaku 180 hari' },
      { id: 'tls', label: 'TLS domain publik', status: 'aman', detail: 'auto-renew 61 hari' },
    ],
    backups: [
      { id: 'edge', label: 'Lokal server edge', detail: '10.00 · berhasil' },
      { id: 'cloud', label: 'Cloud region Jakarta', detail: '10.00 · berhasil' },
      { id: 'offsite', label: 'Offsite terenkripsi', detail: '02.00 · berhasil · uji restore 28 Sep' },
    ],
  };
}

// ─── B01 · Logistik ─────────────────────────────────────────────────────────────────────────────────────────

/** Item stok sebelum ROP/hari-cukup dihitung (`lib/manajemen.ts`). Pemasok = nama generik fiktif. */
export type InventoryBase = Omit<InventoryItem, 'reorderPoint' | 'daysOfCover'>;

const lot = (batch: string, days: number, qty: number) => ({
  batch,
  expiry: shiftDate(DEMO_TODAY, days),
  qty,
});

export const INVENTORY: readonly InventoryBase[] = [
  {
    id: 'enoksaparin-60',
    name: 'Enoksaparin 60 mg/0,6 mL',
    kind: 'obat',
    kfa: '93002210',
    note: 'High alert · Fornas',
    highAlert: true,
    abc: 'A',
    ven: 'V',
    unit: 'spuit',
    stock: 46,
    avgDailyUse: 11.5,
    leadTimeDays: 7,
    safetyStock: 40,
    suggestedQty: 300,
    unitPrice: '138000',
    channel: 'po-darurat',
    supplier: 'Distributor farmasi A',
    lots: [lot('ENX2603A', 212, 46)],
  },
  {
    id: 'seftriakson-1g',
    name: 'Seftriakson 1 g inj',
    kind: 'obat',
    kfa: null,
    note: 'Fornas',
    highAlert: false,
    abc: 'A',
    ven: 'V',
    unit: 'vial',
    stock: 310,
    avgDailyUse: 52,
    leadTimeDays: 6,
    safetyStock: 90,
    suggestedQty: 1_500,
    unitPrice: '9800',
    channel: 'e-katalog',
    supplier: 'Penyedia e-katalog',
    lots: [lot('CFX2511', 150, 110), lot('CFX2602', 268, 200)],
  },
  {
    id: 'infus-rl-500',
    name: 'Infus RL 500 mL',
    kind: 'cairan',
    kfa: null,
    note: 'Cairan · Fornas',
    highAlert: false,
    abc: 'A',
    ven: 'V',
    unit: 'flakon',
    stock: 820,
    avgDailyUse: 100,
    leadTimeDays: 6,
    safetyStock: 300,
    suggestedQty: 3_000,
    unitPrice: '8500',
    channel: 'e-katalog',
    supplier: 'Penyedia e-katalog',
    lots: [lot('RL2604', 330, 820)],
  },
  {
    id: 'kateter-iv-20g',
    name: 'Kateter IV 20G',
    kind: 'bhp',
    kfa: null,
    note: 'BHP',
    highAlert: false,
    abc: 'B',
    ven: 'E',
    unit: 'pcs',
    stock: 540,
    avgDailyUse: 60,
    leadTimeDays: 7,
    safetyStock: 180,
    suggestedQty: 2_000,
    unitPrice: '6500',
    channel: 'po-distributor',
    supplier: 'Distributor alkes B',
    lots: [lot('IV20-2708', 640, 540)],
  },
  {
    id: 'insulin-glargine',
    name: 'Insulin glargine pen',
    kind: 'obat',
    kfa: null,
    note: 'Rantai dingin 2–8 °C',
    highAlert: true,
    abc: 'A',
    ven: 'V',
    unit: 'pen',
    stock: 38,
    avgDailyUse: 4,
    leadTimeDays: 7,
    safetyStock: 12,
    suggestedQty: 120,
    unitPrice: '182000',
    channel: 'e-katalog',
    supplier: 'Penyedia e-katalog',
    lots: [lot('GLA2604', 175, 38)],
  },
  {
    id: 'kasa-steril',
    name: 'Kasa steril 16×16',
    kind: 'bhp',
    kfa: null,
    note: 'BHP kamar operasi',
    highAlert: false,
    abc: 'C',
    ven: 'E',
    unit: 'lembar',
    stock: 1_900,
    avgDailyUse: 190,
    leadTimeDays: 5,
    safetyStock: 1_050,
    suggestedQty: 6_000,
    unitPrice: '1200',
    channel: 'po-distributor',
    supplier: 'Distributor alkes B',
    lots: [lot('KS2802', 870, 1_900)],
  },
  {
    id: 'benang-pga',
    name: 'Benang PGA 2-0',
    kind: 'bhp',
    kfa: null,
    note: 'BHP kamar operasi',
    highAlert: false,
    abc: 'B',
    ven: 'E',
    unit: 'sachet',
    stock: 64,
    avgDailyUse: 5.8,
    leadTimeDays: 10,
    safetyStock: 12,
    suggestedQty: 200,
    unitPrice: '42000',
    channel: 'po-distributor',
    supplier: 'Distributor alkes B',
    lots: [lot('PGA2709', 720, 64)],
  },
  {
    id: 'reagen-hba1c',
    name: 'Reagen HbA1c',
    kind: 'reagen',
    kfa: null,
    note: 'Lab · analyzer kimia klinik',
    highAlert: false,
    abc: 'A',
    ven: 'E',
    unit: 'kit',
    stock: 2,
    avgDailyUse: 0.16,
    leadTimeDays: 7,
    safetyStock: 0,
    suggestedQty: 4,
    unitPrice: '3250000',
    channel: 'kso',
    supplier: 'Mitra KSO reagen',
    lots: [lot('HBA-2603', 160, 2)],
  },
  {
    id: 'parasetamol-infus',
    name: 'Parasetamol infus 1 g/100 mL',
    kind: 'obat',
    kfa: null,
    note: 'Fornas',
    highAlert: false,
    abc: 'B',
    ven: 'V',
    unit: 'flakon',
    stock: 180,
    avgDailyUse: 15,
    leadTimeDays: 6,
    safetyStock: 110,
    suggestedQty: 600,
    unitPrice: '21000',
    channel: 'e-katalog',
    supplier: 'Penyedia e-katalog',
    lots: [lot('PCT2512', 95, 60), lot('PCT2605', 240, 120)],
  },
  {
    id: 'omeprazol-40-inj',
    name: 'Omeprazol 40 mg inj',
    kind: 'obat',
    kfa: '93001152',
    note: 'Fornas',
    highAlert: false,
    abc: 'B',
    ven: 'E',
    unit: 'vial',
    stock: 150,
    avgDailyUse: 11.5,
    leadTimeDays: 6,
    safetyStock: 91,
    suggestedQty: 500,
    unitPrice: '14500',
    channel: 'e-katalog',
    supplier: 'Penyedia e-katalog',
    lots: [lot('OMZ2602', 140, 150)],
  },
  {
    id: 'spuit-3ml',
    name: 'Spuit 3 mL',
    kind: 'bhp',
    kfa: null,
    note: 'BHP',
    highAlert: false,
    abc: 'C',
    ven: 'E',
    unit: 'pcs',
    stock: 2_400,
    avgDailyUse: 180,
    leadTimeDays: 5,
    safetyStock: 1_600,
    suggestedQty: 8_000,
    unitPrice: '1100',
    channel: 'po-distributor',
    supplier: 'Distributor alkes B',
    lots: [lot('SP3-2810', 900, 2_400)],
  },
  {
    id: 'sarung-tangan-steril',
    name: 'Sarung tangan steril 7,5',
    kind: 'bhp',
    kfa: null,
    note: 'BHP kamar operasi',
    highAlert: false,
    abc: 'C',
    ven: 'E',
    unit: 'pasang',
    stock: 410,
    avgDailyUse: 29,
    leadTimeDays: 7,
    safetyStock: 247,
    suggestedQty: 1_500,
    unitPrice: '4800',
    channel: 'po-distributor',
    supplier: 'Distributor alkes B',
    lots: [lot('GLV2711', 760, 410)],
  },
];

/** Batch dengan kedaluwarsa ≤ 90 hari (FEFO). Nilai total = Rp 38,2 jt. */
export const EXPIRING: readonly ExpiryAlert[] = [
  {
    id: 'ed-albumin',
    itemName: 'Albumin 20% 100 mL',
    batch: 'ALB2511',
    qty: 14,
    unit: 'vial',
    expiry: shiftDate(DEMO_TODAY, 28),
    value: '16100000',
    suggestion: 'Usul pindah ke depo ICU (pemakaian tertinggi)',
    moveTo: 'depo ICU',
  },
  {
    id: 'ed-meropenem',
    itemName: 'Meropenem 1 g',
    batch: 'MRP2511',
    qty: 60,
    unit: 'vial',
    expiry: shiftDate(DEMO_TODAY, 45),
    value: '8700000',
    suggestion: 'Retur ke distributor sesuai kontrak',
    moveTo: 'depo ICU',
  },
  {
    id: 'ed-vaksin-hb',
    itemName: 'Vaksin hepatitis B',
    batch: 'HBV2512',
    qty: 30,
    unit: 'vial',
    expiry: shiftDate(DEMO_TODAY, 62),
    value: '2940000',
    suggestion: 'Prioritaskan untuk skrining karyawan',
    moveTo: 'klinik karyawan',
  },
  {
    id: 'ed-troponin',
    itemName: 'Reagen troponin I',
    batch: 'TRP2512',
    qty: 1,
    unit: 'kit',
    expiry: shiftDate(DEMO_TODAY, 81),
    value: '10460000',
    suggestion: 'Pemakaian cukup sebelum kedaluwarsa',
    moveTo: 'depo IGD',
  },
];

export const PURCHASE_ORDERS: readonly PurchaseOrder[] = [
  {
    id: 'PO-2610-031',
    title: 'Enoksaparin (PO darurat)',
    total: '41400000',
    stage: 1,
    statusText: 'Menunggu persetujuan direktur',
  },
  {
    id: 'PO-2610-028',
    title: 'Cairan infus',
    total: '96000000',
    stage: 4,
    statusText: 'Dalam pengiriman · tiba 5 Okt',
  },
  {
    id: 'PO-2610-024',
    title: 'BHP kamar operasi',
    total: '22700000',
    stage: 3,
    statusText: 'PO terkirim ke pemasok',
  },
  {
    id: 'PO-2609-117',
    title: 'Reagen kimia klinik',
    total: '63200000',
    stage: 5,
    statusText: 'Diterima · cek suhu dan batch lolos',
  },
];

export const LOGISTICS_KPI: LogisticsOverview['kpi'] = {
  inventoryValue: '4820000000',
  activeSku: 3_416,
  turnoverPerYear: 8.4,
  turnoverTarget: 8,
  stockoutsThisMonth: 3,
  stockoutsVital: 2,
  opnameAccuracy: 98.7,
  opnameDate: '2026-09-30',
  leadTimeDays: 4.2,
  leadTimeEkatalogDays: 6.1,
};

// ─── B06 · Mutu dan keselamatan pasien ──────────────────────────────────────────────────────────────────────

export const QUALITY_MONTHS = ['Mei', 'Jun', 'Jul', 'Agu', 'Sep', 'Okt'] as const;

/** Lima bulan sebelum Oktober untuk 6 indikator yang juga tampil di Dasbor direksi (nilai Okt = Dasbor). */
export const DASHBOARD_INDICATOR_HISTORY: Record<string, { pic: string; history: number[] }> = {
  'kebersihan-tangan': { pic: 'Komite PPI', history: [82, 84, 85, 86, 87] },
  identifikasi: { pic: 'Komite keperawatan', history: [95, 96, 98, 96, 97] },
  'sc-emergensi': { pic: 'KSM Obstetri', history: [86, 88, 85, 90, 89] },
  'clinical-pathway': { pic: 'Komite medik', history: [71, 73, 75, 78, 77] },
  'nilai-kritis': { pic: 'Instalasi laboratorium', history: [97, 98, 100, 100, 100] },
  'cegah-jatuh': { pic: 'Komite keperawatan', history: [90, 92, 91, 94, 92] },
};

/** Indikator tambahan (INM lain + indikator mutu prioritas RS). Titik terakhir tren = nilai. */
export const EXTRA_INDICATORS: readonly QualityIndicator[] = [
  {
    id: 'apd',
    label: 'Kepatuhan penggunaan APD',
    group: 'inm',
    value: 96,
    target: { min: 100, label: '100%' },
    trend: [92, 93, 95, 94, 95, 96],
    pic: 'Komite PPI',
  },
  {
    id: 'tunggu-rj',
    label: 'Kepatuhan waktu tunggu rawat jalan ≤ 60 menit',
    group: 'inm',
    value: 82,
    target: { min: 80, label: '≥ 80%' },
    trend: [68, 71, 74, 77, 79, 82],
    pic: 'Instalasi rawat jalan',
  },
  {
    id: 'tunda-operasi',
    label: 'Penundaan operasi elektif',
    group: 'inm',
    value: 3.8,
    target: { max: 5, label: '≤ 5%' },
    trend: [6.4, 5.9, 5.2, 4.6, 4.1, 3.8],
    pic: 'Instalasi bedah sentral',
  },
  {
    id: 'visite',
    label: 'Kepatuhan waktu visite dokter',
    group: 'inm',
    value: 84,
    target: { min: 80, label: '≥ 80%' },
    trend: [78, 80, 79, 82, 83, 84],
    pic: 'Komite medik',
  },
  {
    id: 'fornas',
    label: 'Kepatuhan penggunaan formularium nasional',
    group: 'inm',
    value: 92,
    target: { min: 80, label: '≥ 80%' },
    trend: [88, 89, 90, 91, 91, 92],
    pic: 'Komite farmasi dan terapi',
  },
  {
    id: 'komplain',
    label: 'Kecepatan waktu tanggap komplain',
    group: 'inm',
    value: 87,
    target: { min: 80, label: '≥ 80%' },
    trend: [81, 83, 80, 84, 86, 87],
    pic: 'Unit pengaduan',
  },
  {
    id: 'kepuasan',
    label: 'Kepuasan pasien',
    group: 'inm',
    value: 86,
    target: { min: 80, label: '≥ 80%' },
    trend: [81, 82, 83, 83, 84, 86],
    pic: 'Bagian pemasaran',
  },
  {
    id: 'resume-24j',
    label: 'Resume medis final ≤ 1×24 jam pasca-pulang',
    group: 'imp-rs',
    value: 88,
    target: { min: 90, label: '≥ 90%' },
    trend: [79, 81, 84, 86, 87, 88],
    pic: 'Komite rekam medis',
  },
  {
    id: 'lapor-ikp',
    label: 'Pelaporan IKP ≤ 2×24 jam',
    group: 'imp-rs',
    value: 93,
    target: { min: 90, label: '≥ 90%' },
    trend: [85, 88, 90, 89, 92, 93],
    pic: 'Tim keselamatan pasien',
  },
];

const tsOn = (date: string, hhmm: string) => `${date}T${hhmm}:00+07:00`;

/** Laporan IKP (fiktif). Hanya nomor RM — nama pasien tidak pernah tampil di laporan mutu. */
export const INCIDENTS: readonly IncidentReport[] = [
  {
    id: 'IKP-2610-014',
    reportedAt: tsOn(DEMO_TODAY, '06:20'),
    type: 'KTD',
    grade: 'kuning',
    unit: 'Bangsal Melati',
    patientRm: '00-07-61-33',
    summary: 'Pasien jatuh saat ke kamar mandi tanpa pendamping; lecet ringan, CT kepala normal.',
    investigation: 'rca',
    dueDate: shiftDate(DEMO_TODAY, 45),
    owner: 'Tim keselamatan pasien',
  },
  {
    id: 'IKP-2610-013',
    reportedAt: tsOn('2026-10-04', '21:10'),
    type: 'KNC',
    grade: 'hijau',
    unit: 'Farmasi rawat inap',
    patientRm: '00-27-63-15',
    summary:
      'Dosis antikoagulan belum disesuaikan fungsi ginjal; tertahan CDS dosis ginjal sebelum diberikan.',
    investigation: 'investigasi-sederhana',
    dueDate: shiftDate('2026-10-04', 14),
    owner: 'Kepala instalasi farmasi',
  },
  {
    id: 'IKP-2610-012',
    reportedAt: tsOn('2026-10-04', '10:05'),
    type: 'KTC',
    grade: 'biru',
    unit: 'Laboratorium',
    patientRm: '00-33-18-62',
    summary: 'Label tabung sampel tertukar; terdeteksi delta check, sampel diambil ulang tanpa cedera.',
    investigation: 'investigasi-sederhana',
    dueDate: shiftDate('2026-10-04', 7),
    owner: 'Kepala instalasi laboratorium',
  },
  {
    id: 'IKP-2610-011',
    reportedAt: tsOn('2026-10-03', '14:30'),
    type: 'KPC',
    grade: 'biru',
    unit: 'Kamar operasi',
    patientRm: null,
    summary: 'Suhu lemari obat depo OK 9 °C selama 2 jam; stok dipindah, teknisi memperbaiki termostat.',
    investigation: 'selesai',
    dueDate: shiftDate('2026-10-03', 7),
    owner: 'Kepala kamar operasi',
  },
  {
    id: 'IKP-2610-010',
    reportedAt: tsOn('2026-10-02', '08:40'),
    type: 'KTD',
    grade: 'hijau',
    unit: 'ICU',
    patientRm: '00-24-66-81',
    summary: 'Flebitis derajat 2 pada akses IV hari ke-4; kateter dilepas dan dirawat sesuai bundle.',
    investigation: 'investigasi-sederhana',
    dueDate: shiftDate('2026-10-02', 14),
    owner: 'Komite PPI',
  },
  {
    id: 'IKP-2609-031',
    reportedAt: tsOn('2026-09-28', '03:15'),
    type: 'KTD',
    grade: 'merah',
    unit: 'Bangsal Anggrek',
    patientRm: '00-24-66-81',
    summary: 'Pemindahan ke ICU terlambat; skor peringatan dini tidak dihitung ulang selama 6 jam.',
    investigation: 'rca',
    dueDate: shiftDate('2026-09-28', 45),
    owner: 'Tim keselamatan pasien · direksi',
  },
  {
    id: 'IKP-2609-029',
    reportedAt: tsOn('2026-09-25', '11:20'),
    type: 'KNC',
    grade: 'biru',
    unit: 'Poli Penyakit Dalam',
    patientRm: '00-12-45-78',
    summary: 'Resep antihipertensi ganda dari dua dokter; ditahan saat telaah apoteker.',
    investigation: 'selesai',
    dueDate: shiftDate('2026-09-25', 7),
    owner: 'Kepala instalasi rawat jalan',
  },
  {
    id: 'IKP-2609-027',
    reportedAt: tsOn('2026-09-17', '16:45'),
    type: 'KTD',
    grade: 'kuning',
    unit: 'Bangsal Melati',
    patientRm: '00-14-82-59',
    summary: 'Ruam setelah antibiotik golongan penisilin; riwayat alergi belum tercatat saat order.',
    investigation: 'rca',
    dueDate: shiftDate('2026-09-17', 45),
    owner: 'Tim keselamatan pasien',
  },
];

/** Register risiko (skor = kemungkinan × dampak; tingkat dihitung `riskLevel`). */
export const RISKS: readonly RiskEntry[] = [
  {
    id: 'RR-01',
    title: 'Kekosongan obat vital (antikoagulan)',
    category: 'operasional',
    unit: 'Logistik farmasi',
    likelihood: 4,
    impact: 4,
    mitigation: 'PO darurat, buffer stok VEN-V, pemasok kedua',
    owner: 'Kepala instalasi farmasi',
    trend: 'naik',
  },
  {
    id: 'RR-02',
    title: 'Pasien jatuh di rawat inap',
    category: 'klinis',
    unit: 'Keperawatan',
    likelihood: 4,
    impact: 3,
    mitigation: 'Asesmen risiko jatuh tiap shift, gelang kuning, bel dalam jangkauan',
    owner: 'Komite keperawatan',
    trend: 'turun',
  },
  {
    id: 'RR-03',
    title: 'Kesalahan pemberian obat high alert',
    category: 'klinis',
    unit: 'Farmasi dan keperawatan',
    likelihood: 3,
    impact: 4,
    mitigation: 'Double check independen, CDS dosis ginjal, pindai gelang eMAR',
    owner: 'Komite farmasi dan terapi',
    trend: 'tetap',
  },
  {
    id: 'RR-04',
    title: 'Klaim JKN tertunda lebih dari 30 hari',
    category: 'keuangan',
    unit: 'Casemix',
    likelihood: 4,
    impact: 3,
    mitigation: 'Resume final ≤ 24 jam, koder pendamping di ruang rawat',
    owner: 'Kepala casemix',
    trend: 'tetap',
  },
  {
    id: 'RR-05',
    title: 'Kebocoran data pasien',
    category: 'teknologi',
    unit: 'Instalasi TI',
    likelihood: 2,
    impact: 5,
    mitigation: 'MFA, audit akses, akses darurat beralasan dan bernotifikasi',
    owner: 'Petugas privasi',
    trend: 'tetap',
  },
  {
    id: 'RR-06',
    title: 'Gangguan koneksi PACS / SATUSEHAT',
    category: 'teknologi',
    unit: 'Instalasi TI',
    likelihood: 3,
    impact: 3,
    mitigation: 'Antrean lokal dan DLQ, uji mode downtime bulanan',
    owner: 'Admin integrasi',
    trend: 'naik',
  },
  {
    id: 'RR-07',
    title: 'Infeksi aliran darah terkait kateter',
    category: 'klinis',
    unit: 'ICU',
    likelihood: 2,
    impact: 4,
    mitigation: 'Bundle insersi dan perawatan kateter, audit harian',
    owner: 'Komite PPI',
    trend: 'turun',
  },
  {
    id: 'RR-08',
    title: 'Kebakaran ruang server atau genset',
    category: 'fasilitas',
    unit: 'IPSRS',
    likelihood: 1,
    impact: 5,
    mitigation: 'APAR gas, uji genset mingguan, simulasi evakuasi',
    owner: 'Kepala IPSRS',
    trend: 'tetap',
  },
  {
    id: 'RR-09',
    title: 'Waktu tunggu rawat jalan lebih dari 60 menit',
    category: 'operasional',
    unit: 'Rawat jalan',
    likelihood: 3,
    impact: 2,
    mitigation: 'Booking daring, check-in anjungan, kuota per jam praktik',
    owner: 'Kepala instalasi rawat jalan',
    trend: 'turun',
  },
];

// ─── I07 · Aplikasi pasien (Tn. Suryo, skenario rawat jalan) ───────────────────────────────────────────────

/** Kode booking aplikasi Tn. Suryo (naskah skenario rawat jalan, tugas kedatangan.scan). */
export const SURYO_BOOKING = '2610050117';

/** Gula darah mandiri 7 hari terakhir (mg/dL), pita target dokter 80–130. */
export const SURYO_GLUCOSE: PatientAppHome['glucose'] = [182, 171, 165, 168, 154, 149, 146].map(
  (value, i) => ({
    date: shiftDate(DEMO_TODAY, i - 6),
    value,
  }),
);
export const GLUCOSE_TARGET = { min: 80, max: 130 } as const;

/** Pemetaan hasil lab skenario (awalan teks rekam medis) → nama tampilan, rujukan, dan LOINC seed. */
export const LAB_DISPLAY: ReadonlyArray<{
  prefix: string;
  id: string;
  name: string;
  reference: string;
  loinc: string | null;
}> = [
  { prefix: 'HbA1c', id: 'hba1c', name: 'HbA1c', reference: 'Target di bawah 7%', loinc: '4548-4' },
  {
    prefix: 'LDL',
    id: 'ldl',
    name: 'Kolesterol LDL',
    reference: 'Target di bawah 100 mg/dL',
    loinc: '13457-7',
  },
  {
    prefix: 'Kreatinin',
    id: 'kreatinin',
    name: 'Kreatinin',
    reference: 'Rujukan 0,7–1,3 mg/dL',
    loinc: '2160-0',
  },
];

/** Aturan pakai ramah pasien per obat skenario (awalan nama obat). */
export const MEDICINE_ADVICE: ReadonlyArray<{ prefix: string; advice: string }> = [
  { prefix: 'Metformin', advice: 'sesudah makan pagi dan malam' },
  { prefix: 'Glimepirid', advice: 'pagi, sebelum sarapan' },
  { prefix: 'Atorvastatin', advice: 'malam sebelum tidur' },
];

// ─── I08 · Aplikasi dokter ──────────────────────────────────────────────────────────────────────────────────

/** Pasien rawat dokter konsulen penyakit dalam selain Tn. Hartono (identitas dari `PASIEN`). */
export const DOCTOR_PATIENTS: ReadonlyArray<
  Omit<DoctorAppInbox['patients'][number], 'name' | 'age' | 'rm'> & { patientId: string }
> = [
  {
    id: DOCTOR_APP_PATIENT_ID.endang,
    patientId: PATIENT_ID.endang,
    location: 'Melati M-203',
    note: 'Pulang hari ini 13.00 · resume menunggu TTE',
    ews: 0,
    level: 'rendah',
    hospitalDay: 'H5',
    details: [
      { label: 'Diagnosis', value: 'Pneumonia komunitas · DM tipe 2' },
      { label: 'Alergi', value: 'Amoksisilin' },
      { label: 'GDS pagi', value: '188 mg/dL' },
      { label: 'Rencana', value: 'Pulang hari ini 13.00 · edukasi insulin, kontrol 14 Okt' },
    ],
  },
  {
    id: DOCTOR_APP_PATIENT_ID.yusuf,
    patientId: PATIENT_ID.yusuf,
    location: 'Anggrek A-15',
    note: 'Kalium kritis 6,4 (10.39) · kateter HD 13.00',
    ews: 2,
    level: 'sedang',
    hospitalDay: 'H3',
    details: [
      { label: 'Diagnosis', value: 'CKD stadium 5 · hemodialisis rutin' },
      { label: 'Kalium', value: '6,4 mmol/L · kritis 10.39 (pagi 5,4)' },
      { label: 'Telaah apoteker', value: 'Dosis antikoagulan perlu penyesuaian fungsi ginjal' },
      { label: 'Rencana', value: 'Kateter HD sementara di OK 1 pukul 13.00, lalu hemodialisis' },
    ],
  },
  {
    id: DOCTOR_APP_PATIENT_ID.aminah,
    patientId: PATIENT_ID.aminah,
    location: 'ICU 7',
    note: 'Syok septik · norepinefrin titrasi',
    ews: 5,
    level: 'tinggi',
    hospitalDay: 'H2',
    details: [
      { label: 'Diagnosis', value: 'Sepsis · syok septik (ICU hari ke-2)' },
      { label: 'Alergi', value: 'Kotrimoksazol (sulfa)' },
      { label: 'Hemodinamik', value: 'Norepinefrin titrasi, target MAP ≥ 65 mmHg' },
      { label: 'Mikrobiologi', value: 'Kultur darah dalam inkubasi (laporan H+1)' },
    ],
  },
  {
    id: DOCTOR_APP_PATIENT_ID.sutan,
    patientId: PATIENT_ID.sutan,
    location: 'Paviliun VIP 2',
    note: 'Konsul PD: eGFR 42 sebelum angiografi 13.00',
    ews: 1,
    level: 'rendah',
    hospitalDay: 'H2',
    details: [
      { label: 'Diagnosis', value: 'Angina tidak stabil · hipertensi' },
      { label: 'Fungsi ginjal', value: 'eGFR 42 mL/menit/1,73 m²' },
      { label: 'Rencana', value: 'Hidrasi NaCl 0,9% pra-kontras; kreatinin ulang 48 jam' },
    ],
  },
];

export const COSIGN_NOTES: DoctorAppInbox['cosign'] = [
  {
    id: COSIGN_NOTE_ID.endang,
    resident: `${PERSONA.dokterResiden} (PPDS PD)`,
    patientName: 'Ny. Endang Wijaya',
    rm: '00-07-61-33',
    time: '07.40',
    soap: 'A: pneumonia membaik, GDS terkontrol. P: pulang hari ini setelah resume ditandatangani, ganti antibiotik oral.',
  },
  {
    id: COSIGN_NOTE_ID.yusuf,
    resident: 'dr. Galang Prasetyo (PPDS PD)',
    patientName: 'Tn. Yusuf Hidayat',
    rm: '00-27-63-15',
    time: '08.15',
    soap: 'A: CKD st. 5, kalium 5,4. P: ikuti usulan apoteker, sesuaikan dosis antikoagulan; HD Rabu.',
  },
  {
    id: COSIGN_NOTE_ID.aminah,
    resident: `${PERSONA.dokterResiden} (PPDS PD)`,
    patientName: 'Ny. Siti Aminah',
    rm: '00-22-08-14',
    time: '09.05',
    soap: 'A: syok septik, laktat turun, MAP ≥ 65 dengan norepinefrin dosis turun. P: lanjut meropenem, tunggu kultur darah.',
  },
];

export const DOCTOR_SCHEDULE: DoctorAppInbox['schedule'] = [
  { id: 'visite', title: 'Visite rawat inap', detail: 'Anggrek, Melati, ICU', time: '07.30' },
  {
    id: 'konsulen',
    title: 'Jaga konsulen IGD',
    detail: 'Konsultasi lewat aplikasi dan telepon',
    time: '07.00–21.00',
  },
  {
    id: 'poli',
    title: 'Poli Penyakit Dalam',
    detail: 'Rawat jalan · kuota BPJS dan umum',
    time: '13.00–16.00',
  },
  { id: 'komite', title: 'Rapat komite medik', detail: 'Ruang rapat lantai 3', time: 'Kamis 14.00' },
];

// ─── Perakit tampilan (dipakai modul data; diuji lewat skema ketat) ────────────────────────────────────────

/** Integration hub: volume hari ini = basis fixture + jumlah pesan keluar dari jejak skenario. */
export function demoIntegrationOverview(logs: Iterable<Pick<LogEntry, 'sys' | 'text'>>): IntegrationOverview {
  const extra = countInterfaceLogs(logs);
  return {
    ...demoIntegrationBase(),
    interfaces: INTERFACES.map((i) => ({
      ...i,
      hourly: [...i.hourly],
      errorHours: [...i.errorHours],
      volumeToday: i.volumeToday + extra[i.id],
      scenarioVolume: extra[i.id],
    })),
  };
}

/** Logistik: ROP dan hari cukup dihitung dari pemakaian, item urut hari cukup terpendek. */
export function demoLogisticsOverview(): LogisticsOverview {
  const reorder = INVENTORY.map((i) => ({
    ...i,
    lots: i.lots.map((l) => ({ ...l })),
    reorderPoint: reorderPoint(i),
    daysOfCover: daysOfCover(i.stock, i.avgDailyUse),
  })).sort((a, b) => a.daysOfCover - b.daysOfCover);
  return {
    asOf: DEMO_NOW,
    kpi: { ...LOGISTICS_KPI },
    reorder,
    expiring: EXPIRING.map((e) => ({ ...e })),
    purchaseOrders: PURCHASE_ORDERS.map((p) => ({ ...p })),
    nextPoNumber: 'PO-2610-032',
  };
}

/** Mutu: 6 indikator pertama = indikator Dasbor direksi (nilai sama), lalu INM lain dan IMP-RS. */
export function demoQualityOverview(): QualityOverview {
  const fromDashboard: QualityIndicator[] = demoExecutiveDashboard('bulan').quality.map((q) => {
    const h = DASHBOARD_INDICATOR_HISTORY[q.id];
    return {
      id: q.id,
      label: q.label,
      group: 'inm',
      value: q.value,
      target: { min: q.target.min, label: q.target.label },
      trend: [...(h?.history ?? [q.value, q.value, q.value, q.value, q.value]), q.value],
      pic: h?.pic ?? 'Komite mutu',
    };
  });
  return {
    asOf: DEMO_NOW,
    months: [...QUALITY_MONTHS],
    indicators: [
      ...fromDashboard,
      ...EXTRA_INDICATORS.map((q) => ({ ...q, target: { ...q.target }, trend: [...q.trend] })),
    ],
    incidents: INCIDENTS.map((i) => ({ ...i })),
    risks: RISKS.map((r) => ({ ...r })),
  };
}
