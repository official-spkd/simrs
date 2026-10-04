import { z } from 'zod';

/**
 * I09 · Dasbor eksekutif (direksi). Kontrak respons yang dipenuhi data dummy mode presentasi sekarang (ADR-0023)
 * dan API kelak. Angka mentah (bukan teks tampilan): format Indonesia dikerjakan lapisan tampilan.
 */

export const DASHBOARD_PERIODS = ['hari-ini', 'bulan', 'ytd'] as const;
export type DashboardPeriod = (typeof DASHBOARD_PERIODS)[number];

const isoDate = z.iso.date();
/** Rupiah bulat sebagai string (bigint tidak didukung JSON). */
const rupiahString = z.string().regex(/^-?\d{1,18}$/);

export const DASHBOARD_KPI_IDS = [
  'bor',
  'alos',
  'kunjungan-rj',
  'tunggu-rj',
  'klaim-terbayar',
  'kepuasan',
] as const;

export const dashboardKpiSchema = z.strictObject({
  id: z.enum(DASHBOARD_KPI_IDS),
  label: z.string().min(1),
  value: z.number(),
  /** Satuan nilai: persen (0–100), hari, pasien per hari, menit. */
  unit: z.enum(['persen', 'hari', 'pasien', 'menit']),
  /** Perubahan terhadap pembanding, dalam satuan `deltaUnit`. */
  delta: z.number(),
  deltaUnit: z.enum(['poin', 'hari', 'persen', 'menit']),
  /** Pembanding perubahan, mis. "vs kemarin". */
  comparedTo: z.string().min(1),
  /** Rentang sasaran (inklusif); nilai di luar rentang = perlu perhatian. */
  target: z.strictObject({
    min: z.number().optional(),
    max: z.number().optional(),
    label: z.string().min(1),
  }),
  /** Catatan kecil, mis. "data s.d. 10.45". */
  note: z.string().optional(),
});

export const executiveDashboardSchema = z.strictObject({
  period: z.enum(DASHBOARD_PERIODS),
  /** Waktu data (ISO 8601). */
  asOf: z.iso.datetime({ offset: true }),
  kpis: z.array(dashboardKpiSchema).length(6),
  /** Pendapatan harian 30 hari terakhir vs anggaran harian. */
  revenue: z
    .array(z.strictObject({ date: isoDate, actual: rupiahString, budget: rupiahString }))
    .min(2)
    .max(31),
  payerMix: z
    .array(
      z.strictObject({
        payer: z.enum(['jkn', 'asuransi', 'umum', 'kerja-sama']),
        label: z.string().min(1),
        revenue: rupiahString,
        /** Margin kontribusi (persen, boleh negatif). */
        marginPercent: z.number(),
      }),
    )
    .min(1),
  quality: z
    .array(
      z.strictObject({
        id: z.string().min(1),
        label: z.string().min(1),
        value: z.number().min(0).max(100),
        target: z.strictObject({ min: z.number().min(0).max(100), label: z.string().min(1) }),
      }),
    )
    .min(1),
  capacity: z
    .array(
      z.strictObject({
        id: z.string().min(1),
        label: z.string().min(1),
        used: z.number().int().min(0),
        total: z.number().int().min(1),
        unit: z.enum(['bed', 'kasus']),
      }),
    )
    .min(1),
  alerts: z.array(
    z.strictObject({
      id: z.string().min(1),
      title: z.string().min(1),
      detail: z.string().min(1),
      severity: z.enum(['kritis', 'perhatian']),
      /** Layar tindak lanjut (id registri layar web). */
      link: z.strictObject({ screen: z.string().min(1), label: z.string().min(1) }).optional(),
    }),
  ),
});

export type DashboardKpi = z.infer<typeof dashboardKpiSchema>;
export type ExecutiveDashboard = z.infer<typeof executiveDashboardSchema>;
