import { AKUN_LANJUT as A } from '../../keuangan-jurnal';
import type { Laci, MutasiBank } from '../../keuangan-kasbank';
import { KASIR_SHIFT } from './keuangan';
import { REKENING } from './rs';
import { PERSONA } from './staf';

/**
 * U09 · Data dummy kas dan bank (mode presentasi, ADR-0023). Laci loket 1 sama dengan shift Kasir (modal
 * Rp 500.000, dibuka 07.00). Mutasi BTN operasional di sini adalah mutasi baru setelah sinkron 10.30 (layar
 * Akuntansi mencatat rekening ini cocok sampai 10.30). Nominal fiktif.
 */

const at = (hm: string, date = '2026-10-05') => `${date}T${hm.replace('.', ':')}:00+07:00`;

export const LACI: readonly Laci[] = [
  {
    id: 'laci-1',
    counter: 'Loket 1 · RJ dan RI',
    cashier: PERSONA.kasir,
    status: 'buka',
    openedAt: at('07.00'),
    float: BigInt(KASIR_SHIFT.openingCash),
    transactions: [
      { id: 't1', at: at('07.48'), label: 'INV-2610-02201 · tunai (kembalian Rp 4.000)', amount: 96_000n },
      { id: 't2', at: at('08.15'), label: 'INV-2610-02206 · tunai', amount: 463_500n },
      { id: 't3', at: at('08.52'), label: 'INV-2610-02207 · deposit rawat inap tunai', amount: 2_000_000n },
      { id: 't4', at: at('09.20'), label: 'INV-2610-02211 · tunai (kembalian Rp 1.500)', amount: 248_500n },
      { id: 't5', at: at('09.41'), label: 'RF-2610-0012 · refund tunai sisa deposit', amount: -350_000n },
      { id: 't6', at: at('10.12'), label: 'INV-2610-02214 · tunai', amount: 1_250_400n },
    ],
  },
  {
    id: 'laci-2',
    counter: 'Loket 2 · IGD (24 jam)',
    cashier: 'Sri Lestari (kasir IGD)',
    status: 'buka',
    openedAt: at('07.00'),
    float: 1_000_000n,
    transactions: [{ id: 'i1', at: at('08.05'), label: 'INV-2610-02202 · tunai', amount: 315_000n }],
  },
  {
    id: 'laci-3',
    counter: 'Loket 3 · rawat jalan sore',
    cashier: 'Dimas Pratama (kasir sore)',
    status: 'tutup',
    openedAt: null,
    float: 500_000n,
    transactions: [],
    lastClose: {
      at: at('21.05', '2026-10-04'),
      physical: 4_118_000n,
      expected: 4_120_000n,
      reason: 'Kembalian pecahan Rp 2.000 terlebih pada satu transaksi; disaksikan supervisor',
    },
  },
];

const EDC = { code: A.piutangEdc.code, name: A.piutangEdc.name };

export const MUTASI_BANK: readonly MutasiBank[] = [
  {
    id: 'mb-0',
    at: at('15.00', '2026-09-30'),
    description: 'BUNGA JASA GIRO SEP 2026',
    amount: 1_284_000n,
    status: 'cocok',
    matchedTo: 'Pendapatan bunga September (jurnal JU-2609-04122)',
    note: null,
    candidates: [],
  },
  {
    id: 'mb-1',
    at: at('10.31'),
    description: 'SETORAN TUNAI LOKET 2 IGD STR-2610-0409',
    amount: 3_215_000n,
    status: 'cocok',
    matchedTo: 'Setoran kas loket 2 shift malam (otomatis, nomor setoran)',
    note: null,
    candidates: [],
  },
  {
    id: 'mb-2',
    at: at('10.36'),
    description: 'SETTLEMENT EDC BTN TID RI-01 BATCH 0412',
    amount: 9_850_000n,
    status: 'belum',
    matchedTo: null,
    note: null,
    candidates: [
      {
        id: 'k-edc',
        kind: 'edc',
        label: 'Batch EDC RI-01 4 Okt · 7 transaksi (MDR 1,5%)',
        amount: 10_000_000n,
        fee: 150_000n,
        account: EDC,
      },
    ],
  },
  {
    id: 'mb-3',
    at: at('10.40'),
    description: 'TRF ASURANSI MITRA A TG-2609-031',
    amount: 14_800_000n,
    status: 'belum',
    matchedTo: null,
    note: null,
    candidates: [
      {
        id: 'k-tg',
        kind: 'penjamin',
        label: 'Sisa batch penagihan TG-2609-031 (Asuransi Mitra A)',
        amount: 14_800_000n,
        account: A.piutangAsuransi,
      },
    ],
  },
  {
    id: 'mb-4',
    at: at('10.44'),
    description: 'TRF MASUK TANPA BERITA',
    amount: 142_500n,
    status: 'belum',
    matchedTo: null,
    note: null,
    candidates: [],
  },
  {
    id: 'mb-5',
    at: at('10.45'),
    description: 'BIAYA ADM REKENING OKT',
    amount: -25_000n,
    status: 'belum',
    matchedTo: null,
    note: null,
    candidates: [
      {
        id: 'k-adm',
        kind: 'biaya-bank',
        label: 'Biaya administrasi rekening Oktober',
        amount: 25_000n,
        account: { code: '6-1210', name: 'Beban administrasi rekening bank' },
      },
    ],
  },
];

export const REKENING_KORAN = {
  account: `BTN ${REKENING.operasional} · operasional`,
  balance: 2_418_336_500n,
  syncedAt: at('10.45'),
} as const;
