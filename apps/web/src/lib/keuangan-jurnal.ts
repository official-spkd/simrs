import { formatRupiah, isoDateJakarta, sumRupiah } from '@simrs/shared';

/**
 * Jurnal berpasangan untuk layar keuangan lanjutan (U01–U10, I10; mode presentasi ADR-0023). Murni, dipakai server
 * dan klien. Uang selalu bigint rupiah; satu baris hanya debit atau hanya kredit; jurnal sah bila Σ debit = Σ kredit
 * dan tidak nol (CLAUDE.md prinsip 7).
 */

export interface AkunRef {
  code: string;
  name: string;
}

export interface BarisJurnal {
  account: AkunRef;
  debit: bigint;
  credit: bigint;
}

export interface DrafJurnal {
  /** Keterangan singkat, mis. "Pelunasan batch TG-2610-004". */
  memo: string;
  lines: BarisJurnal[];
}

export const dr = (account: AkunRef, v: bigint): BarisJurnal => ({ account, debit: v, credit: 0n });
export const cr = (account: AkunRef, v: bigint): BarisJurnal => ({ account, debit: 0n, credit: v });

/** Baris bernilai nol dibuang (mis. selisih kas nol tidak perlu baris beban). */
export function jurnal(memo: string, lines: readonly BarisJurnal[]): DrafJurnal {
  return { memo, lines: lines.filter((l) => l.debit !== 0n || l.credit !== 0n) };
}

export function totalJurnal(lines: readonly BarisJurnal[]): { debit: bigint; credit: bigint } {
  return {
    debit: sumRupiah(lines.map((l) => l.debit)),
    credit: sumRupiah(lines.map((l) => l.credit)),
  };
}

/** Seimbang: Σ debit = Σ kredit > 0, setiap baris tepat satu sisi dan tidak negatif. */
export function jurnalSeimbang(lines: readonly BarisJurnal[]): boolean {
  if (lines.length < 2) return false;
  for (const l of lines) {
    if (l.debit < 0n || l.credit < 0n) return false;
    if (l.debit > 0n === l.credit > 0n) return false;
  }
  const t = totalJurnal(lines);
  return t.debit === t.credit && t.debit > 0n;
}

/** Bagan akun tambahan layar keuangan lanjutan (melengkapi `AKUN` di fixture keuangan; kode fiktif tetapi baku). */
export const AKUN_LANJUT = {
  kasKasir: { code: '1-1110', name: 'Kas kasir (laci loket)' },
  bankOps: { code: '1-1120', name: 'Bank BTN ••••4417 — operasional' },
  bankMitra: { code: '1-1140', name: 'Bank mitra ••••7730 — penggajian dan pemasok' },
  piutangEdc: { code: '1-1210', name: 'Piutang settlement EDC' },
  piutangAsuransi: { code: '1-1340', name: 'Piutang asuransi swasta' },
  piutangPerusahaan: { code: '1-1350', name: 'Piutang perusahaan kerja sama' },
  piutangPasien: { code: '1-1330', name: 'Piutang pasien' },
  persediaan: { code: '1-1410', name: 'Persediaan obat dan BHP' },
  utangBelumFaktur: { code: '2-1120', name: 'Utang penerimaan belum difakturkan' },
  utangUsaha: { code: '2-1110', name: 'Utang usaha — pemasok' },
  utangJaspel: { code: '2-1410', name: 'Utang jasa pelayanan' },
  utangPph21: { code: '2-1420', name: 'Utang PPh 21 jasa pelayanan' },
  pendapatanLain: { code: '4-3100', name: 'Pendapatan lain-lain (selisih lebih kas)' },
  bebanJaspel: { code: '5-1100', name: 'Beban jasa pelayanan' },
  bebanMdr: { code: '6-1200', name: 'Beban administrasi bank (MDR EDC)' },
  bebanSelisihKas: { code: '6-1300', name: 'Beban selisih kurang kas' },
  bebanPiutang: { code: '6-3100', name: 'Beban penurunan nilai piutang' },
  potonganPenjualan: { code: '4-1950', name: 'Potongan dan penyesuaian tagihan' },
} as const satisfies Record<string, AkunRef>;

const AKUN_UANG_MUKA: AkunRef = { code: '2-1210', name: 'Uang muka pasien' };

/**
 * Jurnal refund pasien (fase 6, layar Pembayaran digital): dana kembali dari rekening operasional BTN ke rekening
 * pasien, mengurangi uang muka/kelebihan bayar pasien. Dr Uang muka pasien / Cr Bank BTN operasional.
 */
export function refundJournal(number: string, amount: bigint): DrafJurnal {
  return jurnal(`Refund ${number}`, [dr(AKUN_UANG_MUKA, amount), cr(AKUN_LANJUT.bankOps, amount)]);
}

/** Ringkasan satu baris untuk umpan balik: "Dr 1-1120 Rp 9.850.000 · Cr 1-1210 Rp 10.000.000". */
export function ringkasJurnal(j: DrafJurnal): string {
  return j.lines
    .map((l) =>
      l.debit > 0n
        ? `Dr ${l.account.code} ${formatRupiah(l.debit)}`
        : `Cr ${l.account.code} ${formatRupiah(l.credit)}`,
    )
    .join(' · ');
}

/**
 * Periode akuntansi `YYYY-MM` dari tanggal ISO menurut tanggal WIB: tanggal saja (`YYYY-MM-DD`) dipakai apa adanya,
 * stempel waktu (termasuk UTC dari `toISOString()`) dikonversi ke Asia/Jakarta dulu (00.00–06.59 WIB tanggal 1 masih
 * tanggal terakhir bulan lalu di UTC). Layar membandingkan dengan daftar periode tertutup: mutasi bertanggal periode
 * tertutup tidak bisa diubah; koreksi masuk periode berjalan.
 */
export const periodeOf = (isoDate: string): string =>
  (isoDate.length > 10 ? isoDateJakarta(isoDate) : isoDate).slice(0, 7);

export function periodeTerkunci(isoDate: string, closed: readonly string[]): boolean {
  return closed.includes(periodeOf(isoDate));
}

/** Periode tertutup bawaan mode presentasi (September 2026 ditutup 2 Okt; sama dengan layar Akuntansi). */
export const PERIODE_TERTUTUP: readonly string[] = ['2026-08', '2026-09'];

const BULAN = ['Jan', 'Feb', 'Mar', 'Apr', 'Mei', 'Jun', 'Jul', 'Agu', 'Sep', 'Okt', 'Nov', 'Des'] as const;
const BULAN_PANJANG = [
  'Januari',
  'Februari',
  'Maret',
  'April',
  'Mei',
  'Juni',
  'Juli',
  'Agustus',
  'September',
  'Oktober',
  'November',
  'Desember',
] as const;

/** `2026-09` → "September 2026". */
export function labelPeriode(periode: string): string {
  const [y, m = 1] = periode.split('-').map(Number);
  return `${BULAN_PANJANG[m - 1]} ${y}`;
}

/** Tanggal kalender `YYYY-MM-DD` → "5 Okt 2026" (tanpa hari; untuk tabel jatuh tempo). */
export function tanggalPendek(iso: string): string {
  const [y, m = 1, d = 1] = iso.slice(0, 10).split('-').map(Number);
  return `${d} ${BULAN[m - 1]} ${y}`;
}

/** Selisih hari kalender `b − a` (tanggal `YYYY-MM-DD`). */
export function selisihHari(a: string, b: string): number {
  const t = (s: string) => {
    const [y = 2026, m = 1, d = 1] = s.slice(0, 10).split('-').map(Number);
    return Date.UTC(y, m - 1, d);
  };
  return Math.round((t(b) - t(a)) / 86_400_000);
}

/**
 * Bagi `total` menurut bobot bilangan bulat (mis. persen ×100) dengan sisa terbesar: Σ hasil = total tepat,
 * tanpa float. Bobot nol menghasilkan nol; semua bobot nol → semua nol kecuali total nol.
 */
export function bagiSisaTerbesar(total: bigint, weights: readonly bigint[]): bigint[] {
  const sumW = sumRupiah(weights);
  if (sumW <= 0n) return weights.map(() => 0n);
  const raw = weights.map((w) => ({ floor: (total * w) / sumW, rem: (total * w) % sumW }));
  let left = total - sumRupiah(raw.map((r) => r.floor));
  const order = raw
    .map((r, i) => ({ i, rem: r.rem }))
    .sort((a, b) => (b.rem > a.rem ? 1 : b.rem < a.rem ? -1 : a.i - b.i));
  const out = raw.map((r) => r.floor);
  for (const o of order) {
    if (left <= 0n) break;
    out[o.i] = (out[o.i] ?? 0n) + 1n;
    left -= 1n;
  }
  return out;
}

/** Persen satu desimal dari dua bigint, tanpa float: (a/b) → "12,5%". b = 0 → "—". */
export function persen(a: bigint, b: bigint): string {
  if (b === 0n) return '—';
  const neg = a < 0n !== b < 0n && a !== 0n;
  const x = a < 0n ? -a : a;
  const y = b < 0n ? -b : b;
  const tenths = (x * 1000n + y / 2n) / y;
  const s = `${tenths / 10n},${tenths % 10n}%`;
  return neg ? `−${s}` : s;
}
