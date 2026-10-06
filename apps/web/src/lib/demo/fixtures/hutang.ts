import type { FakturPemasok } from '../../keuangan-hutang';
import { ACCOUNTING_KPIS } from './keuangan';
import { PERSONA } from './staf';

/**
 * U10 · Data dummy hutang usaha (mode presentasi, ADR-0023). PO dan pemasok generik sama dengan layar Logistik
 * (PO-2609-117 reagen diterima, PO-2610-028 cairan infus tiba 5 Okt). KPI jatuh tempo 7 hari seluruh pemasok sama
 * dengan layar Akuntansi; daftar di bawahnya adalah contoh worklist. Nominal fiktif.
 */

const at = (date: string, hm: string) => `${date}T${hm.replace('.', ':')}:00+07:00`;
const MANAJER_KEUANGAN = 'Wulandari Kusuma, S.E. (manajer keuangan)';

const f = (
  x: Omit<FakturPemasok, 'verifiedBy' | 'approvals' | 'varianceNote' | 'paidAt' | 'paymentBatch'> &
    Partial<FakturPemasok>,
): FakturPemasok => ({
  verifiedBy: null,
  approvals: [],
  varianceNote: null,
  paidAt: null,
  paymentBatch: null,
  ...x,
});

export const FAKTUR_PEMASOK: readonly FakturPemasok[] = [
  f({
    id: 'fp-01',
    invoiceNo: 'INV/DFA/2610/0331',
    supplier: 'Distributor farmasi A',
    poNumber: 'PO-2610-028',
    grnNumber: 'GRN-2610-0144',
    title: 'Cairan infus (tiba 5 Okt)',
    receivedAt: at('2026-10-05', '08.40'),
    invoiceDate: '2026-10-05',
    dueDate: '2026-11-04',
    poAmount: 96_000_000n,
    grnAmount: 96_000_000n,
    invoiceAmount: 96_480_000n,
    status: 'draf',
  }),
  f({
    id: 'fp-02',
    invoiceNo: 'KSO/R/2609/118',
    supplier: 'Mitra KSO reagen',
    poNumber: 'PO-2609-117',
    grnNumber: 'GRN-2609-0981',
    title: 'Reagen kimia klinik',
    receivedAt: at('2026-09-29', '13.10'),
    invoiceDate: '2026-10-01',
    dueDate: '2026-10-31',
    poAmount: 63_200_000n,
    grnAmount: 63_200_000n,
    invoiceAmount: 63_200_000n,
    status: 'draf',
  }),
  f({
    id: 'fp-03',
    invoiceNo: 'EK/2609/55120',
    supplier: 'Penyedia e-katalog',
    poNumber: 'PO-2609-102',
    grnNumber: 'GRN-2609-0905',
    title: 'Obat kronis JKN (PRB)',
    receivedAt: at('2026-09-18', '10.00'),
    invoiceDate: '2026-09-19',
    dueDate: '2026-10-09',
    poAmount: 184_000_000n,
    grnAmount: 184_000_000n,
    invoiceAmount: 184_000_000n,
    status: 'diverifikasi',
    verifiedBy: PERSONA.akuntan,
    approvals: [{ level: 1, by: MANAJER_KEUANGAN, at: at('2026-10-02', '11.20') }],
  }),
  f({
    id: 'fp-04',
    invoiceNo: 'INV/DAB/2609/2210',
    supplier: 'Distributor alkes B',
    poNumber: 'PO-2609-098',
    grnNumber: 'GRN-2609-0877',
    title: 'Kateter dan set infus',
    receivedAt: at('2026-09-15', '09.30'),
    invoiceDate: '2026-09-16',
    dueDate: '2026-10-08',
    poAmount: 48_750_000n,
    grnAmount: 48_750_000n,
    invoiceAmount: 48_750_000n,
    status: 'disetujui',
    verifiedBy: PERSONA.akuntan,
    approvals: [{ level: 1, by: MANAJER_KEUANGAN, at: at('2026-09-30', '14.05') }],
  }),
  f({
    id: 'fp-05',
    invoiceNo: 'INV/DFA/2609/0288',
    supplier: 'Distributor farmasi A',
    poNumber: 'PO-2609-085',
    grnNumber: 'GRN-2609-0802',
    title: 'Antibiotik injeksi',
    receivedAt: at('2026-09-08', '10.15'),
    invoiceDate: '2026-09-09',
    dueDate: '2026-10-03',
    poAmount: 12_300_000n,
    grnAmount: 12_300_000n,
    invoiceAmount: 12_300_000n,
    status: 'disetujui',
    verifiedBy: PERSONA.akuntan,
    approvals: [{ level: 1, by: MANAJER_KEUANGAN, at: at('2026-09-25', '10.40') }],
  }),
  f({
    id: 'fp-06',
    invoiceNo: 'INV/DAB/2608/1987',
    supplier: 'Distributor alkes B',
    poNumber: 'PO-2608-140',
    grnNumber: 'GRN-2608-1110',
    title: 'Linen dan BHP bangsal',
    receivedAt: at('2026-08-25', '09.00'),
    invoiceDate: '2026-08-26',
    dueDate: '2026-09-25',
    poAmount: 31_500_000n,
    grnAmount: 31_500_000n,
    invoiceAmount: 31_500_000n,
    status: 'dibayar',
    verifiedBy: PERSONA.akuntan,
    approvals: [{ level: 1, by: MANAJER_KEUANGAN, at: at('2026-09-20', '09.10') }],
    paidAt: at('2026-09-25', '10.00'),
    paymentBatch: 'BYR-2609-014',
  }),
];

export const HUTANG_SUMMARY = {
  due7dAll: BigInt(ACCOUNTING_KPIS.payablesDue7d),
  suppliersDue: ACCOUNTING_KPIS.suppliersDue,
  bankMitraBalance: 1_850_000_000n,
  nextBatchSeq: 3,
} as const;
