import {
  criticalStage,
  formatJam,
  formatTanggalWaktu,
  isoDateJakarta,
  type LabCriticalReport,
  type LabFlag,
  type LabRange,
  type LabResult,
  type LabSample,
  type LabSampleStatus,
} from '@simrs/shared';

/** Aturan murni dipindah ke `@simrs/shared` (rencana fase 4 §4.0a); diekspor ulang untuk pemakai lama. */
export { type CriticalStage, criticalStage, deltaCheck, labFlag } from '@simrs/shared';

/** Jam saja bila di hari `today` (`10.39`), selain itu lengkap (`Sab, 3 Okt 2026 · 22.31`). */
export function formatWhen(iso: string, today: string): string {
  return isoDateJakarta(iso) === today ? formatJam(iso) : formatTanggalWaktu(iso);
}

/** Tahap alur validasi (0 = sampel, 1 = analyzer, 2 = validasi teknis, 3 = validasi klinis, 4 = rilis). */
export function labFlowStage(s: Pick<LabSample, 'status'>, resample = false): number {
  if (resample) return 0;
  const stage: Record<LabSampleStatus, number> = {
    order: 0,
    diterima: 1,
    inkubasi: 1,
    hasil: 2,
    'validasi-teknis': 3,
    selesai: 4,
  };
  return stage[s.status];
}

/**
 * S01/S09 · Fungsi murni tampilan laboratorium (mode presentasi, ADR-0023): format angka Indonesia, flag dari
 * rentang rujukan dan batas kritis, delta check, timer nilai kritis, dan status worklist. Diuji di
 * `penunjang.test.ts`; dipakai fixture (flag dihitung, bukan diketik) dan layar.
 */

const formatters = new Map<number, Intl.NumberFormat>();
function nf(decimals: number): Intl.NumberFormat {
  let f = formatters.get(decimals);
  if (!f) {
    f = new Intl.NumberFormat('id-ID', { minimumFractionDigits: decimals, maximumFractionDigits: decimals });
    formatters.set(decimals, f);
  }
  return f;
}

/** Angka hasil lab gaya Indonesia: `8.900`, `11,2`, `6,8`. */
export function formatLabNumber(value: number, decimals: number): string {
  return nf(decimals).format(value);
}

/** Rentang rujukan: `12,0–15,5`, `< 5`, `> 40`, atau `—`. */
export function formatRange(ref: LabRange | null, decimals: number): string {
  if (!ref || (ref.low === null && ref.high === null)) return '—';
  if (ref.low !== null && ref.high !== null) {
    return `${formatLabNumber(ref.low, decimals)}–${formatLabNumber(ref.high, decimals)}`;
  }
  if (ref.high !== null) return `< ${formatLabNumber(ref.high, decimals)}`;
  return `> ${formatLabNumber(ref.low ?? 0, decimals)}`;
}

const FLAG_SR: Record<LabFlag, string> = { N: 'normal', H: 'tinggi', L: 'rendah', KRITIS: 'kritis' };

export interface FlagView {
  /** Teks chip, mis. `H`, `H Δ`, `KRITIS`, `Proses`. */
  label: string;
  /** Teks pembaca layar, mis. "tinggi, delta check". */
  sr: string;
  tone: 'danger' | 'warning' | 'neutral';
}

export function flagView(r: LabResult): FlagView {
  if (r.pending || r.flag === null) return { label: 'Proses', sr: 'masih diproses', tone: 'neutral' };
  const label = r.flag === 'KRITIS' ? 'KRITIS' : r.delta ? `${r.flag} Δ` : r.flag;
  const sr = `${FLAG_SR[r.flag]}${r.delta ? ', delta check' : ''}`;
  const tone = r.flag === 'KRITIS' ? 'danger' : r.flag === 'N' && !r.delta ? 'neutral' : 'warning';
  return { label, sr, tone };
}

/** Nilai tampilan: angka berformat, hasil kualitatif, atau `…` bila masih diproses. */
export function resultText(r: LabResult): string {
  if (r.pending) return '…';
  if (r.value !== null) return formatLabNumber(r.value, r.decimals);
  return r.text ?? '—';
}

/** Tren singkat: `0,9 → 0,9 → 1,3`, atau "pemeriksaan pertama". */
export function trendText(r: LabResult): string {
  if (r.pending) return '—';
  if (r.value === null) return r.previous.length ? 'stabil' : '—';
  if (r.previous.length === 0) return 'pemeriksaan pertama';
  return [...r.previous, r.value].map((v) => formatLabNumber(v, r.decimals)).join(' → ');
}

/** Titik polyline sparkline (lebar `w`, tinggi `h`, tepi 2 px); kosong bila kurang dari 2 titik. */
export function sparkPoints(values: readonly number[], w: number, h: number): string {
  if (values.length < 2) return '';
  const min = Math.min(...values);
  const max = Math.max(...values);
  const span = max - min || 1;
  return values
    .map((v, i) => {
      const x = 2 + (i * (w - 4)) / (values.length - 1);
      const y = h - 2 - ((v - min) / span) * (h - 4);
      return `${x.toFixed(1)},${y.toFixed(1)}`;
    })
    .join(' ');
}

const pad = (n: number) => String(n).padStart(2, '0');

/** `06:12` (menit:detik; menit boleh lebih dari 59). */
export function formatMmSs(totalSeconds: number): string {
  const s = Math.max(0, Math.floor(totalSeconds));
  return `${pad(Math.floor(s / 60))}:${pad(s % 60)}`;
}

/**
 * Waktu lapor nilai kritis dalam detik (mm:ss di layar, mockup Lab). Laporan dari layar ini menyimpan detik timer
 * (`elapsedSeconds` = `tookSeconds`); laporan dari data hanya tahu menitnya (`minutesToReport`), jadi detiknya 00.
 */
export function criticalReportSeconds(
  c: Pick<LabCriticalReport, 'elapsedSeconds' | 'minutesToReport'>,
): number {
  const m = c.minutesToReport ?? 0;
  return Math.floor(c.elapsedSeconds / 60) === m ? c.elapsedSeconds : m * 60;
}

/** Hasil kosong (mockup Lab): selesai → rincian di riwayat; inkubasi → jadwal laporan; lainnya → status saat ini. */
export function emptyResultText(s: LabSample, resample = false): string {
  if (s.status === 'selesai')
    return 'Hasil sudah divalidasi klinis dan dirilis. Buka riwayat untuk melihat rincian.';
  if (s.status === 'inkubasi')
    return 'Kultur dalam inkubasi. Laporan pertumbuhan tersedia H+1, uji kepekaan H+3.';
  return `Hasil belum lengkap (status: ${sampleStatusView(s, resample).label}). Rincian tampil setelah analyzer mengirim hasil.`;
}

/**
 * Alasan tombol "Minta ulang sampel" nonaktif (mockup: selalu tampil); null = boleh. Sampel pasien simulasi
 * mengikuti langkah Simulasi; sampel tanpa hasil belum bisa diulang; hasil yang sudah dirilis dikoreksi lewat revisi.
 */
export function resampleBlock(s: Pick<LabSample, 'status' | 'results'>, scenario: boolean): string | null {
  if (scenario) return 'Sampel pasien simulasi mengikuti langkah di Simulasi.';
  if (s.status === 'selesai') return 'Hasil sudah dirilis; koreksi hanya lewat hasil revisi berversi.';
  if (s.results.length === 0) return 'Belum ada hasil; sampel ulang diminta setelah hasil dinilai.';
  return null;
}

/** Timer nilai kritis: teks berjalan, lewat batas atau belum, sisa menit (bulat ke atas, minimal 0). */
export function criticalTimer(elapsedSeconds: number, limitMinutes: number) {
  const limit = limitMinutes * 60;
  return {
    text: formatMmSs(elapsedSeconds),
    over: elapsedSeconds >= limit,
    remainingMinutes: Math.max(0, Math.ceil((limit - elapsedSeconds) / 60)),
  };
}

/** Selisih menit utuh antara dua instan ISO (dibulatkan ke bawah, minimal 0). */
export function minutesBetween(fromIso: string, toIso: string): number {
  return Math.max(0, Math.floor((Date.parse(toIso) - Date.parse(fromIso)) / 60_000));
}

/** Nilai kritis yang belum sah dilaporkan (belum read-back). */
export function criticalOpen(s: Pick<LabSample, 'critical'>): boolean {
  return s.critical !== null && criticalStage(s.critical) !== 'selesai';
}

/** Penolakan gerbang Server Action penunjang: pesan + isian yang galat (bila ada). */
export interface GateDenial {
  message: string;
  field?: string;
}

export const LAB_SAMPLE_UNKNOWN = 'Sampel tidak ditemukan di worklist laboratorium.';

/**
 * Gerbang Server Action lab: sampel dicari server di worklist sesi (klien hanya mengirim id), jadi id yang tidak
 * ada di worklist ditolak. Kemajuan lokal (validasi, sampel ulang) tidak tersimpan sehingga tidak diperiksa.
 */
export function labSampleGate(s: Pick<LabSample, 'critical'> | undefined): GateDenial | null {
  return s ? null : { message: LAB_SAMPLE_UNKNOWN };
}

/**
 * Pelaporan nilai kritis (S09) di server: sampel ada di worklist dan nilai kritisnya masih terbuka, nama penerima
 * wajib (≥ 5 karakter), dan read-back wajib dikonfirmasi; laporan tanpa read-back tidak sah sehingga ditolak.
 */
export function criticalReportGate(
  s: Pick<LabSample, 'critical'> | undefined,
  recipient: string,
  readBack: boolean,
): GateDenial | null {
  if (!s) return { message: LAB_SAMPLE_UNKNOWN };
  if (!criticalOpen(s))
    return { message: 'Sampel ini tidak memiliki nilai kritis terbuka untuk dilaporkan.' };
  if (recipient.trim().length < 5) {
    return { message: 'Nama penerima wajib diisi (minimal 5 karakter).', field: 'recipient' };
  }
  if (!readBack) return { message: 'Read-back wajib dikonfirmasi sebelum disimpan.', field: 'readBack' };
  return null;
}

export type StatusTone = 'danger' | 'warning' | 'success' | 'brand' | 'neutral';

/** Status worklist (teks, bukan hanya warna). `resample` = permintaan sampel ulang di layar. */
export function sampleStatusView(s: LabSample, resample = false): { label: string; tone: StatusTone } {
  if (resample) return { label: 'Sampel ulang', tone: 'warning' };
  const stage = s.critical ? criticalStage(s.critical) : null;
  if (stage === 'terbuka') return { label: 'Kritis', tone: 'danger' };
  if (stage === 'menunggu-read-back') return { label: 'Menunggu read-back', tone: 'danger' };
  const byStatus: Record<LabSampleStatus, { label: string; tone: StatusTone }> = {
    order: { label: 'Sampling', tone: 'neutral' },
    diterima: { label: 'Proses', tone: 'neutral' },
    hasil:
      stage === 'selesai' ? { label: 'Dilaporkan', tone: 'warning' } : { label: 'Validasi', tone: 'brand' },
    'validasi-teknis': { label: 'Validasi klinis', tone: 'brand' },
    selesai: { label: 'Selesai', tone: 'success' },
    inkubasi: { label: 'Inkubasi', tone: 'neutral' },
  };
  return byStatus[s.status];
}

/** Urutan worklist (mockup: prioritas, lalu waktu): kritis terbuka → cito aktif → rutin aktif → selesai/inkubasi. */
export function sortWorklist<T extends LabSample>(samples: readonly T[]): T[] {
  const rank = (s: LabSample) => {
    if (criticalOpen(s)) return 0;
    if (s.status === 'selesai' || s.status === 'inkubasi') return 3;
    return s.priority === 'cito' ? 1 : 2;
  };
  return [...samples].sort((a, b) => rank(a) - rank(b) || (b.tatMinutes ?? -1) - (a.tatMinutes ?? -1));
}

/** Waktu tunggu `00:52` (jam:menit sejak sampel diterima); `H+1` untuk kultur; `—` bila belum diterima. */
export function formatTat(s: Pick<LabSample, 'status' | 'tatMinutes'>): string {
  if (s.status === 'inkubasi') return 'H+1';
  if (s.tatMinutes === null) return '—';
  return `${pad(Math.floor(s.tatMinutes / 60))}:${pad(s.tatMinutes % 60)}`;
}

/** Jumlah parameter yang masih diproses analyzer. */
export function pendingCount(s: Pick<LabSample, 'results'>): number {
  return s.results.filter((r) => r.pending).length;
}

/** Tahap validasi berikutnya: teknis (analis) lalu klinis (dokter Sp.PK, TTE); null bila sudah dirilis. */
export function nextValidation(s: Pick<LabSample, 'status'>): 'teknis' | 'klinis' | null {
  if (s.status === 'hasil') return 'teknis';
  if (s.status === 'validasi-teknis') return 'klinis';
  return null;
}

/**
 * Alasan validasi diblokir (aturan mockup Lab): sampel ulang, hasil belum ada/lengkap, atau nilai kritis belum
 * dilaporkan dengan read-back. Null = boleh divalidasi (atau sudah selesai).
 */
export function validationBlock(s: LabSample, resample = false): string | null {
  if (s.status === 'selesai') return null;
  if (resample) return 'Validasi ditunda: menunggu sampel ulang.';
  if (s.status === 'inkubasi') return 'Kultur dalam inkubasi. Validasi setelah laporan pertumbuhan (H+1).';
  if (s.status === 'order' || s.status === 'diterima' || s.results.length === 0) {
    return 'Belum ada hasil untuk divalidasi.';
  }
  const pending = pendingCount(s);
  if (pending > 0) return `Validasi menunggu ${pending} parameter yang masih diproses analyzer.`;
  if (criticalOpen(s)) return 'Laporkan nilai kritis ke dokter (dengan read-back) sebelum validasi.';
  return null;
}

/** Tindakan di layar yang belum ada di data (simulasi, tidak disimpan): validasi, sampel ulang, laporan kritis. */
export interface LabLocal {
  technical?: { by: string; at: string };
  clinical?: { by: string; at: string };
  /** Jam permintaan sampel ulang (ISO); ada = sampel ulang aktif. */
  resampleAt?: string;
  critical?: { recipient: string; reportedAt: string; readBackAt: string; tookSeconds: number };
}

/** Gabungkan tindakan lokal ke sampel: validasi teknis → klinis berurutan, laporan kritis dengan read-back. */
export function applyLabLocal(s: LabSample, local: LabLocal | undefined): LabSample {
  if (!local) return s;
  let out: LabSample = s;
  if (local.critical && s.critical && criticalOpen(s)) {
    out = {
      ...out,
      critical: {
        ...s.critical,
        recipient: local.critical.recipient,
        reportedAt: local.critical.reportedAt,
        readBackAt: local.critical.readBackAt,
        elapsedSeconds: local.critical.tookSeconds,
        minutesToReport: Math.floor(local.critical.tookSeconds / 60),
      },
    };
  }
  if (local.resampleAt) return out;
  if (local.technical && out.status === 'hasil' && validationBlock(out) === null) {
    out = { ...out, status: 'validasi-teknis', technical: local.technical };
  }
  if (local.clinical && out.status === 'validasi-teknis') {
    out = { ...out, status: 'selesai', clinical: local.clinical };
  }
  return out;
}
