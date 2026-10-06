import type { SupportPatient } from '@simrs/shared';

/**
 * S09 · Pusat hasil kritis (mode presentasi, ADR-0023): nilai kritis lintas unit (laboratorium, mikrobiologi,
 * radiologi, diagnostik), timer batas lapor, pelaporan dengan penerima + read-back wajib, eskalasi berjenjang, dan
 * metrik kepatuhan durasi lapor. Logika murni: dipakai halaman, Server Action, dan tes. Aturan sama dengan rencana
 * fase 4 §4.3 (penerima = staf terpilih atau nama + peran; read-back wajib; tidak ada jalan penutupan lain).
 */

export type CriticalSource = 'lab' | 'mikrobiologi' | 'radiologi' | 'diagnostik';

export const SOURCE_LABEL: Record<CriticalSource, string> = {
  lab: 'Laboratorium',
  mikrobiologi: 'Mikrobiologi',
  radiologi: 'Radiologi',
  diagnostik: 'Diagnostik lain',
};

export type ReportChannel = 'telepon' | 'langsung';

export const CHANNEL_LABEL: Record<ReportChannel, string> = {
  telepon: 'Telepon (direkam)',
  langsung: 'Langsung (tatap muka)',
};

export interface CriticalReport {
  recipient: string;
  recipientRole: string;
  channel: ReportChannel;
  reportedBy: string;
  /** ISO; durasi dihitung dari `raisedAt` sampai saat ini (jam server di produksi). */
  reportedAt: string;
  readBackConfirmed: true;
}

export interface CriticalItem {
  id: string;
  source: CriticalSource;
  /** Unit pelapor, mis. "Laboratorium · kimia klinik". */
  unit: string;
  /** Identitas banner pasien (nama, RM, umur, alergi, penjamin). */
  patient: SupportPatient;
  location: string;
  /** Pemeriksaan + kode baku bila ada (LOINC/ICD-9-CM dari seed), mis. "Kalium · LOINC 2823-3". */
  test: string;
  /** Nilai/temuan yang dilaporkan (teks, mis. "6,4 mmol/L"). */
  valueText: string;
  /** Batas kritis yang berlaku saat hasil masuk, mis. "> 6,0 mmol/L". */
  limitText: string;
  /** Saat hasil kritis terbit (ISO). */
  raisedAt: string;
  limitMinutes: number;
  dpjp: string;
  /** Pilihan penerima (DPJP, dokter jaga, perawat penanggung jawab) dengan perannya. */
  recipients: ReadonlyArray<{ name: string; role: string }>;
  report: CriticalReport | null;
  /** Pasien skenario Simulasi (dilaporkan dari layar Lab agar cerita maju). */
  scenario?: boolean;
}

export type CriticalState = 'terbuka' | 'lewat-batas' | 'dilaporkan';

export function elapsedSecondsAt(item: Pick<CriticalItem, 'raisedAt'>, nowIso: string): number {
  return Math.max(0, Math.floor((Date.parse(nowIso) - Date.parse(item.raisedAt)) / 1000));
}

/** Menit utuh dari terbit sampai dilaporkan (null bila belum). */
export function reportMinutes(item: Pick<CriticalItem, 'raisedAt' | 'report'>): number | null {
  if (!item.report) return null;
  return Math.max(0, Math.floor((Date.parse(item.report.reportedAt) - Date.parse(item.raisedAt)) / 60_000));
}

/** Dilaporkan sebelum batas? Dihitung dalam detik, sama dengan timer `criticalState` (tepat di batas = lewat). */
export function reportedWithinLimit(
  item: Pick<CriticalItem, 'raisedAt' | 'report' | 'limitMinutes'>,
): boolean {
  if (!item.report) return false;
  return Date.parse(item.report.reportedAt) - Date.parse(item.raisedAt) < item.limitMinutes * 60_000;
}

export function criticalState(item: CriticalItem, elapsedSeconds: number): CriticalState {
  if (item.report) return 'dilaporkan';
  return elapsedSeconds >= item.limitMinutes * 60 ? 'lewat-batas' : 'terbuka';
}

export const STATE_VIEW: Record<CriticalState, { label: string; tone: 'danger' | 'warning' | 'success' }> = {
  terbuka: { label: 'Terbuka · timer berjalan', tone: 'warning' },
  'lewat-batas': { label: 'Lewat batas · eskalasi', tone: 'danger' },
  dilaporkan: { label: 'Dilaporkan · read-back', tone: 'success' },
};

/**
 * Jenjang eskalasi otomatis (rencana fase 4 §4.3): pada batas → kepala unit pelapor + DPJP + kepala ruangan;
 * batas + 30 menit → manajemen/komite mutu. Notifikasi in-app + WhatsApp tanpa PHI.
 */
export function escalationLevel(elapsedSeconds: number, limitMinutes: number): 0 | 1 | 2 {
  const min = elapsedSeconds / 60;
  if (min >= limitMinutes + 30) return 2;
  if (min >= limitMinutes) return 1;
  return 0;
}

export const ESCALATION_TEXT = {
  1: 'Eskalasi 1: kepala unit pelapor, DPJP, dan kepala ruangan dinotifikasi (in-app + WhatsApp tanpa data pasien)',
  2: 'Eskalasi 2: manajemen dan komite mutu dinotifikasi; masuk tinjauan insiden',
} as const;

/** Jam eskalasi terjadwal ("11.09") dari waktu terbit + menit. */
export function addMinutesIso(iso: string, minutes: number): string {
  return new Date(Date.parse(iso) + minutes * 60_000).toISOString();
}

export interface ReportInput {
  recipient: string;
  recipientRole: string;
  channel: ReportChannel | '';
  readBack: boolean;
}

export interface GateError {
  field: 'recipient' | 'recipientRole' | 'channel' | 'readBack' | 'item';
  message: string;
}

export const CRITICAL_UNKNOWN = 'Hasil kritis tidak ditemukan di daftar.';

/**
 * Gerbang pelaporan: hanya hasil kritis yang masih terbuka; penerima (≥ 5 karakter) + perannya, saluran, dan
 * read-back wajib. Laporan tanpa read-back tidak sah, sehingga hasil kritis tidak pernah tertutup tanpanya.
 */
export function reportGate(item: CriticalItem | undefined, input: ReportInput): GateError[] {
  if (!item) return [{ field: 'item', message: CRITICAL_UNKNOWN }];
  if (item.report) return [{ field: 'item', message: 'Hasil kritis ini sudah dilaporkan dengan read-back.' }];
  const errors: GateError[] = [];
  if (input.recipient.trim().length < 5)
    errors.push({ field: 'recipient', message: 'Nama penerima wajib diisi (minimal 5 karakter).' });
  if (input.recipientRole.trim().length < 3)
    errors.push({ field: 'recipientRole', message: 'Peran penerima wajib diisi (mis. DPJP, dokter jaga).' });
  if (input.channel === '') errors.push({ field: 'channel', message: 'Pilih saluran pelaporan.' });
  if (!input.readBack)
    errors.push({
      field: 'readBack',
      message: 'Read-back wajib: penerima mengulang nama pasien, pemeriksaan, dan nilainya.',
    });
  return errors;
}

/** Urutan daftar: terbuka/lewat batas dulu (paling lama menunggu di atas), lalu yang sudah dilaporkan (terbaru dulu). */
export function sortCritical(items: readonly CriticalItem[]): CriticalItem[] {
  return [...items].sort((a, b) => {
    if (!a.report !== !b.report) return a.report ? 1 : -1;
    if (!a.report && !b.report) return Date.parse(a.raisedAt) - Date.parse(b.raisedAt);
    return Date.parse(b.report?.reportedAt ?? b.raisedAt) - Date.parse(a.report?.reportedAt ?? a.raisedAt);
  });
}

export interface ComplianceMetrics {
  total: number;
  reported: number;
  open: number;
  overdue: number;
  withinLimit: number;
  /** Persen dilaporkan ≤ batas dari yang sudah dilaporkan (null bila belum ada laporan). */
  percent: number | null;
  medianMinutes: number | null;
  p90Minutes: number | null;
}

/** Persentil dengan metode nearest-rank (p dalam 0–100) atas daftar menit. */
export function percentile(values: readonly number[], p: number): number | null {
  if (values.length === 0) return null;
  const sorted = [...values].sort((a, b) => a - b);
  const rank = Math.max(1, Math.ceil((p / 100) * sorted.length));
  return sorted[Math.min(rank, sorted.length) - 1] ?? null;
}

/** Median (rata-rata dua tengah untuk jumlah genap, dibulatkan). */
export function median(values: readonly number[]): number | null {
  if (values.length === 0) return null;
  const s = [...values].sort((a, b) => a - b);
  const mid = Math.floor(s.length / 2);
  return s.length % 2 ? (s[mid] ?? null) : Math.round(((s[mid - 1] ?? 0) + (s[mid] ?? 0)) / 2);
}

/**
 * Metrik kepatuhan: dari durasi lapor (menit) hasil yang sudah dilaporkan, plus hitungan terbuka dan lewat batas
 * pada `elapsed` (detik per id) saat ini.
 */
export function complianceMetrics(
  items: readonly CriticalItem[],
  elapsed: Readonly<Record<string, number>>,
): ComplianceMetrics {
  const minutes = items.flatMap((i) => {
    const m = reportMinutes(i);
    return m === null ? [] : [m];
  });
  const withinLimit = items.filter(reportedWithinLimit).length;
  const open = items.filter((i) => !i.report);
  return {
    total: items.length,
    reported: minutes.length,
    open: open.length,
    overdue: open.filter((i) => (elapsed[i.id] ?? 0) >= i.limitMinutes * 60).length,
    withinLimit,
    percent: minutes.length ? Math.round((withinLimit / minutes.length) * 1000) / 10 : null,
    medianMinutes: median(minutes),
    p90Minutes: percentile(minutes, 90),
  };
}

/** Metrik dari daftar durasi saja (riwayat 7 hari): persen ≤ batas, median, p90. */
export function durationMetrics(durations: readonly number[], limitMinutes: number) {
  const within = durations.filter((d) => d <= limitMinutes).length;
  return {
    total: durations.length,
    withinLimit: within,
    percent: durations.length ? Math.round((within / durations.length) * 1000) / 10 : null,
    medianMinutes: median(durations),
    p90Minutes: percentile(durations, 90),
  };
}

/** "92,9%" (koma desimal Indonesia); null → "—". */
export function formatPercentId(v: number | null): string {
  if (v === null) return '—';
  return `${Number.isInteger(v) ? v : v.toFixed(1).replace('.', ',')}%`;
}

/** Terapkan laporan lokal (setelah Server Action menerima) ke daftar. */
export function applyReports(
  items: readonly CriticalItem[],
  local: Readonly<Record<string, CriticalReport>>,
): CriticalItem[] {
  return items.map((i) => (i.report || !local[i.id] ? i : { ...i, report: local[i.id] ?? null }));
}
