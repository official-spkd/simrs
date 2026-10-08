import { z } from 'zod';

/**
 * F01–F08 · Kode galat front office (fase 2) beserta status HTTP dan pesan bawaannya. Dipisah agar modul domain
 * cukup memanggil `frontOfficeError(kode)`; pesan boleh dipertajam di pemanggil, kode dan status tetap.
 * Galat BPJS di API: `BPJS_UNAVAILABLE` = tidak terjangkau/timeout (coba lagi, pendaftaran jalan terus);
 * `BPJS_REJECTED` = BPJS menjawab galat bisnis (kode ≠ 200 walau HTTP 200), alasannya di `details.reason` berupa kode
 * penolakan kontrak kawat (`BPJS_REJECTIONS`, mis. `BPJS_PESERTA_TIDAK_AKTIF`; skema `bpjsRejectedDetailsSchema`).
 */
export const FRONT_OFFICE_ERRORS = {
  // F01 · Jadwal dan kuota
  QUOTA_FULL: { status: 409, message: 'Kuota sesi ini sudah penuh' },
  QUOTA_BELOW_BOOKED: {
    status: 409,
    message: 'Kuota tidak boleh di bawah jumlah pasien yang sudah booking',
  },
  SESSION_CLOSED: {
    status: 409,
    message: 'Sesi praktik ini tidak menerima pasien (cuti, batal, atau lewat)',
  },
  SCHEDULE_OVERLAP: { status: 409, message: 'Jadwal bentrok dengan jadwal lain dokter ini' },
  // F02 · Booking
  BOOKING_NOT_FOUND: { status: 404, message: 'Booking tidak ditemukan' },
  BOOKING_OUT_OF_RANGE: { status: 422, message: 'Tanggal booking di luar rentang yang diizinkan' },
  BOOKING_DUPLICATE: { status: 409, message: 'Pasien sudah punya booking di poli dan tanggal yang sama' },
  BOOKING_STATE_INVALID: { status: 409, message: 'Status booking tidak mengizinkan tindakan ini' },
  // F04 · Antrean
  QUEUE_EMPTY: { status: 409, message: 'Tidak ada antrean yang menunggu' },
  TICKET_STATE_INVALID: { status: 409, message: 'Status tiket antrean tidak mengizinkan tindakan ini' },
  // F03/F06 · Registrasi, penjaminan, SEP
  ENCOUNTER_DUPLICATE: {
    status: 409,
    message: 'Pasien sudah terdaftar di layanan yang sama dan masih aktif',
  },
  ENCOUNTER_STATE_INVALID: { status: 409, message: 'Status kunjungan tidak mengizinkan tindakan ini' },
  GENERAL_CONSENT_REQUIRED: { status: 422, message: 'Persetujuan umum belum ada' },
  IDEMPOTENCY_KEY_REQUIRED: { status: 400, message: 'Header Idempotency-Key wajib untuk permintaan ini' },
  IDEMPOTENCY_KEY_REUSED: {
    status: 409,
    message: 'Idempotency-Key sudah dipakai untuk permintaan dengan isi berbeda',
  },
  COVERAGE_LOCKED: { status: 409, message: 'Penjaminan terkunci karena SEP sudah terbit' },
  SEP_DUPLICATE: { status: 409, message: 'SEP untuk kunjungan ini sudah ada' },
  SEP_STATE_INVALID: { status: 409, message: 'Status SEP tidak mengizinkan tindakan ini' },
  REFERRAL_EXPIRED: { status: 422, message: 'Rujukan sudah tidak berlaku' },
  REFERRAL_STATE_INVALID: { status: 409, message: 'Status rujukan tidak mengizinkan tindakan ini' },
  /** Tidak terjangkau/timeout, termasuk lookup sinkron BPJS (VClaim/Antrean) yang lewat 5 detik (ADR-0025). */
  BPJS_UNAVAILABLE: { status: 503, message: 'Layanan BPJS tidak dapat dihubungi. Coba lagi sebentar.' },
  BPJS_REJECTED: { status: 422, message: 'Permintaan ditolak BPJS' },
  // F05 · Perangkat dan anjungan
  DEVICE_NOT_ALLOWED: { status: 403, message: 'Perangkat atau akun ini tidak berhak memakai layanan ini' },
  KIOSK_LOOKUP_EXPIRED: { status: 410, message: 'Sesi anjungan berakhir. Ulangi dari awal.' },
  KIOSK_NEEDS_COUNTER: { status: 422, message: 'Silakan ke loket pendaftaran untuk dibantu petugas' },
} as const satisfies Record<string, { status: number; message: string }>;

export type FrontOfficeErrorCode = keyof typeof FRONT_OFFICE_ERRORS;

/** Urutan tetap (bagian dari `ERROR_CODES`). */
export const FRONT_OFFICE_ERROR_CODES = [
  'QUOTA_FULL',
  'QUOTA_BELOW_BOOKED',
  'SESSION_CLOSED',
  'SCHEDULE_OVERLAP',
  'BOOKING_NOT_FOUND',
  'BOOKING_OUT_OF_RANGE',
  'BOOKING_DUPLICATE',
  'BOOKING_STATE_INVALID',
  'QUEUE_EMPTY',
  'TICKET_STATE_INVALID',
  'ENCOUNTER_DUPLICATE',
  'ENCOUNTER_STATE_INVALID',
  'GENERAL_CONSENT_REQUIRED',
  'IDEMPOTENCY_KEY_REQUIRED',
  'IDEMPOTENCY_KEY_REUSED',
  'COVERAGE_LOCKED',
  'SEP_DUPLICATE',
  'SEP_STATE_INVALID',
  'REFERRAL_EXPIRED',
  'REFERRAL_STATE_INVALID',
  'BPJS_UNAVAILABLE',
  'BPJS_REJECTED',
  'DEVICE_NOT_ALLOWED',
  'KIOSK_LOOKUP_EXPIRED',
  'KIOSK_NEEDS_COUNTER',
] as const satisfies readonly FrontOfficeErrorCode[];

/**
 * K01–K15 · Kode galat klinis (fase 3, rencana §3.0a). `CDS_BLOCKED` sudah ada di daftar umum (gerbang CDS, 422).
 */
export const CLINICAL_ERRORS = {
  // Entri klinis berversi (ADR-0004/0028)
  RECORD_SUPERSEDED: {
    status: 409,
    message: 'Versi ini sudah digantikan versi lain; muat ulang lalu koreksi versi terbaru',
  },
  RECORD_LOCKED: { status: 409, message: 'Entri sudah ditandatangani (TTE); perubahan hanya lewat addendum' },
  RECORD_NOT_AUTHOR: { status: 403, message: 'Koreksi hanya oleh penulis asli; PPA lain menambah addendum' },
  RECORD_NOT_FINAL: { status: 409, message: 'Entri ini tidak final sehingga tidak bisa diberi addendum' },
  COSIGN_NOT_ALLOWED: {
    status: 403,
    message: 'Co-sign hanya oleh DPJP/rawat bersama, bukan atas catatan sendiri',
  },
  // K08 · Satu diagnosis utama final per kunjungan (ditegakkan API di bawah kunci per kunjungan, ADR-0028)
  PRIMARY_DIAGNOSIS_EXISTS: {
    status: 409,
    message:
      'Kunjungan ini sudah punya diagnosis utama; koreksi diagnosis utama yang ada atau pilih peran sekunder',
  },
  // K10 · Satu DPJP utama aktif per kunjungan (indeks unik `encounter_participants_one_primary`)
  PRIMARY_DPJP_EXISTS: {
    status: 409,
    message: 'Kunjungan ini sudah punya DPJP utama aktif; akhiri keanggotaannya lebih dulu (alih rawat)',
  },
  // K03 · Triase
  TRIAGE_REASON_REQUIRED: {
    status: 422,
    message: 'Level di bawah saran sistem wajib disertai alasan klinis (minimal 10 karakter)',
  },
  TRIAGE_LEVEL_NOT_ALLOWED: { status: 422, message: 'Level ini di bawah batas protokol keluhan pasien' },
  // K04/K05 · ADT dan bed
  BED_NOT_AVAILABLE: { status: 409, message: 'Tempat tidur tidak tersedia atau sudah dipakai' },
  BED_VERSION_CONFLICT: { status: 409, message: 'Status tempat tidur sudah diubah petugas lain; muat ulang' },
  DISCHARGE_BLOCKED: {
    status: 409,
    message: 'Syarat pulang belum lengkap (disposisi, resume final, atau surat)',
  },
  // K13 · Resume medis: butir wajib server (12 butir rawat inap, ringkas rawat jalan) sebelum TTE
  RESUME_INCOMPLETE: { status: 422, message: 'Resume belum lengkap; lengkapi butir wajib sebelum TTE' },
  // K09 · resep: rute bertentangan dengan bentuk sediaan (injeksi + oral, tablet + intravena)
  MEDICATION_ROUTE_INVALID: { status: 422, message: 'Rute pemberian tidak sesuai bentuk sediaan obat' },
  // K12 · eMAR
  WRISTBAND_MISMATCH: { status: 422, message: 'Gelang tidak cocok dengan pasien kunjungan ini' },
  WRISTBAND_SCAN_REQUIRED: {
    status: 422,
    message: 'Pindai gelang pasien lebih dulu (pindaian berlaku 10 menit untuk perawat yang sama)',
  },
  MEDICATION_ALREADY_GIVEN: { status: 409, message: 'Dosis jadwal ini sudah tercatat diberikan' },
  DOUBLE_CHECK_REQUIRED: { status: 422, message: 'Obat kewaspadaan tinggi wajib cek ganda perawat kedua' },
  LATE_REASON_REQUIRED: {
    status: 422,
    message: 'Dosis terlambat wajib disertai alasan (minimal 10 karakter)',
  },
  // K11 · Persetujuan tindakan (draf tablet → final ber-TTE)
  CONSENT_SIGNATURES_REQUIRED: {
    status: 422,
    message:
      'Persetujuan wajib tanda tangan pasien/wali dan atestasi saksi petugas (orang lain dari dokter yang memfinalkan)',
  },
  CONSENT_EDUCATION_REQUIRED: {
    status: 422,
    message:
      'Edukasi tindakan belum terverifikasi paham; catat edukasi terintegrasi (topik tindakan, evaluasi paham) lebih dulu',
  },
  CONSENT_CLOSED: {
    status: 409,
    message: 'Draf persetujuan sudah final, ditolak, atau dibatalkan; tidak bisa diubah',
  },
  // K10 · Konsultasi
  CONSULT_NOT_RECIPIENT: {
    status: 403,
    message: 'Konsultasi ini hanya dijawab dokter tujuan atau dokter unit tujuan',
  },
} as const satisfies Record<string, { status: number; message: string }>;

export type ClinicalErrorCode = keyof typeof CLINICAL_ERRORS;

/** Urutan tetap (bagian dari `ERROR_CODES`). */
export const CLINICAL_ERROR_CODES = [
  'RECORD_SUPERSEDED',
  'RECORD_LOCKED',
  'RECORD_NOT_AUTHOR',
  'RECORD_NOT_FINAL',
  'COSIGN_NOT_ALLOWED',
  'PRIMARY_DIAGNOSIS_EXISTS',
  'PRIMARY_DPJP_EXISTS',
  'TRIAGE_REASON_REQUIRED',
  'TRIAGE_LEVEL_NOT_ALLOWED',
  'BED_NOT_AVAILABLE',
  'BED_VERSION_CONFLICT',
  'DISCHARGE_BLOCKED',
  'RESUME_INCOMPLETE',
  'MEDICATION_ROUTE_INVALID',
  'WRISTBAND_MISMATCH',
  'WRISTBAND_SCAN_REQUIRED',
  'MEDICATION_ALREADY_GIVEN',
  'DOUBLE_CHECK_REQUIRED',
  'LATE_REASON_REQUIRED',
  'CONSENT_SIGNATURES_REQUIRED',
  'CONSENT_EDUCATION_REQUIRED',
  'CONSENT_CLOSED',
  'CONSULT_NOT_RECIPIENT',
] as const satisfies readonly ClinicalErrorCode[];

/**
 * S01–S10 · Kode galat penunjang (fase 4, rencana §4.0a): gerbang keselamatan lab, nilai kritis, farmasi, stok,
 * radiologi, kamar operasi, bank darah. Gerbang yang juga dijaga database (CHECK/trigger) memakai kode yang sama
 * lewat pemetaan galat DB di API.
 */
export const SUPPORT_ERRORS = {
  // S01/S09 · Laboratorium dan nilai kritis
  RESULT_INCOMPLETE: { status: 409, message: 'Hasil pemeriksaan belum lengkap untuk divalidasi' },
  VALIDATION_ORDER: { status: 409, message: 'Validasi klinis hanya setelah validasi teknis' },
  CRITICAL_OPEN: {
    status: 409,
    message: 'Nilai kritis belum dilaporkan ke dokter dengan read-back; validasi diblokir',
  },
  QC_REJECTED: {
    status: 409,
    message: 'QC hari ini ditolak (Westgard 1-3s/2-2s); validasi butuh override beralasan',
  },
  CRITICAL_RECIPIENT_REQUIRED: {
    status: 422,
    message: 'Penerima laporan nilai kritis wajib: pilih staf atau isi nama (≥ 5 karakter) dan peran',
  },
  CRITICAL_READBACK_REQUIRED: { status: 422, message: 'Read-back penerima wajib dikonfirmasi' },
  SPECIMEN_STATE_INVALID: { status: 409, message: 'Status spesimen tidak mengizinkan tindakan ini' },
  // S03 · Radiologi
  SLOT_CONFLICT: { status: 409, message: 'Slot modalitas pada jam itu sudah terisi' },
  CONTRAST_SCREENING_REQUIRED: {
    status: 422,
    message:
      'Skrining kontras (alergi kontras, eGFR, kehamilan) belum lolos; override hanya dokter beralasan',
  },
  CT_DOSE_REQUIRED: { status: 422, message: 'Pemeriksaan CT wajib mencatat CTDIvol dan DLP' },
  // S04/S05 · Farmasi dan stok
  CDS_UNRESOLVED: {
    status: 409,
    message: 'Masih ada peringatan CDS mayor/sedang yang belum ditindaklanjuti',
  },
  STOCK_INSUFFICIENT: { status: 409, message: 'Stok batch di depo ini tidak mencukupi' },
  STOCK_CONFLICT: {
    status: 409,
    message: 'Stok yang sama sedang diubah transaksi lain; muat ulang lalu ulangi aksi',
  },
  BATCH_EXPIRED: { status: 409, message: 'Batch sudah kedaluwarsa dan tidak boleh dikeluarkan ke pasien' },
  DOUBLE_CHECK_SAME_USER: { status: 409, message: 'Cek ganda harus oleh apoteker lain, bukan penyiap' },
  HIGH_ALERT_DOUBLE_CHECK_REQUIRED: {
    status: 409,
    message: 'Obat kewaspadaan tinggi wajib cek ganda apoteker kedua sebelum diserahkan',
  },
  // S06 · Kamar operasi
  ROOM_OVERLAP: { status: 409, message: 'Jadwal kamar operasi bertumpang tindih dengan kasus lain' },
  CHECKLIST_INCOMPLETE: { status: 409, message: 'Semua butir fase ini wajib dicentang sebelum dikonfirmasi' },
  CHECKLIST_ORDER: { status: 409, message: 'Urutan daftar tilik: sign in → time out → sign out' },
  TIMEOUT_REQUIRED: {
    status: 409,
    message: 'Insisi terkunci sampai time out dikonfirmasi (override dokter beralasan ≥ 15 karakter)',
  },
  COUNT_MISMATCH: {
    status: 409,
    message: 'Hitung akhir kasa/instrumen belum cocok atau selisih belum ditindaklanjuti',
  },
  // S08 · Bank darah
  BLOOD_INCOMPATIBLE: { status: 409, message: 'Golongan darah kantong tidak kompatibel dengan pasien' },
  CROSSMATCH_REQUIRED: {
    status: 409,
    message: 'Crossmatch cocok wajib sebelum kantong dikeluarkan (darurat: golongan O beralasan dokter)',
  },
  // S08 · Gerbang 4.9 (ADR-0105)
  BLOOD_GROUP_REQUIRED: {
    status: 409,
    message: 'Golongan darah pasien (ABO dan Rh) belum diperiksa; isi golongan sebelum crossmatch',
  },
  BLOOD_GROUP_LOCKED: { status: 409, message: 'Golongan pasien terkunci setelah crossmatch pertama' },
  BLOOD_UNIT_UNAVAILABLE: {
    status: 409,
    message: 'Kantong tidak tersedia (kedaluwarsa, sudah keluar, atau dicadangkan untuk permintaan lain)',
  },
  BLOOD_COMPONENT_MISMATCH: { status: 409, message: 'Komponen kantong tidak sesuai permintaan' },
  BLOOD_DOUBLE_CHECK_REQUIRED: {
    status: 409,
    message: 'Cek ganda pertama tidak ada, tidak cocok, atau lewat 30 menit; ulangi cek ganda',
  },
  BLOOD_SECOND_CHECKER_SAME: {
    status: 409,
    message: 'Petugas kedua harus orang lain dari sesinya sendiri, bukan pemeriksa pertama/pemasang',
  },
  BLOOD_WRONG_PATIENT: {
    status: 422,
    message: 'Gelang pasien tidak cocok dengan permintaan darah. Hentikan: jangan pasang kantong',
  },
  BLOOD_WRONG_BAG: {
    status: 422,
    message: 'Nomor kantong tidak cocok dengan kantong yang dikeluarkan untuk pasien ini',
  },
  TRANSFUSION_STATE: { status: 409, message: 'Status transfusi tidak mengizinkan tindakan ini' },
  // S07/S08 · 4.9b (ADR-0108)
  BLOOD_REQUEST_CLOSED: { status: 409, message: 'Permintaan darah sudah selesai atau batal' },
  DIET_VERIFIED: { status: 409, message: 'Order diet sudah diverifikasi atau tidak aktif' },
  DIET_NOT_VERIFIED: {
    status: 409,
    message: 'Order diet belum diverifikasi ahli gizi; makanan belum boleh diantar',
  },
  NPO_ACTIVE: {
    status: 409,
    message: 'Pasien sedang puasa. Makanan tidak diantar sampai puasa dicabut',
  },
  NUTRITION_SCREENING_REQUIRED: {
    status: 409,
    message: 'Skrining gizi (MST) kunjungan ini belum ada; skrining dulu sebelum verifikasi order diet',
  },
} as const satisfies Record<string, { status: number; message: string }>;

export type SupportErrorCode = keyof typeof SUPPORT_ERRORS;

/** Urutan tetap (bagian dari `ERROR_CODES`). */
export const SUPPORT_ERROR_CODES = Object.keys(SUPPORT_ERRORS) as [SupportErrorCode, ...SupportErrorCode[]];

/** Kode galat stabil. Klien boleh bergantung pada kode ini; pesan boleh berubah. */
export const ERROR_CODES = [
  'VALIDATION_FAILED',
  'UNAUTHENTICATED',
  'MFA_REQUIRED',
  'PASSWORD_CHANGE_REQUIRED',
  'PASSWORD_POLICY',
  'FORBIDDEN',
  'NOT_FOUND',
  'CONFLICT',
  'RATE_LIMITED',
  'PAYLOAD_TOO_LARGE',
  'UNSUPPORTED_MEDIA_TYPE',
  'DOCUMENT_INTEGRITY',
  'TENANT_REQUIRED',
  'TENANT_MISMATCH',
  'MODULE_DISABLED',
  'CDS_BLOCKED',
  'WEBHOOK_SIGNATURE_INVALID',
  'WEBHOOK_TIMESTAMP_EXPIRED',
  'INTEGRATION_UNAVAILABLE',
  // Basis data sibuk: transaksi tidak bisa dimulai dalam batas tunggu (HTTP 503, aman untuk diulang).
  'SERVICE_BUSY',
  'INTERNAL_ERROR',
  // Termasuk `BPJS_UNAVAILABLE` (lookup sinkron ADR-0025 gagal/lewat 5 detik, HTTP 503).
  ...FRONT_OFFICE_ERROR_CODES,
  ...CLINICAL_ERROR_CODES,
  ...SUPPORT_ERROR_CODES,
] as const;

export type ErrorCode = (typeof ERROR_CODES)[number];

export const errorBodySchema = z.object({
  code: z.enum(ERROR_CODES),
  message: z.string(),
  details: z.unknown().optional(),
  requestId: z.string().optional(),
});

export type ErrorBody = z.infer<typeof errorBodySchema>;

export class AppError extends Error {
  constructor(
    readonly code: ErrorCode,
    message: string,
    readonly status = 400,
    readonly details?: unknown,
  ) {
    super(message);
    this.name = 'AppError';
  }
}

/** Galat front office dengan status dan pesan bawaan (`message` opsional untuk pesan yang lebih spesifik). */
export function frontOfficeError(code: FrontOfficeErrorCode, details?: unknown, message?: string): AppError {
  const def = FRONT_OFFICE_ERRORS[code];
  return new AppError(code, message ?? def.message, def.status, details);
}

/** Galat klinis dengan status dan pesan bawaan. */
export function clinicalError(code: ClinicalErrorCode, details?: unknown, message?: string): AppError {
  const def = CLINICAL_ERRORS[code];
  return new AppError(code, message ?? def.message, def.status, details);
}

/** Galat penunjang (fase 4) dengan status dan pesan bawaan. */
export function supportError(code: SupportErrorCode, details?: unknown, message?: string): AppError {
  const def = SUPPORT_ERRORS[code];
  return new AppError(code, message ?? def.message, def.status, details);
}
