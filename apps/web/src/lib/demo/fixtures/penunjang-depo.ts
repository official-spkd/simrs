import type { Balance, DepoMaster, DepoState, Movement } from '../../penunjang-depo';
import { PERSONA, STAF_LAIN } from './staf';
import { DEMO_TODAY, shiftDate } from './waktu';

/**
 * S05 · Data dummy depo dan stok farmasi (ADR-0023). Lima lokasi stok (gudang + 4 depo), obat dengan KFA hanya dari
 * contoh seed (selain itu "KFA belum dipetakan"), batch dengan ED relatif terhadap hari demo: satu batch
 * kedaluwarsa (Omeprazol OMZ2509 di depo rawat inap), beberapa segera ED, dan batch gudang yang sama dengan layar
 * Logistik (ENX2603A, CFX2511/CFX2602, OMZ2602, PCT2512/PCT2605). Pemasok = nama generik fiktif.
 */

const ed = (days: number) => shiftDate(DEMO_TODAY, days);
const at = (hhmm: string) => `${DEMO_TODAY}T${hhmm.replace('.', ':')}:00+07:00`;

export const DEPO_MASTER: DepoMaster = {
  depots: [
    { id: 'dp-gudang', name: 'Gudang farmasi', kind: 'gudang' },
    { id: 'dp-rj', name: 'Depo rawat jalan', kind: 'depo' },
    { id: 'dp-ri', name: 'Depo rawat inap', kind: 'depo' },
    { id: 'dp-igd', name: 'Depo IGD', kind: 'depo' },
    { id: 'dp-ok', name: 'Depo kamar operasi', kind: 'depo' },
  ],
  items: [
    {
      id: 'it-enox',
      name: 'Enoksaparin 60 mg/0,6 mL injeksi',
      kfa: '93002210',
      unit: 'spuit',
      highAlert: true,
      minPerDepot: 10,
    },
    {
      id: 'it-omz',
      name: 'Omeprazol 40 mg injeksi',
      kfa: '93001152',
      unit: 'vial',
      highAlert: false,
      minPerDepot: 15,
    },
    {
      id: 'it-cfx',
      name: 'Seftriakson 1 g injeksi',
      kfa: null,
      unit: 'vial',
      highAlert: false,
      minPerDepot: 30,
    },
    {
      id: 'it-biso',
      name: 'Bisoprolol 2,5 mg tablet',
      kfa: '93000655',
      unit: 'tablet',
      highAlert: false,
      minPerDepot: 100,
    },
    {
      id: 'it-ator',
      name: 'Atorvastatin 40 mg tablet',
      kfa: '93000914',
      unit: 'tablet',
      highAlert: false,
      minPerDepot: 100,
    },
    {
      id: 'it-klop',
      name: 'Klopidogrel 75 mg tablet',
      kfa: '93000387',
      unit: 'tablet',
      highAlert: false,
      minPerDepot: 100,
    },
    {
      id: 'it-pct',
      name: 'Parasetamol infus 1 g/100 mL',
      kfa: null,
      unit: 'flakon',
      highAlert: false,
      minPerDepot: 20,
    },
    {
      id: 'it-metf',
      name: 'Metformin 500 mg tablet',
      kfa: null,
      unit: 'tablet',
      highAlert: false,
      minPerDepot: 200,
    },
  ],
  batches: [
    {
      id: 'bt-enx2512',
      itemId: 'it-enox',
      batchNo: 'ENX2512',
      expiry: ed(38),
      unitCost: '138000',
      supplier: 'Distributor farmasi A',
    },
    {
      id: 'bt-enx2603a',
      itemId: 'it-enox',
      batchNo: 'ENX2603A',
      expiry: ed(212),
      unitCost: '138000',
      supplier: 'Distributor farmasi A',
    },
    {
      id: 'bt-omz2509',
      itemId: 'it-omz',
      batchNo: 'OMZ2509',
      expiry: ed(-3),
      unitCost: '14500',
      supplier: 'Penyedia e-katalog',
    },
    {
      id: 'bt-omz2602',
      itemId: 'it-omz',
      batchNo: 'OMZ2602',
      expiry: ed(140),
      unitCost: '14500',
      supplier: 'Penyedia e-katalog',
    },
    {
      id: 'bt-cfx2510',
      itemId: 'it-cfx',
      batchNo: 'CFX2510',
      expiry: ed(62),
      unitCost: '9800',
      supplier: 'Penyedia e-katalog',
    },
    {
      id: 'bt-cfx2511',
      itemId: 'it-cfx',
      batchNo: 'CFX2511',
      expiry: ed(150),
      unitCost: '9800',
      supplier: 'Penyedia e-katalog',
    },
    {
      id: 'bt-cfx2602',
      itemId: 'it-cfx',
      batchNo: 'CFX2602',
      expiry: ed(268),
      unitCost: '9800',
      supplier: 'Penyedia e-katalog',
    },
    {
      id: 'bt-bsp2604',
      itemId: 'it-biso',
      batchNo: 'BSP2604',
      expiry: ed(200),
      unitCost: '620',
      supplier: 'Distributor farmasi A',
    },
    {
      id: 'bt-bsp2701',
      itemId: 'it-biso',
      batchNo: 'BSP2701',
      expiry: ed(460),
      unitCost: '620',
      supplier: 'Distributor farmasi A',
    },
    {
      id: 'bt-atv2512',
      itemId: 'it-ator',
      batchNo: 'ATV2512',
      expiry: ed(70),
      unitCost: '1450',
      supplier: 'Distributor farmasi A',
    },
    {
      id: 'bt-atv2608',
      itemId: 'it-ator',
      batchNo: 'ATV2608',
      expiry: ed(300),
      unitCost: '1450',
      supplier: 'Distributor farmasi A',
    },
    {
      id: 'bt-klp2605',
      itemId: 'it-klop',
      batchNo: 'KLP2605',
      expiry: ed(230),
      unitCost: '1100',
      supplier: 'Distributor farmasi A',
    },
    {
      id: 'bt-pct2512',
      itemId: 'it-pct',
      batchNo: 'PCT2512',
      expiry: ed(95),
      unitCost: '21000',
      supplier: 'Penyedia e-katalog',
    },
    {
      id: 'bt-pct2605',
      itemId: 'it-pct',
      batchNo: 'PCT2605',
      expiry: ed(240),
      unitCost: '21000',
      supplier: 'Penyedia e-katalog',
    },
    {
      id: 'bt-mtf2603',
      itemId: 'it-metf',
      batchNo: 'MTF2603',
      expiry: ed(170),
      unitCost: '230',
      supplier: 'Penyedia e-katalog',
    },
  ],
};

/** Saldo pukul 10.45 per depo × batch. */
const BALANCES: readonly Balance[] = [
  { depotId: 'dp-gudang', batchId: 'bt-enx2603a', qty: 46 },
  { depotId: 'dp-gudang', batchId: 'bt-omz2602', qty: 150 },
  { depotId: 'dp-gudang', batchId: 'bt-cfx2511', qty: 110 },
  { depotId: 'dp-gudang', batchId: 'bt-cfx2602', qty: 200 },
  { depotId: 'dp-gudang', batchId: 'bt-bsp2701', qty: 900 },
  { depotId: 'dp-gudang', batchId: 'bt-atv2608', qty: 600 },
  { depotId: 'dp-gudang', batchId: 'bt-klp2605', qty: 400 },
  { depotId: 'dp-gudang', batchId: 'bt-pct2512', qty: 20 },
  { depotId: 'dp-gudang', batchId: 'bt-pct2605', qty: 120 },
  { depotId: 'dp-rj', batchId: 'bt-bsp2604', qty: 120 },
  { depotId: 'dp-rj', batchId: 'bt-bsp2701', qty: 300 },
  { depotId: 'dp-rj', batchId: 'bt-atv2512', qty: 60 },
  { depotId: 'dp-rj', batchId: 'bt-atv2608', qty: 200 },
  { depotId: 'dp-rj', batchId: 'bt-klp2605', qty: 90 },
  { depotId: 'dp-rj', batchId: 'bt-mtf2603', qty: 450 },
  { depotId: 'dp-ri', batchId: 'bt-enx2512', qty: 8 },
  { depotId: 'dp-ri', batchId: 'bt-enx2603a', qty: 12 },
  { depotId: 'dp-ri', batchId: 'bt-omz2509', qty: 6 },
  { depotId: 'dp-ri', batchId: 'bt-omz2602', qty: 24 },
  { depotId: 'dp-ri', batchId: 'bt-cfx2510', qty: 14 },
  { depotId: 'dp-ri', batchId: 'bt-cfx2511', qty: 40 },
  { depotId: 'dp-ri', batchId: 'bt-pct2512', qty: 22 },
  { depotId: 'dp-ri', batchId: 'bt-pct2605', qty: 30 },
  { depotId: 'dp-igd', batchId: 'bt-enx2512', qty: 4 },
  { depotId: 'dp-igd', batchId: 'bt-omz2602', qty: 10 },
  { depotId: 'dp-igd', batchId: 'bt-cfx2511', qty: 12 },
  { depotId: 'dp-ok', batchId: 'bt-pct2512', qty: 18 },
];

/** Transaksi pagi ini (sebelum 10.45) untuk kartu stok; saldo awal = saldo akhir + pengeluaran. */
const EARLIER: ReadonlyArray<Omit<Movement, 'id'>> = [
  {
    at: at('07.40'),
    kind: 'keluar',
    depotId: 'dp-ri',
    batchId: 'bt-cfx2510',
    qty: -4,
    ref: 'UDD pagi · Bangsal Melati',
    by: STAF_LAIN.apoteker[0] ?? PERSONA.apoteker,
  },
  {
    at: at('08.05'),
    kind: 'keluar',
    depotId: 'dp-ri',
    batchId: 'bt-omz2602',
    qty: -6,
    ref: 'UDD pagi · Anggrek, ICU',
    by: STAF_LAIN.apoteker[0] ?? PERSONA.apoteker,
  },
  {
    at: at('08.32'),
    kind: 'keluar',
    depotId: 'dp-ri',
    batchId: 'bt-enx2512',
    qty: -2,
    ref: 'UDD pagi · Anggrek A-15 (cek ganda)',
    by: STAF_LAIN.apoteker[0] ?? PERSONA.apoteker,
  },
  {
    at: at('09.12'),
    kind: 'keluar',
    depotId: 'dp-rj',
    batchId: 'bt-bsp2604',
    qty: -30,
    ref: 'Resep PRB Poli Jantung',
    by: PERSONA.apoteker,
  },
  {
    at: at('09.47'),
    kind: 'keluar',
    depotId: 'dp-rj',
    batchId: 'bt-atv2512',
    qty: -30,
    ref: 'Resep PRB Poli PD',
    by: PERSONA.apoteker,
  },
  {
    at: at('10.05'),
    kind: 'keluar',
    depotId: 'dp-igd',
    batchId: 'bt-cfx2511',
    qty: -2,
    ref: 'IGD B4 · resep anak',
    by: STAF_LAIN.apoteker[0] ?? PERSONA.apoteker,
  },
];

export function demoDepoState(): DepoState {
  const outs = new Map<string, number>();
  for (const m of EARLIER)
    outs.set(`${m.depotId}|${m.batchId}`, (outs.get(`${m.depotId}|${m.batchId}`) ?? 0) - m.qty);
  const opening: Movement[] = BALANCES.map((b, i) => ({
    id: `mv-awal-${String(i + 1).padStart(2, '0')}`,
    at: at('07.00'),
    kind: 'awal',
    depotId: b.depotId,
    batchId: b.batchId,
    qty: b.qty + (outs.get(`${b.depotId}|${b.batchId}`) ?? 0),
    ref: 'Saldo tutup shift malam',
    by: 'Sistem',
  }));
  const earlier: Movement[] = EARLIER.map((m, i) => ({
    ...m,
    id: `mv-pagi-${String(i + 1).padStart(2, '0')}`,
  }));
  return {
    balances: BALANCES.map((b) => ({ ...b })),
    movements: [...earlier].reverse().concat(opening),
    transfers: [],
  };
}

/** Permintaan yang menunggu disiapkan per depo (resep/UDD/permintaan ruangan); mengisi formulir pengeluaran. */
export const DEPO_REQUESTS: ReadonlyArray<{
  id: string;
  depotId: string;
  itemId: string;
  qty: number;
  ref: string;
}> = [
  {
    id: 'rq-1',
    depotId: 'dp-ri',
    itemId: 'it-cfx',
    qty: 10,
    ref: 'UDD siang · Ny. Endang Wijaya (Melati M-203)',
  },
  {
    id: 'rq-2',
    depotId: 'dp-ri',
    itemId: 'it-omz',
    qty: 4,
    ref: 'UDD siang · Tn. Yusuf Hidayat (Anggrek A-15)',
  },
  { id: 'rq-3', depotId: 'dp-ri', itemId: 'it-enox', qty: 2, ref: 'UDD sore · Tn. Sutan Batubara (VIP 2)' },
  { id: 'rq-4', depotId: 'dp-rj', itemId: 'it-klop', qty: 30, ref: 'Resep PRB · Tn. Bonifasius Tarigan' },
  { id: 'rq-5', depotId: 'dp-ok', itemId: 'it-pct', qty: 4, ref: 'Paket BHP OK 3 · SC cito 11.00' },
];
