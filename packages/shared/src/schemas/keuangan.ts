import { z } from 'zod';

/**
 * U01–U09 · Keuangan: kasir, klaim INA-CBG, akuntansi.
 * Kontrak respons (zod) yang dipenuhi data dummy mode presentasi sekarang (ADR-0023) dan API kelak. Nama mengikuti
 * entitas docs/04 (charge_items, invoices, payments, claims, journal_entries, fiscal_periods), camelCase, uang =
 * string rupiah bulat (bigint tidak didukung JSON), waktu ISO 8601.
 */

/** Rupiah bulat (boleh negatif) sebagai string. */
const rupiah = z.string().regex(/^-?\d{1,18}$/);
/** Rupiah bulat non-negatif sebagai string. */
const amount = z.string().regex(/^\d{1,18}$/);
const isoDateTime = z.iso.datetime({ offset: true });
const scenarioRef = z.enum(['rawat-jalan', 'igd-ranap', 'elektif-btn']).nullable();

// ---------------------------------------------------------------------------------------------------------------
// U02/U03 · Kasir dan tarif
// ---------------------------------------------------------------------------------------------------------------

export const CHARGE_CATEGORIES = [
  'igd',
  'akomodasi',
  'visite',
  'tindakan',
  'operasi',
  'laboratorium',
  'radiologi',
  'obat',
  'administrasi',
] as const;
export type ChargeCategory = (typeof CHARGE_CATEGORIES)[number];

/** Baris tagihan hasil charge capture (`charge_items`): setiap baris membawa sumbernya. */
export const chargeItemSchema = z.strictObject({
  id: z.string().min(1),
  name: z.string().min(1),
  category: z.enum(CHARGE_CATEGORIES),
  /** Asal charge capture: unit/langkah (mis. "LIS", "eMAR", "ADT", "Asesmen perawat"). */
  source: z.string().min(1),
  /** Kapan/rentang tertangkap, untuk tampilan (mis. "29 Sep", "07.32"). */
  when: z.string(),
  qty: z.number().int().min(1),
  /** Harga satuan; null = rekap beberapa item dengan harga berbeda (jumlah tetap eksak). */
  unitPrice: amount.nullable(),
  amount,
  /** Item manual kasir (bukan charge capture): wajib alasan tertulis, tercatat di audit. */
  manual: z.boolean(),
  reason: z.string().min(15).max(300).optional(),
});

export const PAYMENT_METHODS = ['qris', 'va', 'debit', 'tunai', 'transfer', 'cicilan'] as const;
export type PaymentMethod = (typeof PAYMENT_METHODS)[number];

/** Pembayaran pasien yang sudah diterima (`payments`): deposit atau pelunasan. */
export const paymentSchema = z.strictObject({
  id: z.string().min(1),
  kind: z.enum(['deposit', 'pelunasan']),
  method: z.enum(PAYMENT_METHODS),
  amount,
  at: isoDateTime,
  /** Referensi kanal (kuitansi, VA, QRIS, approval EDC, nomor pembiayaan). */
  reference: z.string().min(1),
});

/**
 * Pembagian penjamin. Identitas: `hospitalTotal = payerPays + patientShare + hospitalAbsorbs`.
 * BPJS membayar tarif INA-CBG hak kelas; pasien hanya menanggung selisih naik kelas; sisa tarif RS di atas
 * INA-CBG tidak ditagihkan ke siapa pun (negatif = surplus INA-CBG atas tarif RS).
 */
export const payerSplitSchema = z.strictObject({
  scheme: z.enum(['bpjs', 'asuransi', 'umum']),
  /** Label penjamin, mis. "BPJS hak kelas 2". */
  payerLabel: z.string().min(1),
  hospitalTotal: amount,
  inacbg: z
    .strictObject({
      code: z.string().min(1),
      name: z.string().min(1),
      classLabel: z.string().min(1),
      tariff: amount,
      /** true = estimasi grouper (klaim belum final). */
      estimate: z.boolean(),
    })
    .nullable(),
  payerPays: amount,
  classUpgrade: z.strictObject({ label: z.string().min(1), amount, rule: z.string().min(1) }).nullable(),
  /** Tanggungan pasien: selisih naik kelas, ekses plafon asuransi, atau seluruh tagihan umum. */
  patientShare: amount,
  hospitalAbsorbs: rupiah,
});

export const INVOICE_STATUSES = ['berjalan', 'final', 'lunas'] as const;
export type InvoiceStatus = (typeof INVOICE_STATUSES)[number];

export const invoiceSchema = z.strictObject({
  id: z.string().min(1),
  number: z.string().regex(/^INV-\d{4}-\d{5}$/),
  /** Nomor antrean loket kasir (`K-012`); null = belum mengantre (mis. pasien rawat inap). */
  queueNo: z
    .string()
    .regex(/^K-\d{3}$/)
    .nullable(),
  scenario: scenarioRef,
  patient: z.strictObject({
    id: z.string().min(1),
    rm: z.string().min(1),
    name: z.string().min(1),
    sex: z.enum(['L', 'P']),
    ageYears: z.number().int().min(0),
    birthDate: z.iso.date(),
    allergies: z.array(z.string().min(1)),
    guarantor: z.string().min(1),
  }),
  encounter: z.strictObject({
    kind: z.enum(['rawat-jalan', 'igd', 'rawat-inap']),
    label: z.string().min(1),
    location: z.string().min(1),
    period: z.string().min(1),
    sep: z.string().nullable(),
    dpjp: z.string().min(1),
    /** false = pasien masih dirawat; tagihan berjalan dan belum bisa difinalkan. */
    discharged: z.boolean(),
  }),
  status: z.enum(INVOICE_STATUSES),
  lines: z.array(chargeItemSchema).min(1),
  split: payerSplitSchema,
  payments: z.array(paymentSchema),
  /** Sisa yang harus dibayar pasien = patientShare − Σ payments. */
  patientDue: amount,
  finalizedAt: isoDateTime.nullable(),
  /** Nomor kuitansi bila lunas. */
  receiptNo: z.string().nullable(),
  /** Keterangan status singkat (mis. "Menunggu dana BTN cair"). */
  note: z.string().optional(),
});

export const kasirBoardSchema = z.strictObject({
  asOf: isoDateTime,
  shift: z.strictObject({
    label: z.string().min(1),
    counter: z.string().min(1),
    openingCash: amount,
  }),
  invoices: z.array(invoiceSchema).min(1),
});

export type ChargeItem = z.infer<typeof chargeItemSchema>;
export type Payment = z.infer<typeof paymentSchema>;
export type PayerSplit = z.infer<typeof payerSplitSchema>;
export type Invoice = z.infer<typeof invoiceSchema>;
export type KasirBoard = z.infer<typeof kasirBoardSchema>;

// ---------------------------------------------------------------------------------------------------------------
// U05/U06 · Klaim INA-CBG dan koding
// ---------------------------------------------------------------------------------------------------------------

/** Status klaim (docs/04: draf/terkirim/pending/layak bayar/dispute/dibayar). */
export const CLAIM_STATUSES = ['draft', 'sent', 'pending', 'payable', 'dispute', 'paid'] as const;
export type ClaimStatus = (typeof CLAIM_STATUSES)[number];

const level = z.enum(['ok', 'warn', 'bad', 'info', 'none']);

export const claimSchema = z.strictObject({
  id: z.string().min(1),
  scenario: scenarioRef,
  patient: z.strictObject({ id: z.string().min(1), rm: z.string().min(1), name: z.string().min(1) }),
  encounter: z.strictObject({
    kind: z.enum(['rawat-jalan', 'rawat-inap']),
    /** Ringkas untuk daftar, mis. "RI · pneumonia · 6 hari". */
    summary: z.string().min(1),
    /** Judul berkas, mis. "rawat inap 6 hari". */
    title: z.string().min(1),
    sep: z.string().min(1),
    classLabel: z.string().min(1),
    dpjp: z.string().min(1),
    /** Status resume, mis. "resume final 4 Okt 11.02" atau "resume belum ber-TTE". */
    resume: z.string().min(1),
    discharged: z.boolean(),
  }),
  status: z.enum(CLAIM_STATUSES),
  /** Label sub-status di daftar (mis. "Ada saran", "Resume belum final") dan tingkatnya. */
  tag: z.strictObject({ label: z.string().min(1), level }),
  /** Umur berkas, mis. "pulang H-0", "34 hr". */
  ageLabel: z.string().min(1),
  diagnoses: z
    .array(
      z.strictObject({
        code: z.string().regex(/^[A-Z]\d{2}(\.\d{1,2})?$/),
        name: z.string().min(1),
        role: z.enum(['utama', 'sekunder', 'perlu-bukti', 'sementara']),
      }),
    )
    .min(1),
  procedures: z.array(
    z.strictObject({ code: z.string().regex(/^\d{2}\.\d{1,2}$/), name: z.string().min(1) }),
  ),
  /** Hasil grouper; null = grouping ditahan (resume belum final atau pasien belum pulang). */
  grouper: z
    .strictObject({
      cbg: z.string().min(1),
      name: z.string().min(1),
      classLabel: z.string().min(1),
      tariff: amount,
      specialCmg: z.string().nullable(),
      final: z.boolean(),
    })
    .nullable(),
  /** Tarif RS (billing final); null = billing berjalan. */
  hospitalCost: amount.nullable(),
  documents: z
    .array(z.strictObject({ id: z.string().min(1), label: z.string().min(1), ok: z.boolean() }))
    .min(1),
  note: z.strictObject({ level, title: z.string().min(1), text: z.string().min(1) }).nullable(),
  /** Saran koding spesifik (mis. J18.9 → J13) dengan grouper alternatif bila diterima. */
  suggestion: z
    .strictObject({
      from: z.string().min(1),
      to: z.string().min(1),
      toName: z.string().min(1),
      reason: z.string().min(1),
      /** Dokumen bukti yang menaikkan tingkat keparahan bila lengkap. */
      evidenceDocId: z.string().min(1),
      /** Grouper bila saran diterima dan bukti lengkap. */
      upgraded: z.strictObject({ cbg: z.string().min(1), name: z.string().min(1), tariff: amount }),
    })
    .nullable(),
  submittedAt: isoDateTime.nullable(),
});

const count = z.number().int().min(0);

export const claimBoardSchema = z.strictObject({
  asOf: isoDateTime,
  periodLabel: z.string().min(1),
  kpis: z.strictObject({
    claimsMonth: z.strictObject({ total: count, rj: count, ri: count }),
    submittedValue: amount,
    avgCodingDays: z.number().min(0),
    pending: z.strictObject({ count, value: amount }),
    dispute: z.strictObject({ count, value: amount }),
  }),
  /** Jumlah klaim per status di seluruh periode (daftar hanya menampilkan contoh). */
  totals: z.strictObject({
    draft: count,
    sent: count,
    pending: count,
    payable: count,
    dispute: count,
    paid: count,
  }),
  claims: z.array(claimSchema).min(1),
});

export type Claim = z.infer<typeof claimSchema>;
export type ClaimBoard = z.infer<typeof claimBoardSchema>;

// ---------------------------------------------------------------------------------------------------------------
// U04/U07/U09 · Akuntansi: jurnal otomatis, piutang, rekonsiliasi bank, periode fiskal
// ---------------------------------------------------------------------------------------------------------------

export const JOURNAL_SOURCES = ['kasir', 'klaim', 'tpdi-btn', 'logistik'] as const;
export type JournalSource = (typeof JOURNAL_SOURCES)[number];

export const journalLineSchema = z.strictObject({
  /** Akun bagan akun (`coa_accounts`); null = akun lawan belum dipetakan (jurnal belum bisa diposting). */
  account: z.strictObject({ code: z.string().min(1), name: z.string().min(1) }).nullable(),
  debit: amount,
  credit: amount,
});

/** Jumlah debit = jumlah kredit, dan tiap baris tepat satu sisi (CLAUDE.md §4.7). */
export function journalBalanced(lines: ReadonlyArray<{ debit: string; credit: string }>): boolean {
  let debit = 0n;
  let credit = 0n;
  for (const l of lines) {
    const d = BigInt(l.debit);
    const c = BigInt(l.credit);
    if (d > 0n === c > 0n) return false;
    debit += d;
    credit += c;
  }
  return debit > 0n && debit === credit;
}

export const journalEntrySchema = z
  .strictObject({
    id: z.string().min(1),
    number: z.string().regex(/^JU-\d{8}$/),
    date: isoDateTime,
    source: z.enum(JOURNAL_SOURCES),
    /** Dokumen sumber, mis. "Kasir · INV-2610-02217". */
    reference: z.string().min(1),
    description: z.string().min(1),
    /** Terposting; menunggu rekonsiliasi bank; menunggu penyetuju kedua (pembuat ≠ penyetuju); akun belum dipetakan. */
    status: z.enum(['terposting', 'menunggu-rekonsiliasi', 'menunggu-persetujuan', 'perlu-pemetaan']),
    scenario: scenarioRef,
    lines: z.array(journalLineSchema).min(2),
  })
  .refine((j) => journalBalanced(j.lines), { message: 'Jurnal tidak seimbang (debit ≠ kredit)' });

export const AGING_BUCKETS = ['0–30 hr', '31–60 hr', '61–90 hr', '> 90 hr'] as const;

export const agingRowSchema = z.strictObject({
  payer: z.enum(['bpjs', 'asuransi', 'kerja-sama', 'umum']),
  label: z.string().min(1),
  /** Saldo piutang per kelompok umur (urutan `AGING_BUCKETS`). */
  buckets: z.tuple([amount, amount, amount, amount]),
});

export const bankReconSchema = z.strictObject({
  id: z.string().min(1),
  label: z.string().min(1),
  /** Rekening tersamar, mis. "••••4417". */
  account: z.string().min(1),
  mutations: count,
  unmatched: z.array(
    z.strictObject({
      id: z.string().min(1),
      date: isoDateTime,
      description: z.string().min(1),
      amount,
    }),
  ),
  syncedAt: isoDateTime,
  note: z.string().min(1),
});

export const fiscalPeriodSchema = z.strictObject({
  id: z.string().regex(/^\d{4}-\d{2}$/),
  label: z.string().min(1),
  status: z.enum(['terbuka', 'tertutup']),
  closedAt: isoDateTime.nullable(),
});

export const accountingBoardSchema = z.strictObject({
  asOf: isoDateTime,
  period: fiscalPeriodSchema,
  previousPeriod: fiscalPeriodSchema,
  kpis: z.strictObject({
    revenueMtd: amount,
    /** Perubahan vs bulan lalu pada hari yang sama (persen, satu desimal). */
    revenueDeltaPercent: z.number(),
    bpjsReceivable: amount,
    avgCollectionDays: count,
    cashAndBank: amount,
    cashDays: count,
    payablesDue7d: amount,
    suppliersDue: count,
  }),
  /** Jumlah seluruh jurnal otomatis periode berjalan (tabel menampilkan contoh terbaru). */
  journalCount: count,
  journals: z.array(journalEntrySchema).min(1),
  /** Pilihan akun lawan untuk jurnal yang perlu pemetaan. */
  mappingOptions: z.array(z.strictObject({ code: z.string().min(1), name: z.string().min(1) })).min(1),
  aging: z.array(agingRowSchema).min(1),
  bankRecon: z.array(bankReconSchema).min(1),
});

export type JournalLine = z.infer<typeof journalLineSchema>;
export type JournalEntry = z.infer<typeof journalEntrySchema>;
export type AgingRow = z.infer<typeof agingRowSchema>;
export type BankRecon = z.infer<typeof bankReconSchema>;
export type FiscalPeriod = z.infer<typeof fiscalPeriodSchema>;
export type AccountingBoard = z.infer<typeof accountingBoardSchema>;
