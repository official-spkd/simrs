import type { AturanJaspel, TahapJaspel, TindakanJaspel } from '../../keuangan-jaspel';
import { activeVersion, componentSplit, type KelasTarif } from '../../keuangan-tarif';
import { PERSONA, STAF } from './staf';
import { TARIF_ITEMS } from './tarif';

/**
 * U08 · Data dummy jasa pelayanan (mode presentasi, ADR-0023). Komponen jasa setiap tindakan dihitung dari tarif
 * berlaku (layar Tarif): jasa medis + jasa paramedis × kuantitas. Aturan pembagian dan PPh 21 angka simulasi.
 */

export const ATURAN_JASPEL: AturanJaspel = {
  version: 'JP-2026-02 · SK direktur',
  validFrom: '2026-07-01',
  shares: [
    { id: 'pelaksana', label: 'Pelaksana (DPJP, operator, atau perawat pelaksana)', bp: 6_000 },
    { id: 'tim', label: 'Tim pendamping (perawat, bidan, penata anestesi)', bp: 2_500 },
    { id: 'bersama', label: 'Pos kebersamaan (remunerasi unit)', bp: 1_000 },
    { id: 'manajemen', label: 'Manajemen dan struktural', bp: 500 },
  ],
  pphBp: 500,
};

/** Komponen jasa (medis + paramedis) item tarif pada kelas tertentu × kuantitas. */
export function feeOf(itemCode: string, kelas: KelasTarif, qty: number): bigint {
  const item = TARIF_ITEMS.find((i) => i.code === itemCode);
  const price = item && activeVersion(item, '2026-10-05')?.prices[kelas];
  if (!item || !price) throw new Error(`Tarif ${itemCode} ${kelas} tidak ada`);
  const jasa = componentSplit(price, item.composition)
    .filter((c) => c.id === 'medis' || c.id === 'paramedis')
    .reduce((s, c) => s + c.amount, 0n);
  return jasa * BigInt(qty);
}

const ANDINI = STAF.dpjpPenyakitDalam;
const YOHANES = STAF.dpjpBedah;
const HANA = 'dr. Hana Wijayanti, Sp.OG';
const RAHMAT = 'dr. Rahmat Hidayat, Sp.PD';
const MAYA = PERSONA.perawat;
const RATIH = PERSONA.bidan;

export const TINDAKAN_JASPEL: readonly TindakanJaspel[] = [
  {
    id: 'jp-01',
    date: '2026-10-05',
    patient: 'Ny. Endang Wijaya',
    service: 'Visite spesialis Kelas 2 × 5',
    payer: 'bpjs',
    ppa: ANDINI,
    team: MAYA,
    fee: feeOf('VST-SP', 'k2', 5),
    claim: { paid: false, cbgPaid: 0n, hospitalTariff: 17_217_500n, number: 'klaim RI Okt (belum dikirim)' },
  },
  {
    id: 'jp-02',
    date: '2026-10-05',
    patient: 'Ny. Endang Wijaya',
    service: 'Pemasangan kateter urin Kelas 2 × 2',
    payer: 'bpjs',
    ppa: MAYA,
    team: MAYA,
    fee: feeOf('TND-KAT', 'k2', 2),
    claim: { paid: false, cbgPaid: 0n, hospitalTariff: 17_217_500n, number: 'klaim RI Okt (belum dikirim)' },
  },
  {
    id: 'jp-03',
    date: '2026-10-05',
    patient: 'Tn. Fajar Nugraha',
    service: 'Operator dan anestesi bedah sedang Kelas 1',
    payer: 'asuransi',
    ppa: YOHANES,
    team: 'dr. Ferry Setiawan, Sp.An',
    fee: feeOf('OK-OPAN', 'k1', 1),
  },
  {
    id: 'jp-04',
    date: '2026-10-05',
    patient: 'Tn. Darmawan Putra',
    service: 'Konsultasi spesialis rawat jalan',
    payer: 'asuransi',
    ppa: ANDINI,
    team: MAYA,
    fee: feeOf('KNS-SP', 'k2', 1),
  },
  {
    id: 'jp-05',
    date: '2026-10-02',
    patient: 'Ny. Anisa Rahmadani',
    service: 'Pertolongan persalinan normal Kelas 3',
    payer: 'bpjs',
    ppa: HANA,
    team: RATIH,
    fee: feeOf('VK-PN', 'k3', 1),
    claim: {
      paid: true,
      cbgPaid: 2_160_000n,
      hospitalTariff: 2_410_000n,
      number: 'klaim RI Sep, dibayar 3 Okt',
    },
  },
  {
    id: 'jp-06',
    date: '2026-10-03',
    patient: 'Ny. Rohana Siregar',
    service: 'Visite spesialis Kelas 2 × 4',
    payer: 'bpjs',
    ppa: RAHMAT,
    team: MAYA,
    fee: feeOf('VST-SP', 'k2', 4),
    claim: {
      paid: true,
      cbgPaid: 5_420_000n,
      hospitalTariff: 6_180_000n,
      number: 'klaim RI Sep, dibayar 3 Okt',
    },
  },
  {
    id: 'jp-07',
    date: '2026-10-04',
    patient: 'Tn. Gilang Mahendra',
    service: 'Konsultasi spesialis rawat jalan',
    payer: 'umum',
    ppa: RAHMAT,
    team: MAYA,
    fee: feeOf('KNS-SP', 'k2', 1),
  },
  {
    id: 'jp-08',
    date: '2026-10-05',
    patient: 'Tn. Sutan Batubara',
    service: 'Visite spesialis VIP × 2',
    payer: 'bpjs',
    ppa: 'dr. Bagus Santoso, Sp.JP',
    team: MAYA,
    fee: feeOf('VST-SP', 'vip', 2),
    claim: { paid: false, cbgPaid: 0n, hospitalTariff: 24_860_000n, number: 'masih dirawat' },
  },
];

/** Rekap September 2026: sudah dibayar 2 Okt dan periode ditutup (hanya baca). */
export const REKAP_SEPTEMBER = {
  period: 'September 2026',
  paidAt: '2026-10-02T15:30:00+07:00',
  gross: 1_420_000_000n,
  pph: 71_000_000n,
  ppaCount: 214,
} as const;

/** Keadaan awal rekap Oktober: sudah diverifikasi akuntan pagi ini, menunggu persetujuan manajemen. */
export const JASPEL_START: {
  stage: TahapJaspel;
  log: Partial<Record<TahapJaspel, { by: string; at: string }>>;
} = {
  stage: 'diverifikasi',
  log: { diverifikasi: { by: PERSONA.akuntan, at: '2026-10-05T09:30:00+07:00' } },
};
