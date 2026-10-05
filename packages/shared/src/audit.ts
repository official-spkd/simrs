import { z } from 'zod';

/** Aksi audit yang dikenal (P04). Tambahkan di sini, jangan mengarang string di modul. */
export const AUDIT_ACTIONS = [
  'read',
  'search',
  'create',
  'update',
  'deactivate',
  'print',
  'export',
  'verify',
  'login',
  'login_failed',
  'logout',
  'mfa_enrolled',
  'password_change',
  'session_revoked',
  'access_denied',
  'break_glass',
  'merge',
  'unmerge',
  'correct',
  'sign',
  'review',
  'submit',
  'publish',
] as const;

export type AuditAction = (typeof AUDIT_ACTIONS)[number];

export const AUDIT_OUTCOMES = ['success', 'denied'] as const;
export type AuditOutcome = (typeof AUDIT_OUTCOMES)[number];

/** Label aksi untuk layar Audit. */
export const AUDIT_ACTION_LABEL: Record<AuditAction, string> = {
  read: 'Baca',
  search: 'Cari',
  create: 'Buat',
  update: 'Ubah',
  deactivate: 'Nonaktifkan',
  print: 'Cetak',
  export: 'Ekspor',
  verify: 'Verifikasi',
  login: 'Masuk',
  login_failed: 'Gagal masuk',
  logout: 'Keluar',
  mfa_enrolled: 'Daftar MFA',
  password_change: 'Ganti sandi',
  session_revoked: 'Sesi dicabut',
  access_denied: 'Akses ditolak',
  break_glass: 'Break-the-glass',
  merge: 'Gabung',
  unmerge: 'Pisah',
  correct: 'Koreksi',
  sign: 'Tanda tangan',
  review: 'Tinjau',
  submit: 'Ajukan',
  publish: 'Terbitkan',
};

/** Kelompok aksi untuk filter layar Audit (design/mockups/Audit.dc.html). */
export const AUDIT_ACTION_GROUPS = {
  baca: { label: 'Baca', actions: ['read', 'search'] },
  ubah: {
    label: 'Ubah dan koreksi',
    actions: ['create', 'update', 'deactivate', 'correct', 'merge', 'unmerge', 'sign', 'submit', 'publish'],
  },
  cetak: { label: 'Cetak dan ekspor', actions: ['print', 'export'] },
  akun: {
    label: 'Akun dan akses',
    actions: [
      'login',
      'login_failed',
      'logout',
      'mfa_enrolled',
      'password_change',
      'session_revoked',
      'access_denied',
    ],
  },
  darurat: { label: 'Break-the-glass', actions: ['break_glass', 'review'] },
} as const satisfies Record<string, { label: string; actions: readonly AuditAction[] }>;
export type AuditActionGroup = keyof typeof AUDIT_ACTION_GROUPS;

/**
 * Temuan anomali yang dihitung dari jejak audit (bukan tabel tersendiri). Kunci stabil
 * `<jenis>:<id pengguna | ->:<tanggal WIB>`; keputusan tinjauan dicatat sebagai entri audit `review`
 * dengan `resource_type = audit_anomaly` dan `resource_id = kunci` (append-only, tidak bisa dihapus).
 */
export const AUDIT_ANOMALY_KINDS = ['login_failed', 'access_denied', 'night', 'volume'] as const;
export type AuditAnomalyKind = (typeof AUDIT_ANOMALY_KINDS)[number];
export const AUDIT_ANOMALY_KEY =
  /^(login_failed|access_denied|night|volume):([0-9a-f-]{36}|-):(\d{4}-\d{2}-\d{2})$/;

export const AUDIT_REVIEW_OUTCOMES = ['sah', 'perlu_klarifikasi'] as const;
export type AuditReviewOutcome = (typeof AUDIT_REVIEW_OUTCOMES)[number];

const anomalyKey = z.string().regex(AUDIT_ANOMALY_KEY, 'Kunci temuan tidak valid');

export const auditAnomalyReviewSchema = z.strictObject({
  key: anomalyKey,
  outcome: z.enum(AUDIT_REVIEW_OUTCOMES),
  note: z.string().trim().max(500).optional(),
});
export type AuditAnomalyReviewInput = z.infer<typeof auditAnomalyReviewSchema>;

/** Riwayat tinjauan satu temuan: `GET /audit/anomalies/reviews?key=`. */
export const auditAnomalyReviewsQuerySchema = z.strictObject({ key: anomalyKey });

/**
 * Satu keputusan di riwayat tinjauan temuan (terbaru dulu). `effective` = keputusan yang berlaku (entri `review`
 * terbaru); yang lain tetap tersimpan sebagai jejak. Tanpa PHI: hanya peninjau, waktu, keputusan, dan catatan.
 */
export interface AuditAnomalyReviewEntry {
  seq: string;
  outcome: AuditReviewOutcome;
  note: string | null;
  reviewedAt: string;
  reviewer: { id: string; displayName: string } | null;
  reviewerRole: string | null;
  effective: boolean;
}

/**
 * Peran yang wajar bekerja malam (jaga 24 jam). Akses data pasien di jam malam oleh peran lain ditandai
 * sebagai anomali. Diperhalus dengan jadwal shift (F01) setelah tersedia.
 */
export const NIGHT_SHIFT_ROLES = [
  'perawat',
  'bidan',
  'dokter',
  'dokter_residen',
  'apoteker',
  'analis_lab',
  'radiografer',
] as const;

/**
 * Pemeriksaan keutuhan jejak audit (`GET /audit/verify`, ADR-0072). `checkpoint` (bawaan) menghitung ulang hash
 * hanya sejak jangkar sah terakhir dan mencocokkan SEMUA jangkar dengan rantai; `full` menghitung ulang seluruh rantai.
 */
export const AUDIT_VERIFY_MODES = ['checkpoint', 'full'] as const;
export type AuditVerifyMode = (typeof AUDIT_VERIFY_MODES)[number];
export const auditVerifyQuerySchema = z.strictObject({
  mode: z.enum(AUDIT_VERIFY_MODES).default('checkpoint'),
});

/**
 * Temuan pemeriksaan keutuhan:
 * - `CHAIN_BROKEN`: hash/urutan entri tidak cocok (baris diubah, disisipkan, atau dihapus di tengah).
 * - `TRUNCATION_DETECTED`: entri yang sudah dijangkar tidak ada lagi (kepala rantai di bawah jangkar).
 * - `ANCHOR_MISMATCH`: entri di seq jangkar ada tetapi hash-nya lain (dipotong lalu ditambah, atau ditulis ulang).
 * - `ANCHOR_TAMPERED`: tanda tangan jangkar tidak sah (baris jangkar diubah atau dipalsukan).
 * - `ANCHOR_KEY_UNKNOWN`: jangkar ditandatangani kunci lain (rotasi tanpa kunci lama, atau dipalsukan).
 */
export const AUDIT_VERIFY_ISSUES = [
  'CHAIN_BROKEN',
  'TRUNCATION_DETECTED',
  'ANCHOR_MISMATCH',
  'ANCHOR_TAMPERED',
  'ANCHOR_KEY_UNKNOWN',
] as const;
export type AuditVerifyIssueCode = (typeof AUDIT_VERIFY_ISSUES)[number];

export interface AuditVerifyIssue {
  code: AuditVerifyIssueCode;
  /** seq entri/jangkar yang terlibat (desimal), bila ada. */
  seq: string | null;
  /** Waktu jangkar yang terlibat, bila ada. */
  anchoredAt: string | null;
}

export interface AuditVerifyResult {
  /** Rantai utuh DAN tidak ada temuan jangkar. */
  intact: boolean;
  mode: AuditVerifyMode;
  /** Jumlah entri yang hash-nya dihitung ulang. */
  checked: number;
  firstBrokenSeq: string | null;
  headSeq: string | null;
  /** Jangkar sah tempat pemeriksaan `checkpoint` dimulai (null = dari entri pertama). */
  checkpoint: { seq: string; anchoredAt: string } | null;
  anchors: {
    total: number;
    verified: number;
    /** false = kunci jangkar tidak dipasang (hanya di luar produksi); jangkar tidak diperiksa, mode jatuh ke `full`. */
    keyConfigured: boolean;
    latestSeq: string | null;
  };
  /** Paling banyak `AUDIT_VERIFY_MAX_ISSUES` temuan (yang paling awal); `issueCount` = jumlah seluruhnya. */
  issues: AuditVerifyIssue[];
  issueCount: number;
  verifiedAt: string;
}

export const AUDIT_VERIFY_MAX_ISSUES = 20;
