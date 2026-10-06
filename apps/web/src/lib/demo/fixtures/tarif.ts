import type {
  AturanNaikKelas,
  HargaKelas,
  ItemTarif,
  PaketTarif,
  PenjaminTarif,
  UsulanTarif,
  VersiTarif,
} from '../../keuangan-tarif';
import { PERSONA } from './staf';

/**
 * U01 · Data dummy Tarif dan paket (mode presentasi, ADR-0023). Angka fiktif untuk RS rujukan kelas B di Jakarta;
 * tarif Kelas 2 sama dengan baris tagihan layar Kasir (kamar, visite, tindakan, lab, radiologi) agar konsisten.
 * Paket kolesistektomi memakai komponen operasi skenario elektif (jasa operator dan anestesi, sewa kamar, BHP).
 */

const h = (k3: bigint, k2: bigint, k1: bigint, vip: bigint): HargaKelas => ({ k3, k2, k1, vip });
const flat = (v: bigint): HargaKelas => h(v, v, v, v);

/** Penyetuju tarif (posisi manajemen) dan pembuat usulan (akuntan). */
export const TARIF_APPROVER = PERSONA.direktur;
export const TARIF_MAKER = PERSONA.akuntan;

const v1 = (
  prices: HargaKelas,
  validTo: string | null,
  note = 'Tarif dasar SK direktur 2025',
): VersiTarif => ({
  version: 1,
  validFrom: '2025-01-01',
  validTo,
  prices,
  approvedBy: TARIF_APPROVER,
  approvedAt: '2024-12-18T14:10:00+07:00',
  note,
});
const v2 = (prices: HargaKelas, note: string): VersiTarif => ({
  version: 2,
  validFrom: '2026-01-01',
  validTo: null,
  prices,
  approvedBy: TARIF_APPROVER,
  approvedAt: '2025-12-12T10:25:00+07:00',
  note,
});

const C = {
  akomodasi: { sarana: 8_500, medis: 0, paramedis: 1_200, bhp: 300 },
  visite: { sarana: 1_500, medis: 8_500, paramedis: 0, bhp: 0 },
  tindakan: { sarana: 3_500, medis: 1_500, paramedis: 3_500, bhp: 1_500 },
  lab: { sarana: 5_500, medis: 1_000, paramedis: 1_500, bhp: 2_000 },
  rad: { sarana: 6_000, medis: 2_000, paramedis: 1_500, bhp: 500 },
  operasi: { sarana: 2_500, medis: 5_500, paramedis: 1_500, bhp: 500 },
  admin: { sarana: 10_000, medis: 0, paramedis: 0, bhp: 0 },
} as const;

export const TARIF_ITEMS: readonly ItemTarif[] = [
  {
    code: 'ADM-RJ',
    name: 'Administrasi rawat jalan',
    category: 'administrasi',
    unit: 'kunjungan',
    composition: C.admin,
    versions: [v1(flat(30_000n), null)],
  },
  {
    code: 'ADM-RI',
    name: 'Administrasi rawat inap',
    category: 'administrasi',
    unit: 'episode',
    composition: C.admin,
    versions: [
      v1(flat(65_000n), '2025-12-31'),
      v2(flat(75_000n), 'Penyesuaian biaya rekam medis elektronik'),
    ],
  },
  {
    code: 'AKM-KMR',
    name: 'Akomodasi kamar rawat inap',
    category: 'akomodasi',
    unit: 'hari',
    composition: C.akomodasi,
    versions: [
      v1(h(225_000n, 400_000n, 700_000n, 1_650_000n), '2025-12-31'),
      v2(h(250_000n, 450_000n, 750_000n, 1_800_000n), 'Kenaikan biaya utilitas dan linen 2026'),
    ],
  },
  {
    code: 'VST-SP',
    name: 'Visite dokter spesialis',
    category: 'visite',
    unit: 'kali',
    composition: C.visite,
    versions: [v1(h(150_000n, 180_000n, 220_000n, 300_000n), null)],
  },
  {
    code: 'KNS-SP',
    name: 'Konsultasi dokter spesialis',
    category: 'visite',
    unit: 'kali',
    composition: C.visite,
    versions: [v1(h(150_000n, 200_000n, 250_000n, 350_000n), null)],
  },
  {
    code: 'TND-NEB',
    name: 'Nebulisasi',
    category: 'tindakan',
    unit: 'kali',
    composition: C.tindakan,
    versions: [v1(h(30_000n, 35_000n, 40_000n, 50_000n), null)],
  },
  {
    code: 'TND-INF',
    name: 'Pemasangan infus',
    category: 'tindakan',
    unit: 'kali',
    composition: C.tindakan,
    versions: [v1(h(40_000n, 45_000n, 50_000n, 60_000n), null)],
  },
  {
    code: 'TND-KAT',
    name: 'Pemasangan kateter urin',
    category: 'tindakan',
    unit: 'kali',
    composition: C.tindakan,
    versions: [v1(h(65_000n, 72_500n, 80_000n, 95_000n), null)],
  },
  {
    code: 'LAB-DL',
    name: 'Darah lengkap',
    category: 'laboratorium',
    unit: 'pemeriksaan',
    composition: C.lab,
    versions: [v1(flat(95_000n), null)],
  },
  {
    code: 'LAB-UK',
    name: 'Ureum dan kreatinin',
    category: 'laboratorium',
    unit: 'pemeriksaan',
    composition: C.lab,
    versions: [v1(flat(110_000n), null)],
  },
  {
    code: 'LAB-KS',
    name: 'Kultur sputum + uji kepekaan',
    category: 'laboratorium',
    unit: 'pemeriksaan',
    composition: C.lab,
    versions: [v1(flat(400_000n), '2025-12-31'), v2(flat(450_000n), 'Kenaikan harga media kultur')],
  },
  {
    code: 'LAB-HBA',
    name: 'HbA1c',
    category: 'laboratorium',
    unit: 'pemeriksaan',
    composition: C.lab,
    versions: [v1(flat(185_000n), null)],
  },
  {
    code: 'RAD-TPA',
    name: 'Foto toraks PA',
    category: 'radiologi',
    unit: 'pemeriksaan',
    composition: C.rad,
    versions: [v1(flat(240_000n), null)],
  },
  {
    code: 'RAD-USG',
    name: 'USG abdomen',
    category: 'radiologi',
    unit: 'pemeriksaan',
    composition: C.rad,
    versions: [v1(h(325_000n, 350_000n, 375_000n, 425_000n), null)],
  },
  {
    code: 'OK-OPAN',
    name: 'Jasa operator dan anestesi · bedah sedang',
    category: 'operasi',
    unit: 'tindakan',
    composition: { sarana: 0, medis: 8_500, paramedis: 1_500, bhp: 0 },
    versions: [v1(h(5_200_000n, 5_800_000n, 6_500_000n, 8_400_000n), null)],
  },
  {
    code: 'OK-SEWA',
    name: 'Sewa kamar operasi · ≤ 2 jam',
    category: 'operasi',
    unit: 'tindakan',
    composition: { sarana: 8_500, medis: 0, paramedis: 1_000, bhp: 500 },
    versions: [v1(h(1_800_000n, 2_000_000n, 2_200_000n, 2_900_000n), null)],
  },
  {
    code: 'OK-BHPL',
    name: 'BHP dan alat laparoskopi',
    category: 'operasi',
    unit: 'set',
    composition: { sarana: 2_000, medis: 0, paramedis: 0, bhp: 8_000 },
    versions: [v1(flat(3_100_000n), null)],
  },
  {
    code: 'OK-SC',
    name: 'Jasa operator dan anestesi · seksio sesarea',
    category: 'operasi',
    unit: 'tindakan',
    composition: C.operasi,
    versions: [v1(h(4_600_000n, 5_200_000n, 5_900_000n, 7_600_000n), null)],
  },
  {
    code: 'VK-PN',
    name: 'Pertolongan persalinan normal',
    category: 'tindakan',
    unit: 'tindakan',
    composition: { sarana: 2_500, medis: 4_500, paramedis: 2_500, bhp: 500 },
    versions: [v1(h(1_400_000n, 1_650_000n, 1_950_000n, 2_600_000n), null)],
  },
];

/** Jumlah seluruh item tarif aktif di master (daftar layar memuat contoh per kategori). */
export const TARIF_ITEM_TOTAL = 1_284;

export const TARIF_PENJAMIN: readonly PenjaminTarif[] = [
  { id: 'umum', label: 'Umum / pribadi', bp: 0, note: 'Tarif dasar SK direktur' },
  {
    id: 'asuransi',
    label: 'Asuransi swasta',
    bp: 1_000,
    note: 'Tarif kontrak asuransi: tarif dasar + 10% (perjanjian kerja sama 2026)',
  },
  {
    id: 'perusahaan',
    label: 'Perusahaan kerja sama',
    bp: -500,
    note: 'Diskon kontrak 5% dari tarif dasar untuk karyawan perusahaan mitra',
  },
  {
    id: 'jkn',
    label: 'JKN (tarif RS)',
    bp: 0,
    note: 'Tarif RS untuk perbandingan INA-CBG dan dasar selisih naik kelas; BPJS membayar tarif INA-CBG',
  },
];

export const TARIF_USULAN: readonly UsulanTarif[] = [
  {
    id: 'ut-07',
    number: 'UT-2610-007',
    itemCode: 'RAD-USG',
    maker: TARIF_MAKER,
    makerRole: 'Akuntan',
    createdAt: '2026-10-02T15:40:00+07:00',
    validFrom: '2026-11-01',
    prices: { k3: 350_000n, k2: 375_000n, k1: 400_000n, vip: 450_000n },
    reason: 'Kontrak servis alat USG baru naik 9%; tarif tidak berubah sejak 2025.',
    status: 'diajukan',
  },
  {
    id: 'ut-06',
    number: 'UT-2610-006',
    itemCode: 'TND-NEB',
    maker: TARIF_MAKER,
    makerRole: 'Akuntan',
    createdAt: '2026-10-01T10:05:00+07:00',
    validFrom: '2026-11-01',
    prices: { k3: 30_000n, k2: 40_000n, k1: 50_000n, vip: 65_000n },
    reason: 'Selaraskan dengan unit cost nebulizer sekali pakai (analisis costing Q3).',
    status: 'diajukan',
  },
  {
    id: 'ut-04',
    number: 'UT-2609-004',
    itemCode: 'LAB-HBA',
    maker: TARIF_MAKER,
    makerRole: 'Akuntan',
    createdAt: '2026-09-21T09:30:00+07:00',
    validFrom: '2026-10-01',
    prices: flat(210_000n),
    reason: 'Reagen HbA1c naik setelah ganti pemasok KSO.',
    status: 'ditolak',
    decidedBy: TARIF_APPROVER,
    decidedAt: '2026-09-24T13:15:00+07:00',
    decisionNote: 'Tunggu evaluasi KSO reagen akhir Oktober; tarif tetap.',
  },
];

export const TARIF_PAKET: readonly PaketTarif[] = [
  {
    id: 'pk-lapkol',
    code: 'PKT-OK-051',
    name: 'Paket kolesistektomi laparoskopik',
    maxLos: 2,
    prices: h(10_900_000n, 12_100_000n, 13_600_000n, 18_200_000n),
    items: [
      { itemCode: 'OK-OPAN', qty: 1 },
      { itemCode: 'OK-SEWA', qty: 1 },
      { itemCode: 'OK-BHPL', qty: 1 },
      { itemCode: 'AKM-KMR', qty: 2 },
      { itemCode: 'VST-SP', qty: 3 },
      { itemCode: 'RAD-USG', qty: 1 },
      { itemCode: 'LAB-DL', qty: 1 },
      { itemCode: 'ADM-RI', qty: 1 },
    ],
    exclusions: [
      'Lama rawat lebih dari 2 malam: akomodasi dan visite hari berikutnya ditagih per item',
      'Konversi ke bedah terbuka atau komplikasi: dihitung ulang per item',
      'Obat di luar formularium paket dan transfusi darah',
    ],
    validFrom: '2026-01-01',
  },
  {
    id: 'pk-sc',
    code: 'PKT-VK-012',
    name: 'Paket persalinan seksio sesarea',
    maxLos: 3,
    prices: h(7_500_000n, 8_900_000n, 10_700_000n, 16_100_000n),
    items: [
      { itemCode: 'OK-SC', qty: 1 },
      { itemCode: 'OK-SEWA', qty: 1 },
      { itemCode: 'AKM-KMR', qty: 3 },
      { itemCode: 'VST-SP', qty: 3 },
      { itemCode: 'LAB-DL', qty: 2 },
      { itemCode: 'TND-INF', qty: 1 },
      { itemCode: 'TND-KAT', qty: 1 },
      { itemCode: 'ADM-RI', qty: 1 },
    ],
    exclusions: [
      'Perawatan bayi di perinatologi/NICU',
      'Lama rawat lebih dari 3 malam',
      'Tindakan tambahan (tubektomi, histerektomi)',
    ],
    validFrom: '2026-01-01',
  },
  {
    id: 'pk-pn',
    code: 'PKT-VK-010',
    name: 'Paket persalinan normal',
    maxLos: 2,
    prices: h(2_250_000n, 2_950_000n, 3_850_000n, 6_600_000n),
    items: [
      { itemCode: 'VK-PN', qty: 1 },
      { itemCode: 'AKM-KMR', qty: 2 },
      { itemCode: 'VST-SP', qty: 2 },
      { itemCode: 'LAB-DL', qty: 1 },
      { itemCode: 'TND-INF', qty: 1 },
      { itemCode: 'ADM-RI', qty: 1 },
    ],
    exclusions: ['Induksi persalinan dan tindakan vakum/forsep', 'Perawatan bayi di luar rawat gabung'],
    validFrom: '2026-01-01',
  },
];

/** Aturan selisih naik kelas JKN (berversi; angka simulasi, bukan kutipan regulasi). */
export const ATURAN_NAIK_KELAS: readonly AturanNaikKelas[] = [
  {
    id: 'nk-ri-k1',
    version: 'NK-2026-01',
    validFrom: '2026-01-01',
    label: 'Rawat inap naik ke Kelas 1 (hak Kelas 2/3)',
    rule: 'Selisih = tarif INA-CBG Kelas 1 − tarif INA-CBG hak kelas',
  },
  {
    id: 'nk-ri-vip',
    version: 'NK-2026-01',
    validFrom: '2026-01-01',
    label: 'Rawat inap naik ke VIP (di atas Kelas 1)',
    rule: 'Selisih paling banyak 75% tarif INA-CBG Kelas 1 (simulasi)',
  },
  {
    id: 'nk-rj-eks',
    version: 'NK-2026-01',
    validFrom: '2026-01-01',
    label: 'Rawat jalan eksekutif',
    rule: 'Selisih paket paling banyak Rp 400.000 per episode (simulasi)',
  },
];
