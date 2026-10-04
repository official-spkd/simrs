import { z } from 'zod';

/**
 * I05/U04/S06 · Pembayaran digital TPDI × BTN, pembiayaan BTN, kamar operasi.
 * Kontrak respons (zod) yang dipenuhi data dummy mode presentasi sekarang (ADR-0023) dan API kelak. Diisi
 * bersama layar domain ini; nama mengikuti entitas docs/04, camelCase, uang = string rupiah, waktu ISO 8601.
 * Dana pasien tidak transit di TPDI (ADR-0005): rekening tujuan selalu rekening RS di BTN.
 */

/** Rupiah bulat sebagai string (bigint tidak didukung JSON); boleh bertanda untuk penyesuaian. */
const rupiahString = z.string().regex(/^-?\d{1,18}$/);
const isoDateTime = z.iso.datetime({ offset: true });
const isoDate = z.iso.date();
/** Nomor rekening selalu tersamar: `••••4417`. */
const maskedAccount = z.string().regex(/^••••\d{4}$/);
const count = z.number().int().min(0);

export const btnPatientRefSchema = z.strictObject({
  id: z.string().min(1),
  name: z.string().min(1),
  rm: z.string().regex(/^\d{2}-\d{2}-\d{2}-\d{2}$/),
});

// ---------------------------------------------------------------- I05 · transaksi

export const PAYMENT_CHANNELS = ['VA', 'QRIS', 'EDC'] as const;
export type PaymentChannel = (typeof PAYMENT_CHANNELS)[number];

/**
 * Status `payment_intents` (docs/07 §2) dalam bahasa layar: `selisih` = nominal masuk berbeda dari tagihan →
 * pengecualian rekonsiliasi, bukan lunas otomatis. `draf` = tagihan belum dikirim ke TPDI.
 */
export const PAYMENT_STATUSES = [
  'draf',
  'menunggu',
  'lunas',
  'kedaluwarsa',
  'gagal',
  'selisih',
  'dikembalikan',
] as const;
export type PaymentStatus = (typeof PAYMENT_STATUSES)[number];

export const WEBHOOK_EVENTS = [
  'invoice.created',
  'payment.paid',
  'payment.expired',
  'payment.failed',
  'refund.completed',
] as const;

/** Webhook TPDI → SIM RS (docs/07 §2): HMAC diverifikasi, event mentah disimpan, dedup per event id. */
export const webhookEventSchema = z.strictObject({
  /** `X-TPDI-Event-Id` (kunci idempotensi). */
  id: z.string().min(1),
  event: z.enum(WEBHOOK_EVENTS),
  receivedAt: isoDateTime,
  amount: rupiahString,
  signatureValid: z.boolean(),
  /** Event id sudah pernah diproses → dibalas 200 tanpa efek (idempoten). */
  duplicate: z.boolean(),
  /** Respons SIM RS, mis. "200 OK · 84 ms" atau "timeout 10 dtk". */
  response: z.string().min(1),
});
export type WebhookEvent = z.infer<typeof webhookEventSchema>;

export const TRAIL_STATES = ['selesai', 'menunggu', 'gagal', 'peringatan', 'info', 'lewati'] as const;
export type TrailState = (typeof TRAIL_STATES)[number];

export const paymentTrailStepSchema = z.strictObject({
  label: z.string().min(1),
  at: isoDateTime.nullable(),
  note: z.string(),
  state: z.enum(TRAIL_STATES),
});
export type PaymentTrailStep = z.infer<typeof paymentTrailStepSchema>;

export const paymentTransactionSchema = z.strictObject({
  id: z.string().min(1),
  invoiceNo: z.string().min(1),
  patient: btnPatientRefSchema,
  channel: z.enum(PAYMENT_CHANNELS),
  amount: rupiahString,
  status: z.enum(PAYMENT_STATUSES),
  /** ID transaksi TPDI (juga Idempotency-Key) atau trace EDC; null selama draf. */
  externalRef: z.string().min(1).nullable(),
  /** Nomor VA, referensi QR, atau kode approval EDC; null selama draf. */
  reference: z.string().min(1).nullable(),
  purpose: z.string().min(1),
  createdAt: isoDateTime.nullable(),
  expiresAt: isoDateTime.nullable(),
  paidAt: isoDateTime.nullable(),
  /** Rekening tujuan dana: rekening operasional RS di BTN (tidak pernah rekening TPDI). */
  account: maskedAccount,
  trail: z.array(paymentTrailStepSchema).min(1),
  webhooks: z.array(webhookEventSchema),
  openInCashier: z.boolean(),
  /** Pasien skenario Simulasi (keadaannya mengikuti mesin skenario). */
  scenario: z.boolean(),
});
export type PaymentTransaction = z.infer<typeof paymentTransactionSchema>;

// ---------------------------------------------------------------- U09 · rekonsiliasi 3 arah

export const RECON_STATUSES = [
  'cocok',
  'menunggu-settlement',
  'menunggu-data',
  'belum-dicocokkan',
  'pengecualian',
] as const;
export type ReconStatus = (typeof RECON_STATUSES)[number];

export const RECON_EXCEPTION_KINDS = ['webhook-gagal', 'nominal-beda', 'hanya-di-bank'] as const;

/** Nilai satu sumber (kasir SIM RS, laporan TPDI, mutasi BTN); `amount` null = tidak ada di sumber itu. */
export const reconSourceSchema = z.strictObject({ amount: rupiahString.nullable(), note: z.string() });

export const reconExceptionSchema = z.strictObject({
  kind: z.enum(RECON_EXCEPTION_KINDS),
  /** Perubahan saldo tercatat SIM RS bila pengecualian diselesaikan (bertanda). */
  adjustment: rupiahString,
  explanation: z.string().min(1),
  actions: z.array(z.strictObject({ id: z.string().min(1), label: z.string().min(1) })).min(2),
  /** Penyelesaian wajib bercatatan (tercatat di jejak audit). */
  resolution: z
    .strictObject({
      actionId: z.string().min(1),
      note: z.string().trim().min(10).max(300),
      at: isoDateTime,
      by: z.string().min(1),
    })
    .nullable(),
});
export type ReconException = z.infer<typeof reconExceptionSchema>;

export const reconRowSchema = z.strictObject({
  id: z.string().min(1),
  label: z.string().min(1),
  /** Kanal dan nomor tagihan, mis. "VA BTN · INV-2610-02231". */
  source: z.string().min(1),
  kasir: reconSourceSchema,
  tpdi: reconSourceSchema,
  bank: reconSourceSchema,
  status: z.enum(RECON_STATUSES),
  note: z.string(),
  exception: reconExceptionSchema.nullable(),
  scenario: z.boolean(),
});
export type ReconRow = z.infer<typeof reconRowSchema>;

// ---------------------------------------------------------------- refund

export const REFUND_STAGES = [
  'draf',
  'menunggu-supervisor',
  'menunggu-manajer',
  'diproses-btn',
  'dana-kembali',
] as const;
export type RefundStage = (typeof REFUND_STAGES)[number];

export const REFUND_REASONS = [
  'deposit-berlebih',
  'layanan-dibatalkan',
  'pembayaran-ganda',
  'batal-rawat-inap',
  'lainnya',
] as const;
export type RefundReason = (typeof REFUND_REASONS)[number];

export const refundSchema = z.strictObject({
  id: z.string().min(1),
  number: z.string().regex(/^RF-\d{4}-\d{4}$/),
  patient: btnPatientRefSchema,
  channel: z.enum(PAYMENT_CHANNELS),
  transactionRef: z.string().min(1),
  amount: rupiahString,
  /** Batas atas (kelebihan deposit) untuk refund parsial; null = penuh. */
  maxAmount: rupiahString.nullable(),
  destination: z.string().min(1),
  context: z.string().min(1),
  stage: z.enum(REFUND_STAGES),
  reason: z.enum(REFUND_REASONS).nullable(),
  reasonNote: z.string(),
  log: z.array(z.strictObject({ at: isoDateTime, text: z.string().min(1) })),
});
export type Refund = z.infer<typeof refundSchema>;

// ---------------------------------------------------------------- konfigurasi

export const PAYMENT_CONFIG_CHANNELS = ['va', 'qris', 'edc', 'cicilan'] as const;
export const CONNECTION_MODES = ['produksi', 'sandbox'] as const;
export type ConnectionMode = (typeof CONNECTION_MODES)[number];

export const paymentConfigSchema = z.strictObject({
  merchantId: z.string().min(1),
  operationalAccount: maskedAccount,
  claimAccount: maskedAccount,
  channels: z
    .array(
      z.strictObject({
        id: z.enum(PAYMENT_CONFIG_CHANNELS),
        name: z.string().min(1),
        sub: z.string().min(1),
        fee: z.string().min(1),
        enabled: z.boolean(),
        expiry: z
          .strictObject({
            value: z.string().min(1),
            options: z.array(z.strictObject({ value: z.string().min(1), label: z.string().min(1) })).min(2),
          })
          .nullable(),
      }),
    )
    .length(4),
  mode: z.enum(CONNECTION_MODES),
  webhook: z.strictObject({
    url: z.string().min(1),
    algorithm: z.literal('HMAC-SHA256'),
    signatureHeader: z.string().min(1),
    eventIdHeader: z.string().min(1),
    /** Toleransi selisih `X-TPDI-Timestamp` (detik). */
    toleranceSec: z.number().int().positive(),
    retry: z.string().min(1),
    /** Secret webhook hanya tampil tersamar (4 karakter terakhir). */
    secretMasked: z.string().regex(/^whsec_••••[0-9a-f]{4}$/),
    secretRotatedOn: isoDate,
  }),
});
export type PaymentConfig = z.infer<typeof paymentConfigSchema>;

export const paymentOverviewSchema = z.strictObject({
  asOf: isoDateTime,
  connection: z.strictObject({
    lastWebhookAt: isoDateTime,
    latencyP95Ms: z.number().int().positive(),
    lastBankPullAt: isoDateTime,
    pullEveryMin: z.number().int().positive(),
  }),
  /** Angka harian seluruh transaksi (daftar hanya memuat contoh). */
  day: z.strictObject({
    recorded: rupiahString,
    successful: z.strictObject({ va: count, qris: count, edc: count }),
    pending: count,
    /** Settlement batch EDC yang belum masuk mutasi BTN. */
    edcUnsettled: rupiahString,
  }),
  transactions: z.array(paymentTransactionSchema).min(1),
  recon: z.strictObject({
    lastAutoRunAt: isoDateTime,
    nextAutoRunAt: isoDateTime,
    rows: z.array(reconRowSchema).min(1),
  }),
  refunds: z.array(refundSchema).min(1),
  config: paymentConfigSchema,
});
export type PaymentOverview = z.infer<typeof paymentOverviewSchema>;

// ---------------------------------------------------------------- U04 · pembiayaan piutang BPJS

export const RECEIVABLE_STATUSES = ['layak', 'pending', 'dispute'] as const;
export type ReceivableStatus = (typeof RECEIVABLE_STATUSES)[number];

/** Batch klaim BPJS per bulan pelayanan; hanya `layak` (BA verifikasi terbit) yang bisa dijaminkan. */
export const receivableBatchSchema = z.strictObject({
  id: z.string().min(1),
  /** Bulan pelayanan, mis. "Agu 2026". */
  period: z.string().min(1),
  kind: z.string().min(1),
  files: count,
  amount: rupiahString,
  status: z.enum(RECEIVABLE_STATUSES),
  note: z.string(),
  /** Pencairan yang memakai batch ini sebagai dasar; null = belum dijaminkan. */
  drawdownId: z.string().min(1).nullable(),
});
export type ReceivableBatch = z.infer<typeof receivableBatchSchema>;

export const DRAWDOWN_STAGES = ['diajukan', 'disetujui', 'cair', 'lunas'] as const;
export type DrawdownStage = (typeof DRAWDOWN_STAGES)[number];

export const drawdownSchema = z.strictObject({
  id: z.string().regex(/^PCR-\d{4}-\d{2}$/),
  batchIds: z.array(z.string().min(1)).min(1),
  principal: rupiahString,
  stage: z.enum(DRAWDOWN_STAGES),
  disbursedOn: isoDate.nullable(),
  dueOn: isoDate.nullable(),
  settledOn: isoDate.nullable(),
  marginPaid: rupiahString.nullable(),
});
export type Drawdown = z.infer<typeof drawdownSchema>;

/** Parameter fasilitas (docs/07 §5); semuanya simulasi, milik perjanjian dengan BTN. */
export const financingFacilitySchema = z.strictObject({
  agreementNo: z.string().min(1),
  validFrom: isoDate,
  validTo: isoDate,
  limit: rupiahString,
  advanceRatePercent: z.number().int().min(1).max(100),
  /** Margin per tahun dalam basis poin (800 = 8% p.a.), dihitung harian sejak cair. */
  marginBps: z.number().int().min(0).max(5000),
  maxTenorDays: z.number().int().positive(),
  avgBpjsPayDays: z.number().int().positive(),
  operationalAccount: maskedAccount,
  claimAccount: maskedAccount,
});
export type FinancingFacility = z.infer<typeof financingFacilitySchema>;

export const CLAIM_FINANCING_STAGES = ['layak', 'di-pool', 'diajukan', 'dicairkan', 'dibayar-bpjs'] as const;
export type ClaimFinancingStage = (typeof CLAIM_FINANCING_STAGES)[number];

/** Klaim pasien skenario (satu berkas) di pool pembiayaan, beserta pelunasan otomatis saat BPJS membayar. */
export const scenarioClaimSchema = z.strictObject({
  patient: btnPatientRefSchema,
  sep: z.string().min(1),
  amount: rupiahString,
  stage: z.enum(CLAIM_FINANCING_STAGES),
  /** Pilihan "cairkan lebih awal?"; null = belum diputuskan. */
  decision: z.enum(['ya', 'tidak']).nullable(),
  advance: rupiahString,
  /** Pembayaran BPJS ke rekening penampungan; null = belum dibayar. */
  repayment: z
    .strictObject({
      bpjsPaid: rupiahString,
      principal: rupiahString,
      margin: rupiahString,
      days: z.number().int().min(0),
      forwarded: rupiahString,
    })
    .nullable(),
});
export type ScenarioClaim = z.infer<typeof scenarioClaimSchema>;

// ---------------------------------------------------------------- U04 · cicilan biaya pasien

export const INSTALMENT_STAGES = [
  'diajukan',
  'verifikasi',
  'disetujui',
  'akad',
  'dicairkan',
  'ditolak',
] as const;
export type InstalmentStage = (typeof INSTALMENT_STAGES)[number];

export const instalmentApplicationSchema = z.strictObject({
  id: z.string().min(1),
  reference: z.string().regex(/^PB-\d{4}-\d{4}$/),
  patient: btnPatientRefSchema,
  service: z.string().min(1),
  invoiceNo: z.string().min(1),
  amount: rupiahString,
  tenorMonths: z.number().int().min(1).max(60),
  source: z.enum(['Kasir', 'Aplikasi pasien']),
  applicant: z.string().min(1),
  note: z.string(),
  stage: z.enum(INSTALMENT_STAGES),
  rejectReason: z.string().min(10).nullable(),
  history: z.array(z.strictObject({ stage: z.enum(INSTALMENT_STAGES), at: isoDateTime })).min(1),
  scenario: z.boolean(),
});
export type InstalmentApplication = z.infer<typeof instalmentApplicationSchema>;

export const financingOverviewSchema = z.strictObject({
  asOf: isoDateTime,
  facility: financingFacilitySchema,
  pool: z.array(receivableBatchSchema).min(1),
  drawdowns: z.array(drawdownSchema),
  scenarioClaim: scenarioClaimSchema.nullable(),
  applications: z.array(instalmentApplicationSchema).min(1),
  /** Margin flat cicilan pasien per tahun (persen, estimasi; produk milik BTN). */
  instalmentMarginPercent: z.number().min(0).max(40),
});
export type FinancingOverview = z.infer<typeof financingOverviewSchema>;

// ---------------------------------------------------------------- S06 · kamar operasi

export const OR_CASE_STATUSES = ['selesai', 'berjalan', 'terjadwal', 'cito'] as const;
export type OrCaseStatus = (typeof OR_CASE_STATUSES)[number];

export const CHECKLIST_PHASES = ['sign-in', 'time-out', 'sign-out'] as const;
export type ChecklistPhaseId = (typeof CHECKLIST_PHASES)[number];

/** Butir daftar tilik keselamatan operasi WHO. */
export const checklistItemSchema = z.strictObject({
  id: z.string().min(1),
  label: z.string().min(1),
  checked: z.boolean(),
});
export type ChecklistItem = z.infer<typeof checklistItemSchema>;

export const checklistPhaseSchema = z.strictObject({
  phase: z.enum(CHECKLIST_PHASES),
  items: z.array(checklistItemSchema).length(5),
  confirmedAt: isoDateTime.nullable(),
  confirmedBy: z.string().min(1).nullable(),
});
export type ChecklistPhase = z.infer<typeof checklistPhaseSchema>;

/** Hitung kasa, jarum, dan instrumen: hitung awal (sebelum insisi) dan akhir (saat sign out). */
export const instrumentCountSchema = z.strictObject({
  id: z.string().min(1),
  label: z.string().min(1),
  unit: z.string().min(1),
  initial: z.number().int().min(0),
  final: z.number().int().min(0).nullable(),
});
export type InstrumentCount = z.infer<typeof instrumentCountSchema>;

export const orCaseSchema = z.strictObject({
  id: z.string().min(1),
  /** Menit sejak tengah malam (WIB). */
  startMin: z.number().int().min(0).max(1440),
  durationMin: z.number().int().min(15).max(720),
  status: z.enum(OR_CASE_STATUSES),
  /** Keterangan singkat di blok jadwal, mis. "selesai 08.34". */
  statusNote: z.string(),
  patient: z.strictObject({
    id: z.string().min(1),
    name: z.string().min(1),
    rm: z.string().regex(/^\d{2}-\d{2}-\d{2}-\d{2}$/),
    sex: z.enum(['L', 'P']),
    ageYears: z.number().int().min(0),
    birthDate: isoDate,
    allergies: z.array(z.string().min(1)),
    guarantor: z.string().min(1),
  }),
  procedure: z.string().min(1),
  /** ICD-9-CM (hanya kode seed); null = dikode setelah laporan operasi. */
  icd9cm: z
    .string()
    .regex(/^\d{2}\.\d{1,2}$/)
    .nullable(),
  diagnosis: z.strictObject({ icd10: z.string().min(3), label: z.string().min(1) }).nullable(),
  operator: z.string().min(1),
  anesthetist: z.string().min(1),
  anesthesia: z.string().min(1),
  nurses: z.strictObject({ scrub: z.string().min(1), circulating: z.string().min(1) }),
  checklist: z.array(checklistPhaseSchema).length(3),
  counts: z.array(instrumentCountSchema).min(1),
  incisionAt: isoDateTime.nullable(),
  scenario: z.boolean(),
});
export type OrCase = z.infer<typeof orCaseSchema>;

export const orRoomSchema = z.strictObject({
  id: z.string().min(1),
  name: z.string().min(1),
  kind: z.string().min(1),
  cases: z.array(orCaseSchema),
});
export type OrRoom = z.infer<typeof orRoomSchema>;

export const orScheduleSchema = z.strictObject({
  date: isoDate,
  now: isoDateTime,
  /** Rentang jadwal (menit sejak tengah malam), mis. 07.00–16.00. */
  dayStartMin: z.number().int().min(0).max(1440),
  dayEndMin: z.number().int().min(0).max(1440),
  stats: z.strictObject({
    utilizationPercent: z.number().int().min(0).max(100),
    onTimeStartPercent: z.number().int().min(0).max(100),
    cancellations: count,
  }),
  rooms: z.array(orRoomSchema).length(4),
});
export type OrSchedule = z.infer<typeof orScheduleSchema>;
