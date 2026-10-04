import {
  type AccountingBoard,
  type AgingRow,
  AGING_BUCKETS,
  type JournalEntry,
  type JournalSource,
  sumRupiah,
} from '@simrs/shared';
import type { ViewTone } from './keuangan';

/** U04/U07/U09 · Perhitungan dan format tampilan Akuntansi (murni; dipakai server dan klien). */

export const JOURNAL_SOURCE_LABEL: Record<JournalSource, string> = {
  kasir: 'Kasir',
  klaim: 'Klaim',
  'tpdi-btn': 'TPDI/BTN',
  logistik: 'Logistik',
};

export const JOURNAL_STATUS_VIEW: Record<JournalEntry['status'], { label: string; tone: ViewTone }> = {
  terposting: { label: 'Terposting', tone: 'success' },
  'menunggu-rekonsiliasi': { label: 'Menunggu rekonsiliasi', tone: 'warning' },
  'menunggu-persetujuan': { label: 'Menunggu penyetuju kedua', tone: 'info' },
  'perlu-pemetaan': { label: 'Perlu pemetaan akun', tone: 'danger' },
};

/** Jumlah debit dan kredit satu jurnal (bigint). */
export function journalTotals(lines: JournalEntry['lines']): { debit: bigint; credit: bigint } {
  return {
    debit: sumRupiah(lines.map((l) => BigInt(l.debit))),
    credit: sumRupiah(lines.map((l) => BigInt(l.credit))),
  };
}

/**
 * Umur piutang: total dan porsi (persen bulat) per kelompok umur. Pembulatan sisa terbesar sehingga jumlah porsi
 * tepat 100, dihitung dengan bigint (tanpa float).
 */
export function agingView(row: AgingRow): { total: bigint; shares: number[]; amounts: bigint[] } {
  const amounts = row.buckets.map((b) => BigInt(b));
  const total = sumRupiah(amounts);
  if (total === 0n) return { total, shares: amounts.map(() => 0), amounts };
  const raw = amounts.map((a) => ({ floor: (a * 100n) / total, rem: (a * 100n) % total }));
  let left = 100n - raw.reduce((s, r) => s + r.floor, 0n);
  const order = raw
    .map((r, i) => ({ i, rem: r.rem }))
    .sort((a, b) => (b.rem > a.rem ? 1 : b.rem < a.rem ? -1 : a.i - b.i));
  const shares = raw.map((r) => r.floor);
  for (const o of order) {
    if (left <= 0n) break;
    shares[o.i] = (shares[o.i] ?? 0n) + 1n;
    left -= 1n;
  }
  return { total, shares: shares.map(Number), amounts };
}

/** Rupiah dalam juta untuk tabel ringkas: 21.412.000.000 → "21.412". */
export function formatJuta(v: bigint): string {
  return ((v + 500_000n) / 1_000_000n).toString().replace(/\B(?=(\d{3})+(?!\d))/g, '.');
}

export const AGING_LABELS = AGING_BUCKETS;

/** Syarat tutup periode: semua jurnal terpetakan dan rekonsiliasi bank tanpa selisih. */
export function closeReadiness(state: { unmapped: string[]; unmatchedAccounts: string[] }): {
  ready: boolean;
  reason: string;
} {
  const parts: string[] = [];
  if (state.unmapped.length) parts.push(`petakan akun ${state.unmapped.join(', ')}`);
  if (state.unmatchedAccounts.length) parts.push(`padankan selisih ${state.unmatchedAccounts.join(', ')}`);
  return parts.length
    ? { ready: false, reason: `Belum bisa ditutup: ${parts.join(' dan ')}.` }
    : { ready: true, reason: '' };
}

/** Jurnal belum bisa diposting: ada baris tanpa akun lawan (perlu pemetaan). */
export function needsMapping(j: Pick<JournalEntry, 'status' | 'lines'>): boolean {
  return j.status === 'perlu-pemetaan' || j.lines.some((l) => !l.account);
}

/** Label rekening untuk syarat tutup periode, mis. "BTN ••••9021". */
export const reconLabel = (b: Pick<AccountingBoard['bankRecon'][number], 'account'>) => `BTN ${b.account}`;

/**
 * Syarat tutup periode diperiksa terhadap papan versi server (bukan hitungan klien): setiap jurnal yang perlu
 * pemetaan harus ada di `mappedJournalIds`, setiap rekening dengan mutasi belum padan di `matchedAccountIds`.
 */
export function periodCloseCheck(
  board: Pick<AccountingBoard, 'journals' | 'bankRecon'>,
  done: { mappedJournalIds: readonly string[]; matchedAccountIds: readonly string[] },
): { ready: boolean; reason: string } {
  const mapped = new Set(done.mappedJournalIds);
  const matched = new Set(done.matchedAccountIds);
  return closeReadiness({
    unmapped: board.journals.filter((j) => needsMapping(j) && !mapped.has(j.id)).map((j) => j.number),
    unmatchedAccounts: board.bankRecon
      .filter((b) => b.unmatched.length > 0 && !matched.has(b.id))
      .map(reconLabel),
  });
}
