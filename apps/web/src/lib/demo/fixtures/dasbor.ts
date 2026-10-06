import type { DashboardKpi, DashboardPeriod, ExecutiveDashboard } from '@simrs/shared';
import { CLAIM_KPIS } from './keuangan';
import { DEMO_NOW, DEMO_TODAY, shiftDate } from './waktu';

/**
 * Data dummy Dasbor direksi (mockup `Dasbor.dc.html`, ADR-0023). Angka fiktif dan ilustratif; yang bisa dihitung
 * (BOR hari ini, kapasitas, realisasi anggaran, bauran penjamin) diturunkan dari profil di bawah, bukan diketik.
 */

/** Kapasitas saat ini (profil RS fiktif). BOR hari ini dihitung dari baris rawat inap kelas. */
const CAPACITY: ExecutiveDashboard['capacity'] = [
  { id: 'ranap-kelas', label: 'Rawat inap kelas', used: 214, total: 260, unit: 'bed' },
  { id: 'icu', label: 'ICU', used: 11, total: 12, unit: 'bed' },
  { id: 'igd', label: 'IGD bed', used: 18, total: 20, unit: 'bed' },
  { id: 'ok', label: 'Kamar operasi hari ini', used: 13, total: 16, unit: 'kasus' },
  { id: 'isolasi', label: 'Isolasi', used: 3, total: 6, unit: 'bed' },
];

/** Pendapatan harian 30 hari terakhir (Rp juta), berakhir kemarin; anggaran naik linear 200 → 214 juta/hari. */
const REVENUE_JUTA = [
  208, 202, 222, 216, 188, 180, 212, 224, 220, 228, 210, 192, 184, 218, 230, 224, 236, 216, 196, 190, 226,
  232, 240, 234, 222, 202, 194, 238, 244, 250,
];
const JUTA = 1_000_000n;

/** Pendapatan bulan berjalan per penjamin (rupiah) dan margin kontribusinya. */
const PAYER_MIX: ExecutiveDashboard['payerMix'] = [
  { payer: 'jkn', label: 'JKN / BPJS', revenue: '4615000000', marginPercent: -3.8 },
  { payer: 'asuransi', label: 'Asuransi swasta', revenue: '910000000', marginPercent: 22 },
  { payer: 'umum', label: 'Umum', revenue: '715000000', marginPercent: 28 },
  { payer: 'kerja-sama', label: 'Kerja sama', revenue: '260000000', marginPercent: 15 },
];

const QUALITY: ExecutiveDashboard['quality'] = [
  {
    id: 'kebersihan-tangan',
    label: 'Kepatuhan kebersihan tangan',
    value: 88,
    target: { min: 85, label: '≥ 85%' },
  },
  {
    id: 'identifikasi',
    label: 'Kepatuhan identifikasi pasien',
    value: 97,
    target: { min: 100, label: '100%' },
  },
  { id: 'sc-emergensi', label: 'Waktu tanggap SC emergensi', value: 91, target: { min: 80, label: '≥ 80%' } },
  {
    id: 'clinical-pathway',
    label: 'Kepatuhan clinical pathway',
    value: 76,
    target: { min: 80, label: '≥ 80%' },
  },
  {
    id: 'nilai-kritis',
    label: 'Pelaporan nilai kritis lab',
    value: 100,
    target: { min: 100, label: '100%' },
  },
  {
    id: 'cegah-jatuh',
    label: 'Kepatuhan upaya pencegahan jatuh',
    value: 93,
    target: { min: 100, label: '100%' },
  },
];

const pct = (used: number, total: number) => Math.round((used / total) * 100);

function kpis(period: DashboardPeriod): DashboardKpi[] {
  const ranap = CAPACITY[0];
  const borToday = ranap ? pct(ranap.used, ranap.total) : 0;
  const base = {
    bor: {
      label: 'BOR',
      unit: 'persen',
      deltaUnit: 'poin',
      target: { min: 60, max: 85, label: 'ideal 60–85%' },
    },
    alos: { label: 'ALOS', unit: 'hari', deltaUnit: 'hari', target: { max: 4.3, label: 'target ≤ 4,3' } },
    'kunjungan-rj': {
      label: 'Kunjungan RJ / hari',
      unit: 'pasien',
      deltaUnit: 'persen',
      target: { max: 1300, label: 'kapasitas 1.300' },
    },
    'tunggu-rj': {
      label: 'Waktu tunggu RJ',
      unit: 'menit',
      deltaUnit: 'menit',
      target: { max: 60, label: 'target ≤ 60' },
    },
    'klaim-terbayar': {
      label: 'Klaim terbayar',
      unit: 'persen',
      deltaUnit: 'poin',
      target: { min: 96, label: 'target ≥ 96%' },
    },
    kepuasan: {
      label: 'Kepuasan pasien',
      unit: 'persen',
      deltaUnit: 'poin',
      target: { min: 80, label: 'target ≥ 80%' },
    },
  } as const;
  type Row = [DashboardKpi['id'], number, number, string, string?];
  const rows: Record<DashboardPeriod, Row[]> = {
    'hari-ini': [
      ['bor', borToday, 1, 'vs kemarin'],
      ['alos', 4.8, 0.5, 'vs kemarin', 'pasien pulang hari ini'],
      ['kunjungan-rj', 736, 3, 'vs minggu lalu', 'data s.d. 10.45'],
      ['tunggu-rj', 47, -5, 'vs kemarin'],
      ['klaim-terbayar', 93.8, -0.3, 'vs kemarin'],
      ['kepuasan', 88, 2, 'vs kemarin'],
    ],
    bulan: [
      ['bor', 82, 3, 'vs Sep'],
      ['alos', 4.6, 0.3, 'vs Sep'],
      ['kunjungan-rj', 1148, 5, 'vs Sep'],
      ['tunggu-rj', 52, -9, 'vs Sep'],
      ['klaim-terbayar', 94.1, -1.2, 'vs Sep'],
      ['kepuasan', 86, 2, 'vs Sep'],
    ],
    ytd: [
      ['bor', 78, 4, 'vs 2025'],
      ['alos', 4.4, -0.2, 'vs 2025'],
      ['kunjungan-rj', 1092, 7, 'vs 2025'],
      ['tunggu-rj', 58, -14, 'vs 2025'],
      ['klaim-terbayar', 95.2, 0.8, 'vs 2025'],
      ['kepuasan', 84, 3, 'vs 2025'],
    ],
  };
  return rows[period].map(([id, value, delta, comparedTo, note]) => ({
    id,
    ...base[id],
    target: { ...base[id].target },
    value,
    delta,
    comparedTo,
    ...(note ? { note } : {}),
  }));
}

export function demoExecutiveDashboard(period: DashboardPeriod): ExecutiveDashboard {
  const days = REVENUE_JUTA.length;
  const icu = CAPACITY.find((c) => c.id === 'icu');
  return {
    period,
    asOf: DEMO_NOW,
    kpis: kpis(period),
    revenue: REVENUE_JUTA.map((v, i) => ({
      date: shiftDate(DEMO_TODAY, i - days),
      actual: (BigInt(v) * JUTA).toString(),
      budget: (BigInt(200 + Math.round((14 * i) / (days - 1))) * JUTA).toString(),
    })),
    payerMix: PAYER_MIX,
    quality: QUALITY,
    capacity: CAPACITY,
    alerts: [
      {
        id: 'icu',
        title: `ICU ${icu ? pct(icu.used, icu.total) : 0}% · 3 pasien IGD menunggu`,
        detail: 'Usulan: aktifkan HCU sebagai step-down 4 bed.',
        severity: 'kritis',
        link: { screen: 'bed', label: 'Buka manajemen bed' },
      },
      {
        id: 'klaim',
        // Sama dengan KPI "Pending" di layar Klaim (U05).
        title: `Klaim pending Rp ${BigInt(CLAIM_KPIS.pending.value) / JUTA} jt > 30 hari`,
        detail: 'Mayoritas ICU sepsis, resume belum final.',
        severity: 'perhatian',
        link: { screen: 'klaim', label: 'Lihat klaim pending' },
      },
      {
        id: 'alos',
        title: 'ALOS pneumonia 6,2 vs pathway 5',
        detail: 'Rapat komite medik dijadwalkan 8 Okt.',
        severity: 'perhatian',
      },
      {
        id: 'stok',
        title: 'Stok enoksaparin < 7 hari',
        detail: 'PO darurat menunggu persetujuan.',
        severity: 'perhatian',
        link: { screen: 'logistik', label: 'Tinjau stok dan PO' },
      },
    ],
  };
}
