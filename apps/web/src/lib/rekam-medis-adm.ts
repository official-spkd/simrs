/**
 * B09 · Rekam medis administratif (rencana fase 8 §8.6a–8.6c): peminjaman berkas fisik lama, pelepasan informasi
 * dan hak subjek data (UU PDP), serta retensi + pemusnahan berjejak. Fungsi murni untuk layar mode presentasi
 * (ADR-0023); backend kelak memakai aturan yang sama (`record.loan_days`, `roi.response_hours`).
 */

/** `record.loan_days`: berkas fisik wajib kembali ≤ 3 hari. */
export const LOAN_DAYS = 3;
/** `roi.response_hours`: permintaan informasi dijawab ≤ 3×24 jam. */
export const ROI_RESPONSE_HOURS = 72;
/** Sisa jam ≤ ini ditandai "mendekati tenggat". */
export const ROI_WARN_HOURS = 24;

const DAY_MS = 86_400_000;
const HOUR_MS = 3_600_000;

/** Tanggal kalender `YYYY-MM-DD` → hari ke-n (UTC, tanpa zona). */
function dayNumber(iso: string): number {
  const [y = 1970, m = 1, d = 1] = iso.slice(0, 10).split('-').map(Number);
  return Date.UTC(y, m - 1, d) / DAY_MS;
}

function addDays(iso: string, days: number): string {
  return new Date((dayNumber(iso) + days) * DAY_MS).toISOString().slice(0, 10);
}

// ---------------------------------------------------------------------------------------------------------------
// Peminjaman berkas

export interface RecordFile {
  id: string;
  rm: string;
  patientName: string;
  /** Lokasi rak berkas fisik. */
  rack: string;
  /** Tanggal kunjungan terakhir yang tercatat di berkas fisik. */
  lastVisit: string;
  /** Legal hold aktif (mis. perkara pengadilan): berkas tidak boleh keluar ruang RM. */
  legalHold: string | null;
  /** Penanda rahasia (VIP/karyawan): peminjaman wajib alasan yang ditinjau petugas privasi. */
  confidential: boolean;
}

export interface RecordLoan {
  id: string;
  fileId: string;
  borrower: string;
  unit: string;
  purpose: string;
  /** Tanggal keluar `YYYY-MM-DD`. */
  outDate: string;
  dueDate: string;
  returnedAt: string | null;
  remindedAt?: string | null;
}

export type LoanStatus = 'dipinjam' | 'terlambat' | 'kembali';

export function loanDueDate(outDate: string, days = LOAN_DAYS): string {
  return addDays(outDate, days);
}

export function loanStatus(loan: Pick<RecordLoan, 'dueDate' | 'returnedAt'>, today: string): LoanStatus {
  if (loan.returnedAt) return 'kembali';
  return dayNumber(today) > dayNumber(loan.dueDate) ? 'terlambat' : 'dipinjam';
}

/** Hari keterlambatan (0 bila belum lewat jatuh tempo atau sudah kembali). */
export function overdueDays(loan: Pick<RecordLoan, 'dueDate' | 'returnedAt'>, today: string): number {
  if (loan.returnedAt) return 0;
  return Math.max(0, dayNumber(today) - dayNumber(loan.dueDate));
}

/** Alasan berkas tidak bisa dipinjamkan keluar ruang RM, atau null bila boleh. */
export function lendBlock(file: RecordFile, loans: readonly RecordLoan[]): string | null {
  if (file.legalHold)
    return `Legal hold (${file.legalHold}): hanya dibaca di ruang RM, tidak boleh dipinjam keluar.`;
  const open = loans.find((l) => l.fileId === file.id && !l.returnedAt);
  if (open) return `Berkas sedang dipinjam ${open.unit} sampai ${open.dueDate}.`;
  return null;
}

// ---------------------------------------------------------------------------------------------------------------
// Pelepasan informasi dan hak subjek data

export type RoiKind = 'salinan' | 'koreksi' | 'pihak-ketiga';

export const ROI_KIND_LABEL: Record<RoiKind, string> = {
  salinan: 'Hak akses & salinan (pasien)',
  koreksi: 'Hak perbaikan data (pasien)',
  'pihak-ketiga': 'Pelepasan ke pihak ketiga',
};

export const ROI_STAGES = ['Diajukan', 'Identitas & dasar diverifikasi', 'Disetujui', 'Dipenuhi'] as const;

/** Tahap: 0 diajukan, 1 terverifikasi, 2 disetujui, 3 dipenuhi (selesai). */
export type RoiStage = 0 | 1 | 2 | 3;

export function roiDeadline(receivedAt: string, hours = ROI_RESPONSE_HOURS): string {
  return new Date(Date.parse(receivedAt) + hours * HOUR_MS).toISOString();
}

/** Sisa jam (dibulatkan ke bawah; negatif = terlambat). */
export function hoursLeft(deadline: string, now: string): number {
  return Math.floor((Date.parse(deadline) - Date.parse(now)) / HOUR_MS);
}

export type DeadlineTone = 'aman' | 'mendekati' | 'lewat';

export function deadlineTone(hours: number): DeadlineTone {
  if (hours < 0) return 'lewat';
  return hours <= ROI_WARN_HOURS ? 'mendekati' : 'aman';
}

export function deadlineText(hours: number): string {
  if (hours < 0) return `lewat ${-hours} jam`;
  if (hours < 1) return 'kurang dari 1 jam';
  return `sisa ${hours} jam`;
}

/** Tiga pemeriksaan verifikasi wajib sebelum permintaan bisa disetujui. */
export const ROI_CHECKS = [
  'Identitas pemohon cocok dengan dokumen asli (KTP/kuasa/surat tugas)',
  'Dasar sah dan masih berlaku (hak subjek data, persetujuan tertulis, atau penetapan hukum)',
  'Lingkup dokumen sebatas yang diminta (data minimal)',
] as const;

export function verificationBlock(checks: readonly boolean[]): string | null {
  const done = checks.filter(Boolean).length;
  return done === ROI_CHECKS.length
    ? null
    : `Centang ketiga pemeriksaan dulu (${done}/${ROI_CHECKS.length}).`;
}

/** Pemisahan tugas: penyetuju harus orang lain dari penerima permintaan. */
export function approvalBlock(receiver: string, approver: string | null): string | null {
  if (!approver) return 'Pilih penyetuju dulu.';
  if (approver === receiver) return 'Penyetuju harus berbeda dari penerima permintaan (pemisahan tugas).';
  return null;
}

// ---------------------------------------------------------------------------------------------------------------
// Retensi dan pemusnahan

export interface RetentionBatch {
  id: string;
  /** Kelompok berkas, mis. "Rak R-12 · rawat jalan 2014–2015". */
  label: string;
  setting: 'rawat-jalan' | 'rawat-inap';
  /** Kunjungan terakhir paling baru di kelompok ini. */
  lastVisit: string;
  files: number;
  /** Lembar simpan permanen (resume, persetujuan tindakan, identitas, laporan operasi) yang dipisahkan. */
  permanentSheets: number;
  legalHoldFiles: number;
}

/** Masa inaktif berkas fisik sebelum boleh diusulkan musnah (tahun). */
export const RETENTION_YEARS: Record<RetentionBatch['setting'], number> = {
  'rawat-jalan': 5,
  'rawat-inap': 5,
};

export function inactiveYears(lastVisit: string, today: string): number {
  const [ly = 0, lm = 1, ld = 1] = lastVisit.split('-').map(Number);
  const [ty = 0, tm = 1, td = 1] = today.split('-').map(Number);
  return ty - ly - (tm < lm || (tm === lm && td < ld) ? 1 : 0);
}

/** Kandidat pemusnahan: inaktif melewati masa retensi; berkas legal hold dikeluarkan dari hitungan. */
export function retentionCandidates(
  batches: readonly RetentionBatch[],
  today: string,
): Array<RetentionBatch & { eligibleFiles: number }> {
  return batches
    .filter((b) => inactiveYears(b.lastVisit, today) >= RETENTION_YEARS[b.setting])
    .map((b) => ({ ...b, eligibleFiles: b.files - b.legalHoldFiles }))
    .filter((b) => b.eligibleFiles > 0);
}

export const DESTRUCTION_STAGES = [
  'Kandidat dihitung sistem',
  'Diusulkan komite RM',
  'Disetujui direktur',
  'Berita acara ber-TTE',
  'Dimusnahkan (fisik)',
] as const;

/** Tombol tahap berikutnya (indeks = tahap saat ini 0…3). */
export const DESTRUCTION_ACTIONS = [
  'Usulkan ke komite RM',
  'Setujui pemusnahan (direktur)',
  'Terbitkan berita acara (TTE)',
  'Catat pemusnahan selesai',
] as const;

/** Tahap hanya maju satu per satu; null = boleh, selain itu alasan. */
export function destructionStepBlock(current: number, target: number): string | null {
  if (current >= DESTRUCTION_STAGES.length - 1) return 'Pemusnahan sudah tercatat selesai.';
  if (target !== current + 1) return 'Urutan persetujuan tidak bisa dilompati.';
  return null;
}

/** Siapa yang boleh menjalankan tiap tahap (pemisahan tugas pengusul ≠ penyetuju). */
export function destructionActorBlock(target: number, actor: string, proposer: string | null): string | null {
  if (target === 2 && actor === proposer) return 'Penyetuju harus berbeda dari pengusul (pemisahan tugas).';
  return null;
}

/** Pemusnahan elektronik ditolak sampai ada ADR crypto-shredding (rencana fase 8 §8.6b). */
export const ELECTRONIC_DESTRUCTION_BLOCK =
  'Masa simpan rekam medis elektronik 25 tahun; pemusnahan data elektronik belum diizinkan (menunggu ADR penghapusan kriptografis).';
