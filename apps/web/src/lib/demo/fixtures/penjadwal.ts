import type { JobRun, ScheduledJob } from '../../platform-penjadwal';

/**
 * FE1 · P11 job berkala fiktif RSFA per hari demo (Sen, 5 Okt 2026 · 10.45). Nama job memakai bahasa petugas;
 * pesan galat tanpa data pasien.
 */

const at = (hhmm: string, day = '2026-10-05') => `${day}T${hhmm}:00+07:00`;
const ok = (hhmm: string, durationSec: number, message: string, day?: string): JobRun => ({
  at: at(hhmm, day),
  durationSec,
  result: 'berhasil',
  message,
});
const fail = (hhmm: string, durationSec: number, message: string, day?: string): JobRun => ({
  at: at(hhmm, day),
  durationSec,
  result: 'gagal',
  message,
});

export const DEMO_JOBS: readonly ScheduledJob[] = [
  {
    id: 'aplicare-bed',
    name: 'Sinkron ketersediaan bed ke Aplicare',
    schedule: 'Tiap 15 menit',
    intervalMin: 15,
    owner: 'K05 · I03',
    paused: false,
    sensitive: false,
    nextAt: at('10:45'),
    runs: [
      fail(
        '10:30',
        31,
        'Aplicare menjawab 503 (layanan tidak tersedia) setelah 3× coba ulang; data bed belum terkirim.',
      ),
      fail('10:15', 30, 'Aplicare menjawab 503 (layanan tidak tersedia) setelah 3× coba ulang.'),
      ok('10:00', 4, '8 kelas rawat terkirim'),
      ok('09:45', 3, '8 kelas rawat terkirim'),
    ],
  },
  {
    id: 'laporan-rl',
    name: 'Laporan RL/SIRS Online bulanan',
    schedule: 'Bulanan · tgl 5 pukul 08.00',
    intervalMin: 31 * 24 * 60,
    owner: 'I04 · B09',
    paused: false,
    sensitive: true,
    nextAt: at('08:00', '2026-11-05'),
    runs: [
      fail('08:00', 74, 'RL 3.1 September ditolak validasi SIRS: 2 baris diagnosis tanpa kode ICD-10.'),
      ok('08:00', 69, 'RL 1–5 Agustus terkirim, tanda terima SIRS diterima', '2026-09-05'),
    ],
  },
  {
    id: 'backup-jam',
    name: 'Backup terenkripsi per jam (3 lokasi)',
    schedule: 'Tiap jam · menit 00',
    intervalMin: 60,
    owner: 'Fase 10 · backup',
    paused: false,
    sensitive: true,
    nextAt: at('11:00'),
    runs: [
      ok('10:00', 212, 'Lokal, cloud, offsite berhasil · 2,41 GB terenkripsi'),
      ok('09:00', 205, 'Lokal, cloud, offsite berhasil · 2,41 GB terenkripsi'),
      ok('08:00', 208, 'Lokal, cloud, offsite berhasil · 2,40 GB terenkripsi'),
    ],
  },
  {
    id: 'jangkar-audit',
    name: 'Jangkar hash jejak audit (WORM)',
    schedule: 'Tiap jam · menit 05',
    intervalMin: 60,
    owner: 'P04',
    paused: false,
    sensitive: false,
    nextAt: at('11:05'),
    runs: [ok('10:05', 6, 'Kepala rantai tercatat + HMAC'), ok('09:05', 6, 'Kepala rantai tercatat + HMAC')],
  },
  {
    id: 'cetak-darurat',
    name: 'Paket cetak darurat per ruang (server edge)',
    schedule: 'Tiap 4 jam',
    intervalMin: 240,
    owner: 'P13',
    paused: false,
    sensitive: false,
    nextAt: at('12:00'),
    runs: [ok('08:00', 41, '14 ruang · berkas terenkripsi di edge'), ok('04:00', 39, '14 ruang')],
  },
  {
    id: 'outbox',
    name: 'Kirim antrean integrasi (outbox)',
    schedule: 'Tiap 30 detik',
    intervalMin: 1,
    owner: 'I01',
    paused: false,
    sensitive: false,
    nextAt: at('10:45'),
    runs: [ok('10:44', 2, '37 pesan terkirim, 0 gagal'), ok('10:44', 1, '12 pesan terkirim')],
  },
  {
    id: 'kfa-sync',
    name: 'Sinkron master obat KFA',
    schedule: 'Harian 02.00',
    intervalMin: 24 * 60,
    owner: 'P06',
    paused: false,
    sensitive: false,
    nextAt: at('02:00', '2026-10-06'),
    runs: [ok('02:00', 96, 'Tidak ada perubahan sejak versi 2026-09')],
  },
  {
    id: 'resume-batas',
    name: 'Penanda resume melewati batas 24 jam',
    schedule: 'Tiap jam',
    intervalMin: 60,
    owner: 'K13',
    paused: false,
    sensitive: false,
    nextAt: at('11:00'),
    runs: [ok('10:00', 3, '2 resume lewat batas masuk worklist DPJP')],
  },
  {
    id: 'pengingat-kontrol',
    name: 'Pengingat jadwal kontrol pasien (WhatsApp)',
    schedule: 'Harian 16.00',
    intervalMin: 24 * 60,
    owner: 'P09 · I07',
    paused: true,
    pausedReason: 'Templat pesan WhatsApp menunggu persetujuan penyedia (BSP).',
    sensitive: true,
    nextAt: at('16:00'),
    runs: [ok('16:00', 22, '58 pengingat terkirim', '2026-10-02')],
  },
];
