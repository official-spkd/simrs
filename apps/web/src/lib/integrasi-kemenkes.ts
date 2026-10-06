/**
 * I04 · Konektor Kemenkes (mode presentasi, ADR-0023): RS Online (ketersediaan tempat tidur, real-time) dan kerangka
 * laporan SIRS bulanan. Rencana fase 7 §7.5: hanya agregat (tanpa data identitas pasien), batas periode WIB,
 * idempoten per periode; laporan yang belum punya sumber data ditandai "belum tersedia". Alur: susun → validasi
 * bentuk → kirim (berkonfirmasi) → tanda terima.
 */

export type ReportStatus = 'draf' | 'siap' | 'terkirim' | 'belum-tersedia';

export interface ReportRow {
  label: string;
  value: number;
}

export interface ReportCheck {
  id: string;
  label: string;
  ok: boolean;
  /** Tindakan perbaikan bila gagal (dikerjakan unit sumber, mis. rekam medis). */
  fix: string | null;
}

export interface KemenkesReport {
  id: string;
  name: string;
  system: 'RS Online' | 'SIRS';
  frequency: 'real-time' | 'bulanan';
  period: string;
  source: string;
  status: ReportStatus;
  rows: readonly ReportRow[];
  /** Total yang dideklarasikan generator (harus = Σ rincian). */
  declaredTotal: number | null;
  checks: readonly ReportCheck[];
  sent: { at: string; receipt: string } | null;
}

/** Validasi bentuk: total = Σ rincian, tidak ada nilai negatif, ditambah pemeriksaan khusus laporan. */
export function validateReport(r: KemenkesReport): ReportCheck[] {
  const sum = r.rows.reduce((a, x) => a + x.value, 0);
  const base: ReportCheck[] = [
    {
      id: 'total',
      label:
        r.declaredTotal === null ? 'Rincian lengkap' : `Total ${r.declaredTotal} = jumlah rincian ${sum}`,
      ok: r.declaredTotal === null || r.declaredTotal === sum,
      fix: 'Susun ulang dari data sumber',
    },
    { id: 'non-negatif', label: 'Tidak ada nilai negatif', ok: r.rows.every((x) => x.value >= 0), fix: null },
    { id: 'agregat', label: 'Hanya agregat (tanpa identitas pasien)', ok: true, fix: null },
  ];
  return [...base, ...r.checks];
}

export type SendBlock = 'NOT_AVAILABLE' | 'ALREADY_SENT' | 'VALIDATION' | null;

export function sendGate(r: KemenkesReport): SendBlock {
  if (r.status === 'belum-tersedia') return 'NOT_AVAILABLE';
  if (r.sent) return 'ALREADY_SENT';
  if (validateReport(r).some((c) => !c.ok)) return 'VALIDATION';
  return null;
}

export const SEND_BLOCK_TEXT: Record<Exclude<SendBlock, null>, string> = {
  NOT_AVAILABLE: 'Laporan ini belum tersedia: sumber datanya belum dibangun.',
  ALREADY_SENT:
    'Periode ini sudah terkirim (idempoten per periode). Koreksi lewat pengiriman ulang dari hub.',
  VALIDATION: 'Validasi bentuk belum lolos. Perbaiki data sumber lalu susun ulang.',
};

export function applyFix(r: KemenkesReport, checkId: string): KemenkesReport {
  return { ...r, checks: r.checks.map((c) => (c.id === checkId ? { ...c, ok: true } : c)) };
}

/** Nomor tanda terima fiktif deterministik dari id + urutan. */
export function receiptNo(r: Pick<KemenkesReport, 'system' | 'id'>, seq: number): string {
  return `${r.system === 'SIRS' ? 'SIRS' : 'RSO'}-2610-${String(seq).padStart(4, '0')}`;
}
