import type { BatchTagihan, PembagianInput, Penyesuaian, PiutangItem } from '../../keuangan-piutang';
import { INVOICE_ID } from './ids';
import { CBG, STATIC_INVOICES } from './keuangan';
import { pasienRef, type PasienRef } from './keuangan-ref';

/**
 * U04 · Data dummy Penjaminan dan piutang (mode presentasi, ADR-0023). Contoh pembagian penjamin memakai tagihan
 * Kasir yang sama (Ny. Endang, Ny. Ayu) dan tarif INA-CBG simulasi bersama (`CBG`). Umur piutang per penjamin
 * memakai angka yang sama dengan layar Akuntansi (`AGING`); daftar piutang per penjamin di bawahnya adalah contoh.
 * Nama penjamin generik dan fiktif.
 */

const total = (invoiceId: string): bigint =>
  BigInt(STATIC_INVOICES.find((i) => i.id === invoiceId)?.split.hospitalTotal ?? '0');

export interface ContohPembagian {
  id: string;
  patient: PasienRef;
  service: string;
  payerLabel: string;
  input: PembagianInput;
}

export const CONTOH_PEMBAGIAN: readonly ContohPembagian[] = [
  {
    id: 'sp-endang',
    patient: pasienRef('endang', 'Rawat inap 1–5 Okt · Melati M-203', 'BPJS kelas 2'),
    service: `Pneumonia sedang · INA-CBG ${CBG.pneumoniaSedangK2.code} · naik Kelas 1 dua malam pertama`,
    payerLabel: 'BPJS Kesehatan · hak Kelas 2',
    input: {
      scheme: 'bpjs',
      total: total(INVOICE_ID.endang),
      cbgHak: CBG.pneumoniaSedangK2.tariff,
      cbgK1: CBG.pneumoniaSedangK1.tariff,
      upgrade: 'k1',
    },
  },
  {
    id: 'sp-sutan',
    patient: pasienRef('sutan', 'Rawat inap · VIP 2', 'BPJS kelas 1'),
    service: `Infark miokard akut · INA-CBG ${CBG.imaK1.code} · naik ke VIP atas permintaan sendiri`,
    payerLabel: 'BPJS Kesehatan · hak Kelas 1',
    input: {
      scheme: 'bpjs',
      total: 24_860_000n,
      cbgHak: CBG.imaK1.tariff,
      cbgK1: CBG.imaK1.tariff,
      upgrade: 'vip',
    },
  },
  {
    id: 'sp-darmawan',
    patient: pasienRef('darmawan', 'Rawat inap 8–12 Sep · Anggrek', 'Asuransi swasta'),
    service: 'Stroke iskemik · surat jaminan plafon Rp 15.000.000 · obat non-formularium tidak ditanggung',
    payerLabel: 'Asuransi Mitra A',
    input: { scheme: 'asuransi', total: 18_450_000n, plafon: 15_000_000n, nonCovered: 650_000n },
  },
  {
    id: 'sp-ayu',
    patient: pasienRef('ayu', 'Rawat jalan · loket K-011', 'Umum'),
    service: 'Konsultasi, laboratorium, dan obat (tagihan di Kasir)',
    payerLabel: 'Umum (bayar sendiri)',
    input: { scheme: 'umum', total: total(INVOICE_ID.ayu) },
  },
];

const A = 'Asuransi Mitra A';
const B = 'Asuransi Mitra B';
const C = 'PT Mitra Industri C';

export const PIUTANG_ITEMS: readonly PiutangItem[] = [
  {
    id: 'pi-01',
    payerGroup: 'asuransi',
    payerName: A,
    patient: 'Tn. Darmawan Putra',
    invoiceNo: 'INV-2609-01888',
    invoiceDate: '2026-09-12',
    amount: 15_000_000n,
    paid: 10_000_000n,
    batch: 'TG-2609-031',
  },
  {
    id: 'pi-02',
    payerGroup: 'asuransi',
    payerName: A,
    patient: 'Tn. Fajar Nugraha',
    invoiceNo: 'INV-2609-01902',
    invoiceDate: '2026-09-14',
    amount: 9_800_000n,
    paid: 0n,
    batch: 'TG-2609-031',
  },
  {
    id: 'pi-03',
    payerGroup: 'asuransi',
    payerName: A,
    patient: 'Ny. Fransiska Lumbantobing',
    invoiceNo: 'INV-2610-02190',
    invoiceDate: '2026-10-01',
    amount: 6_450_000n,
    paid: 0n,
    batch: null,
  },
  {
    id: 'pi-04',
    payerGroup: 'asuransi',
    payerName: A,
    patient: 'Tn. Darmawan Putra',
    invoiceNo: 'INV-2610-02205',
    invoiceDate: '2026-10-03',
    amount: 2_180_000n,
    paid: 0n,
    batch: null,
  },
  {
    id: 'pi-05',
    payerGroup: 'asuransi',
    payerName: B,
    patient: 'Tn. Fajar Nugraha',
    invoiceNo: 'INV-2610-02244',
    invoiceDate: '2026-10-05',
    amount: 5_000_000n,
    paid: 0n,
    batch: null,
  },
  {
    id: 'pi-06',
    payerGroup: 'asuransi',
    payerName: B,
    patient: 'Tn. Gilang Mahendra',
    invoiceNo: 'INV-2607-01120',
    invoiceDate: '2026-07-02',
    amount: 3_250_000n,
    paid: 0n,
    batch: 'TG-2607-018',
  },
  {
    id: 'pi-07',
    payerGroup: 'kerja-sama',
    payerName: C,
    patient: 'Ny. Sumarni Pakpahan',
    invoiceNo: 'INV-2609-01950',
    invoiceDate: '2026-09-20',
    amount: 1_875_000n,
    paid: 0n,
    batch: null,
  },
  {
    id: 'pi-08',
    payerGroup: 'kerja-sama',
    payerName: C,
    patient: 'Tn. Lukman Hakim',
    invoiceNo: 'INV-2608-01500',
    invoiceDate: '2026-08-14',
    amount: 4_120_000n,
    paid: 0n,
    batch: 'TG-2608-022',
  },
  {
    id: 'pi-09',
    payerGroup: 'umum',
    payerName: 'Pasien',
    patient: 'Tn. Robert Manurung',
    invoiceNo: 'INV-2609-01990',
    invoiceDate: '2026-09-28',
    amount: 750_000n,
    paid: 0n,
    batch: null,
  },
];

export const BATCH_TAGIHAN: readonly BatchTagihan[] = [
  {
    number: 'TG-2609-031',
    payerName: A,
    payerGroup: 'asuransi',
    itemIds: ['pi-01', 'pi-02'],
    status: 'sebagian',
    sentAt: '2026-09-16T10:20:00+07:00',
    payments: [
      { id: 'py-1', at: '2026-09-28T14:05:00+07:00', amount: 10_000_000n, reference: 'BTN-H2H-2609-88412' },
    ],
  },
  {
    number: 'TG-2608-022',
    payerName: C,
    payerGroup: 'kerja-sama',
    itemIds: ['pi-08'],
    status: 'ditagih',
    sentAt: '2026-08-18T09:00:00+07:00',
    payments: [],
  },
  {
    number: 'TG-2607-018',
    payerName: B,
    payerGroup: 'asuransi',
    itemIds: ['pi-06'],
    status: 'ditagih',
    sentAt: '2026-07-06T11:30:00+07:00',
    payments: [],
  },
];

/** Nomor batch penagihan berikutnya bulan Oktober. */
export const NEXT_BATCH_SEQ = 5;

export const PENYESUAIAN: readonly Penyesuaian[] = [
  {
    id: 'aj-03',
    number: 'AJ-2610-003',
    itemId: 'pi-06',
    kind: 'hapus-buku',
    amount: 3_250_000n,
    reason:
      'Penjamin menolak dua kali (polis tidak aktif saat rawat); pasien tidak dapat dihubungi, umur > 90 hari.',
    maker: 'Rina Oktaviani (staf piutang)',
    createdAt: '2026-10-04T15:10:00+07:00',
    status: 'menunggu',
  },
];
