/**
 * Kode internal stabil untuk jawaban BPJS (VClaim, Antrean RS, Aplicare). Aman untuk browser: dipakai web untuk
 * label status (mis. SEP ditolak), API untuk lookup sinkron (ADR-0025), dan worker untuk outbox.
 *
 * BPJS menjawab galat bisnis dengan HTTP 200 + `metaData.code` ≠ 200 dan pesan bebas; kodenya hampir selalu `201`,
 * jadi jenis galat dibedakan dari pesannya. Pola di bawah merangkum pesan yang umum; cocokkan dengan katalog resmi
 * BPJS sebelum integrasi nyata (docs/06-integrasi.md) dan tambahkan pola, bukan kode baru, bila pesannya berbeda.
 */

/** Penolakan bisnis: jawaban pasti dari BPJS. Dicatat sebagai hasil domain ("ditolak"), bukan dicoba ulang. */
export const BPJS_REJECTION_CODES = [
  'BPJS_PESERTA_TIDAK_AKTIF',
  'BPJS_PESERTA_TIDAK_DITEMUKAN',
  'BPJS_SEP_GANDA',
  'BPJS_RUJUKAN_KEDALUWARSA',
  'BPJS_TASK_URUTAN',
  'BPJS_DUPLIKAT',
  'BPJS_TIDAK_DITEMUKAN',
  'BPJS_VALIDATION',
] as const;
export type BpjsRejectionCode = (typeof BPJS_REJECTION_CODES)[number];

/**
 * Gangguan (bukan jawaban bisnis): `BPJS_UNAVAILABLE` (jaringan, timeout, 5xx, pemeliharaan) layak dicoba ulang;
 * `BPJS_AUTH` (tanda tangan/kredensial) dan `BPJS_PROTOCOL` (respons tidak bisa dibaca) tidak.
 */
export const BPJS_FAILURE_CODES = ['BPJS_UNAVAILABLE', 'BPJS_AUTH', 'BPJS_PROTOCOL'] as const;
export type BpjsFailureCode = (typeof BPJS_FAILURE_CODES)[number];

export const BPJS_ERROR_CODES = [...BPJS_REJECTION_CODES, ...BPJS_FAILURE_CODES] as const;
export type BpjsErrorCode = BpjsRejectionCode | BpjsFailureCode;

/** Label untuk layar (Bahasa Indonesia). */
export const BPJS_ERROR_LABEL: Record<BpjsErrorCode, string> = {
  BPJS_PESERTA_TIDAK_AKTIF: 'Peserta tidak aktif',
  BPJS_PESERTA_TIDAK_DITEMUKAN: 'Peserta tidak ditemukan',
  BPJS_SEP_GANDA: 'SEP sudah terbit',
  BPJS_RUJUKAN_KEDALUWARSA: 'Rujukan kedaluwarsa',
  BPJS_TASK_URUTAN: 'Urutan task antrean tidak sesuai',
  BPJS_DUPLIKAT: 'Data sudah ada di BPJS',
  BPJS_TIDAK_DITEMUKAN: 'Data tidak ditemukan di BPJS',
  BPJS_VALIDATION: 'Ditolak BPJS (validasi)',
  BPJS_UNAVAILABLE: 'Layanan BPJS tidak tersedia',
  BPJS_AUTH: 'Kredensial BPJS ditolak',
  BPJS_PROTOCOL: 'Respons BPJS tidak dikenali',
};

export type BpjsMetaDataClass =
  | { kind: 'ok' }
  | { kind: 'rejected'; code: BpjsRejectionCode }
  | { kind: 'failure'; code: BpjsFailureCode; retryable: boolean };

/** Urutan penting: pola yang lebih spesifik di atas pola umum. */
const REJECTION_PATTERNS: ReadonlyArray<readonly [RegExp, BpjsRejectionCode]> = [
  [
    /\bsep\b.*(sudah|telah)\s+(terbit|ada|dibuat)|sudah\s+terbit\s+sep|sep\s+ganda|duplikasi\s+sep|(sudah|telah)\s+mendapat(kan)?\s+pelayanan/i,
    'BPJS_SEP_GANDA',
  ],
  [
    /rujukan.*(ked?aluw?arsa|kad?aluw?arsa|expired|melewati\s+batas|lebih\s+dari\s+90|habis)/i,
    'BPJS_RUJUKAN_KEDALUWARSA',
  ],
  [/tidak\s+aktif|non-?\s?aktif/i, 'BPJS_PESERTA_TIDAK_AKTIF'],
  [
    /peserta.*tidak\s+(ditemukan|terdaftar)|(nik|no\.?\s*kartu|nomor\s+kartu).*tidak\s+(ditemukan|terdaftar)/i,
    'BPJS_PESERTA_TIDAK_DITEMUKAN',
  ],
  [
    /task\s*(id)?.*(sebelum|urutan)|urutan\s+task|waktu.*(kurang|lebih\s+kecil)\s+dari.*sebelum/i,
    'BPJS_TASK_URUTAN',
  ],
  [/sudah\s+(ada|terdaftar|pernah)|duplika(t|si)/i, 'BPJS_DUPLIKAT'],
  [/tidak\s+ditemukan|tidak\s+ada\s+data|data\s+tidak\s+ada/i, 'BPJS_TIDAK_DITEMUKAN'],
];

const UNAVAILABLE_PATTERN =
  /maintenance|pemeliharaan|gangguan|time\s?out|coba\s+(lagi|kembali|beberapa\s+saat)/i;
const AUTH_PATTERN = /unauthori[sz]ed|signature\s+tidak\s+valid|invalid\s+signature|cons-?id|user[_\s-]?key/i;

/**
 * Klasifikasikan `metaData` BPJS. Sukses = kode 200 (VClaim string, Antrean angka) atau 1 (Aplicare).
 * Kode 401/403 = kredensial; 5xx atau pesan pemeliharaan = gangguan sementara; selain itu penolakan bisnis.
 */
export function classifyBpjsMetaData(code: string | number, message: string): BpjsMetaDataClass {
  const c = String(code).trim();
  if (c === '200' || c === '1') return { kind: 'ok' };
  const n = Number(c);
  if (n === 401 || n === 403 || AUTH_PATTERN.test(message)) {
    return { kind: 'failure', code: 'BPJS_AUTH', retryable: false };
  }
  if ((n >= 500 && n < 600) || UNAVAILABLE_PATTERN.test(message)) {
    return { kind: 'failure', code: 'BPJS_UNAVAILABLE', retryable: true };
  }
  for (const [pattern, rejection] of REJECTION_PATTERNS) {
    if (pattern.test(message)) return { kind: 'rejected', code: rejection };
  }
  return { kind: 'rejected', code: 'BPJS_VALIDATION' };
}
