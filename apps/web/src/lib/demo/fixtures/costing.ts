import type { KasusCosting } from '../../keuangan-costing';
import { CBG } from './keuangan';
import { STAF } from './staf';

/**
 * I10 · Data dummy costing dan case-mix (mode presentasi, ADR-0023): rata-rata biaya per kasus kuartal III 2026
 * (Jul–Sep, periode tertutup) per kelompok INA-CBG dan DPJP. Tarif INA-CBG simulasi sama dengan Kasir dan Klaim
 * (`CBG`). Biaya fiktif dan ilustratif.
 */

const cbg = (c: { code: string; name: string; classLabel: string; tariff: bigint }) => ({
  cbg: { code: c.code, name: c.name, classLabel: c.classLabel },
  tariff: c.tariff,
});
const cost = (akomodasi: bigint, tindakan: bigint, obat: bigint, penunjang: bigint, overhead: bigint) => ({
  akomodasi,
  tindakan,
  obat,
  penunjang,
  overhead,
});

export const COSTING_PERIOD = 'Kuartal III 2026 (Jul–Sep) · periode tertutup';

export const KASUS_COSTING: readonly KasusCosting[] = [
  {
    id: 'cs-1',
    ...cbg(CBG.pneumoniaSedangK2),
    group: 'Pneumonia',
    dpjp: STAF.dpjpPenyakitDalam,
    smf: 'SMF Penyakit dalam',
    cases: 38,
    cost: cost(2_610_000n, 1_180_000n, 1_870_000n, 920_000n, 640_000n),
    losTenths: 58,
    pathwayTenths: 50,
  },
  {
    id: 'cs-2',
    ...cbg(CBG.pneumoniaSedangK2),
    group: 'Pneumonia',
    dpjp: 'dr. Rahmat Hidayat, Sp.PD',
    smf: 'SMF Penyakit dalam',
    cases: 22,
    cost: cost(2_205_000n, 1_050_000n, 1_420_000n, 780_000n, 560_000n),
    losTenths: 49,
    pathwayTenths: 50,
  },
  {
    id: 'cs-3',
    ...cbg(CBG.pneumoniaBeratK2),
    group: 'Pneumonia',
    dpjp: 'dr. Kartika Sari, Sp.P',
    smf: 'SMF Paru',
    cases: 9,
    cost: cost(3_960_000n, 2_150_000n, 2_480_000n, 1_120_000n, 860_000n),
    losTenths: 88,
    pathwayTenths: 70,
  },
  {
    id: 'cs-4',
    ...cbg(CBG.imaK1),
    group: 'Jantung',
    dpjp: STAF.dpjpJantung,
    smf: 'SMF Jantung',
    cases: 14,
    cost: cost(2_850_000n, 3_420_000n, 1_960_000n, 980_000n, 790_000n),
    losTenths: 46,
    pathwayTenths: 50,
  },
  {
    id: 'cs-5',
    ...cbg(CBG.empeduK2),
    group: 'Bedah digestif',
    dpjp: STAF.dpjpBedah,
    smf: 'SMF Bedah',
    cases: 11,
    cost: cost(900_000n, 3_280_000n, 1_310_000n, 520_000n, 640_000n),
    losTenths: 21,
    pathwayTenths: 20,
  },
  {
    id: 'cs-6',
    ...cbg(CBG.dbdK2),
    group: 'Infeksi virus',
    dpjp: 'dr. Nadia Rahmawati, Sp.A',
    smf: 'SMF Anak',
    cases: 46,
    cost: cost(1_620_000n, 640_000n, 780_000n, 590_000n, 320_000n),
    losTenths: 45,
    pathwayTenths: 40,
  },
  {
    id: 'cs-7',
    ...cbg(CBG.dbdK2),
    group: 'Infeksi virus',
    dpjp: 'dr. Rahmat Hidayat, Sp.PD',
    smf: 'SMF Penyakit dalam',
    cases: 18,
    cost: cost(1_350_000n, 610_000n, 690_000n, 540_000n, 290_000n),
    losTenths: 38,
    pathwayTenths: 40,
  },
  {
    id: 'cs-8',
    ...cbg(CBG.rjKronis),
    group: 'Rawat jalan kronis',
    dpjp: STAF.dpjpPenyakitDalam,
    smf: 'SMF Penyakit dalam',
    cases: 612,
    cost: cost(0n, 162_000n, 118_000n, 74_000n, 34_000n),
    losTenths: 0,
    pathwayTenths: 0,
  },
];

/** Dasar alokasi overhead (activity-based costing) yang dipakai kuartal ini. */
export const DRIVER_OVERHEAD: readonly string[] = [
  'Gizi dan linen: hari rawat',
  'Sterilisasi (CSSD): jumlah set instrumen',
  'Administrasi dan rekam medis: jumlah kunjungan',
  'Utilitas gedung: luas ruang × jam pakai',
];
