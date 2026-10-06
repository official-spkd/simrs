import { formatRupiah, isoDateJakarta, JOURNAL_SOURCES, sumRupiah } from '@simrs/shared';
import { z } from 'zod';

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
  // 2-1410/2-1420 dipakai Penggajian (utang gaji, iuran BPJS): jasa pelayanan memakai 2-1440, PPh 21 bersama 2-1430.
  utangJaspel: { code: '2-1440', name: 'Utang jasa pelayanan' },
  utangPph21: { code: '2-1430', name: 'Utang PPh 21' },
  pendapatanLain: { code: '4-3100', name: 'Pendapatan lain-lain (selisih lebih kas)' },
  bebanJaspel: { code: '5-1100', name: 'Beban jasa pelayanan' },
  bebanMdr: { code: '6-1200', name: 'Beban administrasi bank (MDR EDC)' },
  bebanSelisihKas: { code: '6-1300', name: 'Beban selisih kurang kas' },
  bebanPiutang: { code: '6-3100', name: 'Beban penurunan nilai piutang' },
  potonganPenjualan: { code: '4-1950', name: 'Potongan dan penyesuaian tagihan' },
  pendapatanNonJkn: { code: '4-1300', name: 'Pendapatan layanan — non-JKN' },
  uangMuka: { code: '2-1210', name: 'Uang muka pasien' },
  piutangBpjsRj: { code: '1-1310', name: 'Piutang BPJS — RJ' },
  piutangBpjsRi: { code: '1-1320', name: 'Piutang BPJS — RI' },
  pendapatanRj: { code: '4-1100', name: 'Pendapatan RJ — JKN' },
  pendapatanRi: { code: '4-1200', name: 'Pendapatan RI — JKN' },
  selisihCbg: { code: '4-1900', name: 'Selisih tarif INA-CBG (pengurang pendapatan)' },
  bankKlaim: { code: '1-1130', name: 'Bank BTN ••••9021 — penampungan klaim BPJS' },
  utangPembiayaan: { code: '2-1310', name: 'Utang pembiayaan piutang — BTN' },
  bebanMargin: { code: '6-2100', name: 'Beban margin pembiayaan' },
} as const satisfies Record<string, AkunRef>;

const AKUN_UANG_MUKA: AkunRef = AKUN_LANJUT.uangMuka;

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

// ─── Jurnal otomatis toko demo (ADR-0085) ───────────────────────────────────────────────────────────────────

const rupiahDigits = z.string().regex(/^\d{1,15}$/);

/**
 * Jurnal otomatis yang dibawa kejadian mutasi uang domain keuangan (kasir, piutang, kas & bank, hutang, jasa pelayanan,
 * pembayaran/pembiayaan BTN). Dihitung server dengan pembentuk jurnal murni di `lib/keuangan-*.ts`, lalu dibaca
 * domain `akuntansi` lewat langganan. Skema menolak jurnal tidak seimbang (CLAUDE.md prinsip 7).
 */
export const autoJurnalSchema = z
  .strictObject({
    memo: z.string().min(1).max(200),
    source: z.enum(JOURNAL_SOURCES),
    /** Dokumen sumber, mis. "Kasir · INV-2610-02401". */
    reference: z.string().min(1).max(120),
    /** Terposting langsung, atau menunggu rekonsiliasi 3 arah (QRIS/VA TPDI × BTN). */
    status: z.enum(['terposting', 'menunggu-rekonsiliasi']),
    /** Kunci pemadanan rekonsiliasi (mis. "tpdi:INV-2610-02217"); null = tidak perlu. */
    reconKey: z.string().min(1).max(80).nullable(),
    lines: z
      .array(
        z.strictObject({
          code: z.string().regex(/^\d-\d{4}$/),
          name: z.string().min(1).max(120),
          debit: rupiahDigits,
          credit: rupiahDigits,
        }),
      )
      .min(2)
      .max(12),
  })
  .refine(
    (j) =>
      jurnalSeimbang(
        j.lines.map((l) => ({
          account: { code: l.code, name: l.name },
          debit: BigInt(l.debit),
          credit: BigInt(l.credit),
        })),
      ),
    { message: 'Jurnal tidak seimbang (debit ≠ kredit)' },
  );
export type AutoJurnal = z.infer<typeof autoJurnalSchema>;

/** Draf jurnal (bigint) → jurnal otomatis berstring untuk kejadian toko. */
export function toAutoJurnal(
  d: DrafJurnal,
  opts: Pick<AutoJurnal, 'source' | 'reference'> & Partial<Pick<AutoJurnal, 'status' | 'reconKey'>>,
): AutoJurnal {
  return {
    memo: d.memo,
    source: opts.source,
    reference: opts.reference,
    status: opts.status ?? 'terposting',
    reconKey: opts.reconKey ?? null,
    lines: d.lines.map((l) => ({
      code: l.account.code,
      name: l.account.name,
      debit: l.debit.toString(),
      credit: l.credit.toString(),
    })),
  };
}

/** Akun kas/bank penerima pembayaran pasien per metode kasir. */
export function cashAccountOf(method: 'qris' | 'va' | 'debit' | 'tunai' | 'transfer' | 'cicilan'): AkunRef {
  if (method === 'tunai') return AKUN_LANJUT.kasKasir;
  if (method === 'debit') return AKUN_LANJUT.piutangEdc;
  return AKUN_LANJUT.bankOps;
}

/**
 * Jurnal pelunasan pasien di Kasir: kas/bank (atau piutang settlement EDC) bertambah, piutang pasien berkurang.
 * QRIS/VA menunggu rekonsiliasi 3 arah TPDI × BTN (`reconKey`); metode lain langsung terposting.
 */
export function patientPaymentJournal(
  method: 'qris' | 'va' | 'debit' | 'tunai' | 'transfer' | 'cicilan',
  amount: bigint,
  invoiceNo: string,
): AutoJurnal {
  const label = {
    qris: 'QRIS via TPDI',
    va: 'VA BTN via TPDI',
    debit: 'EDC BTN (menunggu settlement)',
    tunai: 'tunai di laci kasir',
    transfer: 'transfer bank',
    cicilan: 'pencairan cicilan BTN',
  }[method];
  const tpdi = method === 'qris' || method === 'va';
  return toAutoJurnal(
    jurnal(`Pelunasan pasien ${invoiceNo} · ${label}`, [
      dr(cashAccountOf(method), amount),
      cr(AKUN_LANJUT.piutangPasien, amount),
    ]),
    {
      source: tpdi || method === 'cicilan' ? 'tpdi-btn' : 'kasir',
      reference: `Kasir · ${invoiceNo}`,
      status: tpdi ? 'menunggu-rekonsiliasi' : 'terposting',
      reconKey: tpdi ? `tpdi:${invoiceNo}` : null,
    },
  );
}

export interface PengakuanInput {
  scheme: 'bpjs' | 'asuransi' | 'umum';
  setting: 'rawat-jalan' | 'igd' | 'rawat-inap';
  hospitalTotal: bigint;
  payerPays: bigint;
  patientShare: bigint;
  /** Selisih ditanggung RS (negatif = surplus INA-CBG atas tarif RS). */
  hospitalAbsorbs: bigint;
  /** Bagian tanggungan pasien yang sudah dibayar sebagai uang muka/deposit. */
  prepaid: bigint;
}

/**
 * Pengakuan pendapatan saat kunjungan ditutup/lunas: piutang penjamin + tanggungan pasien (uang muka diterapkan) +
 * selisih ditanggung RS = pendapatan tarif RS. BPJS: selisih tarif INA-CBG di akun 4-1900; asuransi: potongan 4-1950.
 */
export function recognitionAutoJournal(i: PengakuanInput, invoiceNo: string): AutoJurnal {
  const inpatient = i.setting !== 'rawat-jalan';
  const bpjs = i.scheme === 'bpjs';
  const payerAcc = bpjs
    ? inpatient
      ? AKUN_LANJUT.piutangBpjsRi
      : AKUN_LANJUT.piutangBpjsRj
    : i.scheme === 'asuransi'
      ? AKUN_LANJUT.piutangAsuransi
      : AKUN_LANJUT.piutangPasien;
  const revenue = bpjs
    ? inpatient
      ? AKUN_LANJUT.pendapatanRi
      : AKUN_LANJUT.pendapatanRj
    : AKUN_LANJUT.pendapatanNonJkn;
  const absorbAcc = bpjs ? AKUN_LANJUT.selisihCbg : AKUN_LANJUT.potonganPenjualan;
  const prepaid = i.prepaid > i.patientShare ? i.patientShare : i.prepaid;
  return toAutoJurnal(
    jurnal(`Pengakuan pendapatan ${invoiceNo}`, [
      dr(payerAcc, i.payerPays),
      dr(AKUN_LANJUT.piutangPasien, i.patientShare - prepaid),
      dr(AKUN_LANJUT.uangMuka, prepaid),
      i.hospitalAbsorbs >= 0n ? dr(absorbAcc, i.hospitalAbsorbs) : cr(absorbAcc, -i.hospitalAbsorbs),
      cr(revenue, i.hospitalTotal),
    ]),
    { source: 'kasir', reference: `Kasir · ${invoiceNo}` },
  );
}
