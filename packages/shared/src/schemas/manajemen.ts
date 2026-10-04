import { z } from 'zod';

/**
 * B01/B06/I01–I08 · Logistik, mutu, integrasi, aplikasi pasien/dokter.
 * Kontrak respons (zod) yang dipenuhi data dummy mode presentasi sekarang (ADR-0023) dan API kelak. Diisi
 * bersama layar domain ini; nama mengikuti entitas docs/04, camelCase, uang = string rupiah, waktu ISO 8601.
 */

const isoDate = z.iso.date();
const isoDateTime = z.iso.datetime({ offset: true });
/** Rupiah bulat sebagai string (bigint tidak didukung JSON). */
const rupiahString = z.string().regex(/^-?\d{1,18}$/);
/** Kode KFA 8 digit; null = belum dipetakan (tampil "KFA belum dipetakan"). */
const kfaCode = z
  .string()
  .regex(/^\d{8}$/)
  .nullable();
/** Nomor rekam medis `00-28-44-17`. */
const rmNumber = z.string().regex(/^\d{2}-\d{2}-\d{2}-\d{2}$/);

// ─── I01–I06 · Integration hub ──────────────────────────────────────────────────────────────────────────────

export const INTERFACE_IDS = [
  'satusehat',
  'bpjs-vclaim',
  'bpjs-antrean',
  'eklaim',
  'lis',
  'pacs',
  'tpdi',
  'btn-h2h',
  'notifikasi',
] as const;
export type InterfaceId = (typeof INTERFACE_IDS)[number];

export const INTERFACE_STATUSES = ['normal', 'lambat', 'gangguan'] as const;
export type InterfaceStatus = (typeof INTERFACE_STATUSES)[number];

export const interfaceCardSchema = z.strictObject({
  id: z.enum(INTERFACE_IDS),
  name: z.string().min(1),
  protocol: z.string().min(1),
  status: z.enum(INTERFACE_STATUSES),
  /** Sistem di luar RS: pesannya tertahan di antrean lokal saat uji downtime server edge. */
  external: z.boolean(),
  /** Pesan hari ini sejak 00.00, sudah termasuk pesan dari jejak skenario presentasi. */
  volumeToday: z.number().int().min(0),
  /** Bagian `volumeToday` yang berasal dari jejak skenario Simulasi. */
  scenarioVolume: z.number().int().min(0),
  /** Pesan yang gagal hari ini (masih di dead-letter queue). */
  failedToday: z.number().int().min(0),
  /** Latensi p95 (milidetik); null = tidak terukur karena koneksi gagal. */
  p95Ms: z.number().int().min(0).nullable(),
  /** Volume per jam, 24 jam terakhir (indeks 23 = jam berjalan). */
  hourly: z.array(z.number().int().min(0)).length(24),
  /** Indeks jam (0–23, sama dengan `hourly`) yang mencatat galat. */
  errorHours: z.array(z.number().int().min(0).max(23)),
});
export type InterfaceCard = z.infer<typeof interfaceCardSchema>;

/** Kunci payload ringkas: hanya pengenal teknis, tanpa nama/NIK/isi klinis. */
const payloadKey = z.string().regex(/^[a-z][A-Za-z0-9]{1,30}$/);

export const dlqMessageSchema = z.strictObject({
  id: z.string().regex(/^dlq-\d{3,6}$/),
  at: isoDateTime,
  target: z.enum(INTERFACE_IDS),
  /** Resource/event, mis. "Encounter", "ORM^O01 · RAD-2610-118". */
  operation: z.string().min(1),
  /** Kode galat stabil, mis. "HTTP 422", "ECONNREFUSED". */
  errorCode: z.string().min(1),
  errorMessage: z.string().min(1),
  attempts: z.number().int().min(1),
  maxAttempts: z.number().int().min(1),
  /** Galat yang menahan layanan klinis (mis. order radiologi tidak sampai ke PACS). */
  critical: z.boolean(),
  /** Baris transport, mis. "POST /fhir/Encounter → 422 Unprocessable Entity". */
  request: z.string().min(1),
  /** Payload ringkas berisi pengenal saja (id kunjungan, nomor order, kunci idempotensi). */
  payload: z.record(payloadKey, z.string().min(1).max(80)),
});
export type DlqMessage = z.infer<typeof dlqMessageSchema>;

export const integrationOverviewSchema = z.strictObject({
  asOf: isoDateTime,
  /** Keterlambatan replikasi server edge → cloud (detik). */
  replicationLagSeconds: z.number().int().min(0),
  interfaces: z.array(interfaceCardSchema).length(INTERFACE_IDS.length),
  deadLetters: z.array(dlqMessageSchema),
  fhirCompliance: z
    .array(z.strictObject({ resource: z.string().min(1), percent: z.number().min(0).max(100) }))
    .min(1),
  credentials: z
    .array(
      z.strictObject({
        id: z.string().min(1),
        label: z.string().min(1),
        status: z.enum(['aman', 'perhatian']),
        detail: z.string().min(1),
      }),
    )
    .min(1),
  backups: z
    .array(z.strictObject({ id: z.string().min(1), label: z.string().min(1), detail: z.string().min(1) }))
    .min(1),
});
export type IntegrationOverview = z.infer<typeof integrationOverviewSchema>;

/** Input Server Action "Kirim ulang" (id pesan dead-letter). */
export const dlqResendInputSchema = z.strictObject({
  ids: z
    .array(z.string().regex(/^dlq-\d{3,6}$/))
    .min(1)
    .max(50),
});

// ─── B01 · Logistik (gudang farmasi dan BHP) ───────────────────────────────────────────────────────────────

export const ABC_CLASSES = ['A', 'B', 'C'] as const;
/** VEN: vital, esensial, non-esensial. */
export const VEN_CLASSES = ['V', 'E', 'N'] as const;
export const ITEM_KINDS = ['obat', 'cairan', 'bhp', 'reagen', 'vaksin'] as const;
export const PROCUREMENT_CHANNELS = ['e-katalog', 'po-distributor', 'kso', 'po-darurat'] as const;
export type ProcurementChannel = (typeof PROCUREMENT_CHANNELS)[number];

export const expiryLotSchema = z.strictObject({
  batch: z.string().min(1),
  expiry: isoDate,
  qty: z.number().int().min(0),
});

export const inventoryItemSchema = z.strictObject({
  id: z.string().min(1),
  name: z.string().min(1),
  kind: z.enum(ITEM_KINDS),
  /** Hanya bermakna untuk obat/cairan/vaksin; null = belum dipetakan. */
  kfa: kfaCode,
  /** Keterangan singkat, mis. "High alert · Fornas", "Rantai dingin 2–8 °C". */
  note: z.string().min(1),
  highAlert: z.boolean(),
  abc: z.enum(ABC_CLASSES),
  ven: z.enum(VEN_CLASSES),
  unit: z.string().min(1),
  stock: z.number().int().min(0),
  /** Pemakaian harian rata-rata 90 hari. */
  avgDailyUse: z.number().positive(),
  leadTimeDays: z.number().int().min(1),
  safetyStock: z.number().int().min(0),
  /** ROP = pemakaian harian × lead time + stok pengaman (dibulatkan ke atas). */
  reorderPoint: z.number().int().min(0),
  /** Stok cukup untuk sekian hari (stok ÷ pemakaian harian, 1 desimal ke bawah). */
  daysOfCover: z.number().min(0),
  suggestedQty: z.number().int().min(1),
  unitPrice: rupiahString,
  channel: z.enum(PROCUREMENT_CHANNELS),
  /** Pemasok fiktif generik. */
  supplier: z.string().min(1),
  /** Batch di gudang, urut FEFO (kedaluwarsa terdekat lebih dulu). */
  lots: z.array(expiryLotSchema).min(1),
});
export type InventoryItem = z.infer<typeof inventoryItemSchema>;

export const expiryAlertSchema = z.strictObject({
  id: z.string().min(1),
  itemName: z.string().min(1),
  batch: z.string().min(1),
  qty: z.number().int().min(1),
  unit: z.string().min(1),
  expiry: isoDate,
  value: rupiahString,
  suggestion: z.string().min(1),
  /** Depo tujuan pemindahan (FEFO ke pemakai terbesar). */
  moveTo: z.string().min(1),
});
export type ExpiryAlert = z.infer<typeof expiryAlertSchema>;

/** Tahap pengadaan: 1 usulan · 2 disetujui · 3 PO / e-katalog · 4 dikirim · 5 diterima dan cek mutu. */
export const purchaseOrderSchema = z.strictObject({
  id: z.string().regex(/^PO-\d{4}-\d{3}$/),
  title: z.string().min(1),
  total: rupiahString,
  stage: z.number().int().min(1).max(5),
  statusText: z.string().min(1),
});
export type PurchaseOrder = z.infer<typeof purchaseOrderSchema>;

export const purchaseOrderLineSchema = z.strictObject({
  itemId: z.string().min(1),
  name: z.string().min(1),
  kfa: kfaCode,
  qty: z.number().int().min(1),
  unit: z.string().min(1),
  unitPrice: rupiahString,
  subtotal: rupiahString,
  channel: z.enum(PROCUREMENT_CHANNELS),
  supplier: z.string().min(1),
});

/** Draf usulan PO dari item terpilih (total = jumlah subtotal baris). */
export const purchaseOrderDraftSchema = z.strictObject({
  number: z.string().regex(/^PO-\d{4}-\d{3}$/),
  lines: z.array(purchaseOrderLineSchema).min(1),
  total: rupiahString,
  urgent: z.boolean(),
});
export type PurchaseOrderDraft = z.infer<typeof purchaseOrderDraftSchema>;

export const logisticsOverviewSchema = z.strictObject({
  asOf: isoDateTime,
  kpi: z.strictObject({
    inventoryValue: rupiahString,
    activeSku: z.number().int().min(0),
    turnoverPerYear: z.number().min(0),
    turnoverTarget: z.number().min(0),
    stockoutsThisMonth: z.number().int().min(0),
    stockoutsVital: z.number().int().min(0),
    opnameAccuracy: z.number().min(0).max(100),
    opnameDate: isoDate,
    leadTimeDays: z.number().min(0),
    leadTimeEkatalogDays: z.number().min(0),
  }),
  /** Item di bawah titik pesan ulang, urut hari cukup terpendek. */
  reorder: z.array(inventoryItemSchema).min(1),
  expiring: z.array(expiryAlertSchema),
  purchaseOrders: z.array(purchaseOrderSchema),
  /** Nomor PO untuk draf baru berikutnya. */
  nextPoNumber: z.string().regex(/^PO-\d{4}-\d{3}$/),
});
export type LogisticsOverview = z.infer<typeof logisticsOverviewSchema>;

/** Input Server Action "Ajukan usulan PO". */
export const poSubmitInputSchema = z.strictObject({
  number: z.string().regex(/^PO-\d{4}-\d{3}$/),
  lines: z
    .array(z.strictObject({ itemId: z.string().min(1).max(40), qty: z.number().int().min(1).max(100_000) }))
    .min(1)
    .max(50),
});

// ─── B06 · Mutu dan keselamatan pasien ─────────────────────────────────────────────────────────────────────

export const QUALITY_GROUPS = ['inm', 'imp-rs'] as const;

export const qualityIndicatorSchema = z.strictObject({
  id: z.string().min(1),
  label: z.string().min(1),
  /** INM = indikator nasional mutu; IMP-RS = indikator mutu prioritas rumah sakit. */
  group: z.enum(QUALITY_GROUPS),
  /** Capaian bulan berjalan (persen 0–100). */
  value: z.number().min(0).max(100),
  /** Sasaran inklusif: `min` (≥) atau `max` (≤). */
  target: z
    .strictObject({
      min: z.number().min(0).max(100).optional(),
      max: z.number().min(0).max(100).optional(),
      label: z.string().min(1),
    })
    .refine((t) => t.min !== undefined || t.max !== undefined, 'Sasaran butuh min atau max'),
  /** Capaian 6 bulan terakhir (Mei–Okt), titik terakhir = `value`. */
  trend: z.array(z.number().min(0).max(100)).length(6),
  /** Penanggung jawab pengumpulan data. */
  pic: z.string().min(1),
});
export type QualityIndicator = z.infer<typeof qualityIndicatorSchema>;

/** Jenis insiden keselamatan pasien (IKP). */
export const INCIDENT_TYPES = ['KTD', 'KNC', 'KTC', 'KPC', 'Sentinel'] as const;
/** Grading matriks risiko IKP: biru (rendah) → merah (ekstrem). */
export const INCIDENT_GRADES = ['biru', 'hijau', 'kuning', 'merah'] as const;
export const INVESTIGATION_STATUSES = ['belum-dimulai', 'investigasi-sederhana', 'rca', 'selesai'] as const;

export const incidentReportSchema = z.strictObject({
  id: z.string().regex(/^IKP-\d{4}-\d{3}$/),
  reportedAt: isoDateTime,
  type: z.enum(INCIDENT_TYPES),
  grade: z.enum(INCIDENT_GRADES),
  unit: z.string().min(1),
  /** Hanya nomor RM (tanpa nama pasien); null untuk kondisi potensial cedera tanpa pasien. */
  patientRm: rmNumber.nullable(),
  summary: z.string().min(1),
  investigation: z.enum(INVESTIGATION_STATUSES),
  /** Batas waktu investigasi (sederhana 7 hari, RCA 45 hari). */
  dueDate: isoDate,
  owner: z.string().min(1),
});
export type IncidentReport = z.infer<typeof incidentReportSchema>;

export const RISK_LEVELS = ['rendah', 'sedang', 'tinggi', 'ekstrem'] as const;
export type RiskLevel = (typeof RISK_LEVELS)[number];

export const riskEntrySchema = z.strictObject({
  id: z.string().regex(/^RR-\d{2}$/),
  title: z.string().min(1),
  category: z.enum(['klinis', 'operasional', 'keuangan', 'teknologi', 'fasilitas']),
  unit: z.string().min(1),
  /** Kemungkinan 1 (sangat jarang) – 5 (hampir pasti). */
  likelihood: z.number().int().min(1).max(5),
  /** Dampak 1 (tidak signifikan) – 5 (katastrofik). */
  impact: z.number().int().min(1).max(5),
  mitigation: z.string().min(1),
  owner: z.string().min(1),
  trend: z.enum(['naik', 'tetap', 'turun']),
});
export type RiskEntry = z.infer<typeof riskEntrySchema>;

export const qualityOverviewSchema = z.strictObject({
  asOf: isoDateTime,
  /** Label bulan tren, 6 titik (mis. "Mei" … "Okt"). */
  months: z.array(z.string().min(1)).length(6),
  indicators: z.array(qualityIndicatorSchema).min(1),
  incidents: z.array(incidentReportSchema),
  risks: z.array(riskEntrySchema).min(1),
});
export type QualityOverview = z.infer<typeof qualityOverviewSchema>;

// ─── I07 · Aplikasi pasien (pratinjau) ─────────────────────────────────────────────────────────────────────

export const PATIENT_QUEUE_STAGES = ['booking', 'admisi', 'poli', 'pulang'] as const;
const feedTone = z.enum(['brand', 'warning', 'info', 'success', 'danger']);

export const patientAppHomeSchema = z.strictObject({
  /** Sapaan, mis. "Pak Suryo". */
  greeting: z.string().min(1),
  initials: z.string().min(1).max(3),
  fullName: z.string().min(1),
  rm: rmNumber,
  payer: z.string().min(1),
  queue: z.strictObject({
    stage: z.enum(PATIENT_QUEUE_STAGES),
    /** Mis. "Poli Penyakit Dalam · Senin 5 Okt". */
    title: z.string().min(1),
    /** "Kode booking" atau "Nomor antrean Anda". */
    numberLabel: z.string().min(1),
    number: z.string().min(1),
    /** Nomor yang sedang dilayani di loket/poli; null bila belum relevan. */
    serving: z.string().min(1).nullable(),
    /** Pasien di depan; null bila belum relevan. */
    ahead: z.number().int().min(0).nullable(),
    location: z.string().min(1),
    message: z.string().min(1),
  }),
  labResults: z.array(
    z.strictObject({
      id: z.string().min(1),
      name: z.string().min(1),
      value: z.string().min(1),
      reference: z.string().min(1),
      flag: z.enum(['normal', 'tinggi', 'rendah']),
      loinc: z
        .string()
        .regex(/^\d{1,6}-\d$/)
        .nullable(),
    }),
  ),
  /** Keterangan status hasil lab (dirilis / belum ada). */
  labStatus: z.string().min(1),
  medicines: z.array(
    z.strictObject({ id: z.string().min(1), name: z.string().min(1), instruction: z.string().min(1) }),
  ),
  medicinesStatus: z.string().min(1),
  controlVisit: z.strictObject({ label: z.string().min(1), date: z.string().min(1) }).nullable(),
  feed: z.array(
    z.strictObject({
      id: z.string().min(1),
      title: z.string().min(1),
      detail: z.string().min(1),
      when: z.string().min(1),
      tone: feedTone,
    }),
  ),
  /** Gula darah mandiri 7 hari terakhir (mg/dL). */
  glucose: z.array(z.strictObject({ date: isoDate, value: z.number().int().min(20).max(600) })).length(7),
  glucoseTarget: z.strictObject({ min: z.number().int(), max: z.number().int() }),
});
export type PatientAppHome = z.infer<typeof patientAppHomeSchema>;

// ─── I08 · Aplikasi dokter (pratinjau) ─────────────────────────────────────────────────────────────────────

export const CRITICAL_VALUE_STATES = [
  'menunggu-hasil',
  'menunggu-laporan',
  'perlu-readback',
  'diterima',
] as const;
export type CriticalValueState = (typeof CRITICAL_VALUE_STATES)[number];
const ewsLevel = z.enum(['tinggi', 'sedang', 'rendah']);

export const doctorAppInboxSchema = z.strictObject({
  doctorName: z.string().min(1),
  doctorRole: z.string().min(1),
  critical: z.strictObject({
    state: z.enum(CRITICAL_VALUE_STATES),
    /** `skenario` = tombol read-back menjalankan tugas skenario igd-ranap; `lokal` = simulasi di layar ini. */
    mode: z.enum(['skenario', 'lokal']),
    /** Indeks langkah skenario bila `mode = skenario`. */
    stepIndex: z.number().int().min(0).nullable(),
    patientName: z.string().min(1),
    rm: rmNumber,
    location: z.string().min(1),
    analyte: z.string().min(1),
    loinc: z.string().regex(/^\d{1,6}-\d$/),
    value: z.string().min(1),
    unit: z.string().min(1),
    reportedBy: z.string().min(1),
    /** Penerima laporan telepon (isian langkah skenario), null bila belum dilaporkan. */
    reportedTo: z.string().min(1).nullable(),
    resultAt: z.string().min(1).nullable(),
    acceptedAt: z.string().min(1).nullable(),
    ecg: z.string().min(1),
  }),
  orderVerifyCount: z.number().int().min(0),
  coderQueryCount: z.number().int().min(0),
  patients: z.array(
    z.strictObject({
      id: z.string().min(1),
      name: z.string().min(1),
      age: z.number().int().min(0),
      rm: rmNumber,
      location: z.string().min(1),
      note: z.string().min(1),
      ews: z.number().int().min(0).max(20),
      level: ewsLevel,
      hospitalDay: z.string().min(1),
      details: z.array(z.strictObject({ label: z.string().min(1), value: z.string().min(1) })),
    }),
  ),
  cosign: z.array(
    z.strictObject({
      id: z.string().min(1),
      resident: z.string().min(1),
      patientName: z.string().min(1),
      rm: rmNumber,
      time: z.string().min(1),
      soap: z.string().min(1),
    }),
  ),
  schedule: z.array(
    z.strictObject({
      id: z.string().min(1),
      title: z.string().min(1),
      detail: z.string().min(1),
      time: z.string().min(1),
    }),
  ),
});
export type DoctorAppInbox = z.infer<typeof doctorAppInboxSchema>;
