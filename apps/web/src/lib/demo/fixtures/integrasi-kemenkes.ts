import type { KemenkesReport } from '../../integrasi-kemenkes';
import { BANGSAL, POLI } from './rs';
import { DEMO_TODAY } from './waktu';

/**
 * I04 · Data dummy laporan Kemenkes (ADR-0023): RS Online dari kapasitas bangsal yang sama dengan Tempat tidur dan
 * Dasbor; laporan SIRS bulanan September 2026 berupa agregat fiktif. Laporan kegiatan rawat inap menahan kirim karena
 * 3 pasien pulang belum tercatat cara keluarnya (perbaikan di rekam medis).
 */

const at = (hhmm: string) => `${DEMO_TODAY}T${hhmm.replace('.', ':')}:00+07:00`;

/** Kunjungan rawat jalan September 2026 per poli (fiktif, urutan sama dengan `POLI`). */
const RJ_SEP = [3_412, 1_286, 974, 802, 1_118, 896, 1_034];

export function demoKemenkesReports(): KemenkesReport[] {
  const kelas = [...new Set(BANGSAL.map((b) => b.kelas))];
  const rj = POLI.map((p, i) => ({ label: `Poli ${p.name}`, value: RJ_SEP[i] ?? 0 }));
  return [
    {
      id: 'rso-bed',
      name: 'RS Online · ketersediaan tempat tidur',
      system: 'RS Online',
      frequency: 'real-time',
      period: 'saat ini',
      source: 'Tempat tidur (K05), dikirim tiap perubahan status bed',
      status: 'terkirim',
      rows: kelas.map((k) => ({
        label: `${k} · tersedia`,
        value: BANGSAL.filter((b) => b.kelas === k).reduce((a, b) => a + b.beds - b.occupied, 0),
      })),
      declaredTotal: null,
      checks: [],
      sent: { at: at('10.43'), receipt: 'RSO-2610-0412' },
    },
    {
      id: 'sirs-rj',
      name: 'SIRS · kunjungan rawat jalan per poli',
      system: 'SIRS',
      frequency: 'bulanan',
      period: 'September 2026',
      source: 'Kunjungan rawat jalan (F03), 1–30 Sep 2026 WIB',
      status: 'siap',
      rows: rj,
      declaredTotal: rj.reduce((a, x) => a + x.value, 0),
      checks: [],
      sent: null,
    },
    {
      id: 'sirs-ri',
      name: 'SIRS · kegiatan rawat inap',
      system: 'SIRS',
      frequency: 'bulanan',
      period: 'September 2026',
      source: 'ADT rawat inap (K04/K05), 1–30 Sep 2026 WIB',
      status: 'draf',
      rows: [
        { label: 'Pasien awal bulan', value: 228 },
        { label: 'Pasien masuk', value: 1_164 },
        { label: 'Keluar hidup', value: 1_121 },
        { label: 'Meninggal < 48 jam', value: 9 },
        { label: 'Meninggal ≥ 48 jam', value: 14 },
      ],
      declaredTotal: null,
      checks: [
        {
          id: 'cara-keluar',
          label: 'Cara keluar tercatat untuk semua pasien pulang',
          ok: false,
          fix: '3 pasien pulang belum tercatat cara keluarnya · lengkapi dari rekam medis',
        },
      ],
      sent: null,
    },
    {
      id: 'sirs-morb',
      name: 'SIRS · morbiditas rawat inap',
      system: 'SIRS',
      frequency: 'bulanan',
      period: 'September 2026',
      source: 'Menunggu koding diagnosis final (fase berikutnya)',
      status: 'belum-tersedia',
      rows: [],
      declaredTotal: null,
      checks: [],
      sent: null,
    },
    {
      id: 'sirs-igd',
      name: 'SIRS · kegiatan rawat darurat',
      system: 'SIRS',
      frequency: 'bulanan',
      period: 'September 2026',
      source: 'Menunggu agregasi papan IGD (fase berikutnya)',
      status: 'belum-tersedia',
      rows: [],
      declaredTotal: null,
      checks: [],
      sent: null,
    },
  ];
}
