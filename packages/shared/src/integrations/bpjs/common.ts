import { z } from 'zod';

/**
 * I03 · Kontrak kabel BPJS Kesehatan (VClaim 2.0, Antrean RS, HFIS) yang dipakai bersama mock (`apps/mock`),
 * konektor worker, dan API. Rangkuman docs/06 §2 + perilaku mock; cocokkan dengan katalog resmi BPJS sebelum
 * integrasi nyata dan perbarui berkas ini bila berbeda.
 *
 * Bentuk umum:
 * - Header bertanda tangan per permintaan (`bpjsHeaders` di `@simrs/shared/node`).
 * - VClaim membungkus jawaban dalam `{ metaData: { code: "200", message }, response }` (kode string),
 *   Antrean dalam `{ metadata: { code: 200, message }, response? }` (kode angka).
 * - `response` berisi data terenkripsi (string Base64, AES-256-CBC + LZ-string) bila ada data; galat bisnis
 *   dikembalikan di HTTP 200 dengan kode ≠ 200 dan `response` null/tidak ada.
 * - Dekode + validasi: `decodeVclaimResponse` / `decodeAntreanResponse` di `@simrs/shared/node`.
 */

/**
 * Prefiks path tiap layanan relatif terhadap `BPJS_BASE_URL` (lokal `http://localhost:4100/bpjs`). Di produksi nama
 * layanannya berbeda (`vclaim-rest`, `antreanrs`, `aplicaresws`): konektor membaca prefiks dari konfigurasi,
 * nilai di sini adalah bawaan mock.
 */
export const BPJS_SERVICE_PREFIX = {
  vclaim: '/vclaim',
  antrean: '/antrean',
  aplicare: '/aplicare',
} as const;
export type BpjsService = keyof typeof BPJS_SERVICE_PREFIX;

export interface BpjsEndpoint {
  method: 'GET' | 'POST' | 'PUT' | 'DELETE';
  /** Path relatif terhadap prefiks layanan, parameter berbentuk `:nama` (lihat `bpjsPath`). */
  path: string;
}

/**
 * Isi parameter `:nama` di templat path. Nilai di-encode (`encodeURIComponent`) sehingga isi permintaan tidak bisa
 * keluar dari segmen path; parameter kosong/tidak ada → galat (bug pemanggil, bukan galat BPJS).
 */
export function bpjsPath(template: string, params: Record<string, string | number> = {}): string {
  return template.replace(/:([A-Za-z]+)/g, (_m, name: string) => {
    const value = params[name];
    if (value === undefined || value === '') throw new Error(`Parameter path BPJS "${name}" kosong`);
    return encodeURIComponent(String(value));
  });
}

// ---------------------------------------------------------------------------------------------------------------
// Amplop respons
// ---------------------------------------------------------------------------------------------------------------

/** Kode sukses VClaim (`metaData.code`, string). */
export const VCLAIM_OK = '200';
/** Kode sukses Antrean RS/HFIS (`metadata.code`, angka). */
export const ANTREAN_OK = 200;
/** Kode galat bisnis umum yang dipakai mock (VClaim `"201"`, Antrean `201`). */
export const BPJS_BUSINESS_ERROR_CODE = 201;

export const vclaimMetaDataSchema = z.object({ code: z.string(), message: z.string() });
export type VclaimMetaData = z.infer<typeof vclaimMetaDataSchema>;

/** `response`: string terenkripsi, objek polos (enkripsi mock dimatikan), atau null saat galat. */
export const vclaimEnvelopeSchema = z.object({
  metaData: vclaimMetaDataSchema,
  response: z.unknown().optional(),
});
export type VclaimEnvelope = z.infer<typeof vclaimEnvelopeSchema>;

export const antreanMetadataSchema = z.object({ code: z.number().int(), message: z.string() });
export type AntreanMetadata = z.infer<typeof antreanMetadataSchema>;

export const antreanEnvelopeSchema = z.object({
  metadata: antreanMetadataSchema,
  response: z.unknown().optional(),
});
export type AntreanEnvelope = z.infer<typeof antreanEnvelopeSchema>;

// ---------------------------------------------------------------------------------------------------------------
// Penolakan bisnis (HTTP 200 + kode ≠ 200)
// ---------------------------------------------------------------------------------------------------------------

/**
 * Kode internal stabil untuk penolakan BPJS (docs/06 §1) beserta awal pesan yang dikirim mock. BPJS hanya memberi
 * kode `201` + pesan teks, sehingga konektor memetakan pesan → kode lewat `classifyBpjsRejection`. Pesan resmi BPJS
 * bisa berbeda: perbarui teks di sini saat integrasi nyata, bukan di konektor.
 *
 * Catatan untuk operasi yang diulang (outbox) setelah timeout:
 * - `BPJS_ANTREAN_GANDA` (add), `BPJS_TASK_GANDA` (updatewaktu), `BPJS_ANTREAN_SUDAH_BATAL` (batal) berarti
 *   permintaan yang sama sudah tercatat sebelumnya.
 * - `BPJS_SEP_GANDA` berarti SEP untuk kunjungan itu sudah terbit: cari nomornya lewat histori pelayanan
 *   (`VCLAIM_ENDPOINTS.historiPelayanan`), jangan menerbitkan ulang.
 * - `BPJS_TASK_TIDAK_BERURUTAN` berarti task sebelumnya belum tercatat: tunda, bukan gagal permanen.
 */
export const BPJS_REJECTIONS = {
  BPJS_VALIDASI: 'Data permintaan tidak valid',
  BPJS_PESERTA_TIDAK_DITEMUKAN: 'Peserta tidak ditemukan',
  BPJS_PESERTA_TIDAK_AKTIF: 'Status peserta tidak aktif',
  BPJS_RUJUKAN_TIDAK_DITEMUKAN: 'Rujukan tidak ditemukan',
  BPJS_RUJUKAN_KEDALUWARSA: 'Rujukan sudah kedaluwarsa',
  BPJS_RUJUKAN_BUKAN_PESERTA: 'Rujukan bukan milik peserta',
  BPJS_SEP_GANDA: 'Peserta sudah memiliki SEP',
  BPJS_SEP_TIDAK_DITEMUKAN: 'SEP tidak ditemukan',
  BPJS_FINGERPRINT_BELUM: 'Peserta belum melakukan validasi sidik jari',
  BPJS_SURAT_TIDAK_DITEMUKAN: 'Surat kontrol/SPRI tidak ditemukan',
  BPJS_TANGGAL_TIDAK_VALID: 'Tanggal tidak valid',
  BPJS_POLI_TIDAK_DITEMUKAN: 'Poli tidak ditemukan',
  BPJS_DOKTER_TIDAK_DITEMUKAN: 'Dokter tidak ditemukan',
  BPJS_JADWAL_TIDAK_DITEMUKAN: 'Jadwal dokter tidak ditemukan',
  BPJS_JADWAL_LIBUR: 'Dokter libur pada tanggal tersebut',
  BPJS_KUOTA_PENUH: 'Kuota jadwal dokter sudah penuh',
  BPJS_ANTREAN_TIDAK_DITEMUKAN: 'Antrean tidak ditemukan',
  BPJS_ANTREAN_GANDA: 'Kode booking sudah terdaftar',
  BPJS_ANTREAN_SUDAH_BATAL: 'Antrean sudah dibatalkan',
  BPJS_ANTREAN_SUDAH_DILAYANI: 'Pasien sudah dilayani',
  BPJS_TASK_GANDA: 'TaskId sudah ada',
  BPJS_TASK_TIDAK_BERURUTAN: 'TaskId tidak berurutan',
  BPJS_TASK_WAKTU_MUNDUR: 'Waktu TaskId lebih kecil dari TaskId sebelumnya',
  BPJS_DATA_TIDAK_DITEMUKAN: 'Data tidak ditemukan',
} as const;
export type BpjsRejectionKnownCode = keyof typeof BPJS_REJECTIONS;
/** `BPJS_TIDAK_DIKENAL`: pesan yang belum dipetakan (perlakukan sebagai penolakan bisnis umum). */
export type BpjsRejectionCode = BpjsRejectionKnownCode | 'BPJS_TIDAK_DIKENAL';

/** Pesan galat seperti yang dikirim mock: `<awal baku>` atau `<awal baku>: <rincian>`. */
export function bpjsRejectionMessage(code: BpjsRejectionKnownCode, detail?: string): string {
  return detail ? `${BPJS_REJECTIONS[code]}: ${detail}` : BPJS_REJECTIONS[code];
}

const REJECTION_PREFIXES = (Object.entries(BPJS_REJECTIONS) as Array<[BpjsRejectionKnownCode, string]>)
  .map(([code, text]) => [code, text.toLowerCase()] as const)
  .sort((a, b) => b[1].length - a[1].length);

/**
 * Pola cadangan untuk pesan dengan susunan kata lain (variasi yang lazim di VClaim/Antrean asli), dipakai bila tidak
 * ada awal baku yang cocok. Urutan penting: yang spesifik di atas yang umum.
 */
const REJECTION_PATTERNS: ReadonlyArray<readonly [RegExp, BpjsRejectionKnownCode]> = [
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
  [/(kurang|lebih\s+kecil|mundur)\s+dari.*sebelum/i, 'BPJS_TASK_WAKTU_MUNDUR'],
  [/task\s*(id)?.*(sebelum|urutan)|urutan\s+task/i, 'BPJS_TASK_TIDAK_BERURUTAN'],
  [/task\s*(id)?\s*=?\s*\d*\s+sudah\s+ada/i, 'BPJS_TASK_GANDA'],
  [/(kode\s*booking.*(sudah|duplika))|duplikasi\s+kode\s*booking/i, 'BPJS_ANTREAN_GANDA'],
  [/tidak\s+ditemukan|tidak\s+ada\s+data|data\s+tidak\s+ada/i, 'BPJS_DATA_TIDAK_DITEMUKAN'],
];

/**
 * Pesan penolakan BPJS → kode internal stabil: awal pesan baku terpanjang yang cocok (tanpa beda huruf besar), lalu
 * pola cadangan, selain itu `BPJS_TIDAK_DIKENAL`.
 */
export function classifyBpjsRejection(message: string): BpjsRejectionCode {
  const m = message.trim().toLowerCase();
  const byPrefix = REJECTION_PREFIXES.find(([, prefix]) => m.startsWith(prefix))?.[0];
  if (byPrefix) return byPrefix;
  return REJECTION_PATTERNS.find(([pattern]) => pattern.test(m))?.[1] ?? 'BPJS_TIDAK_DIKENAL';
}

// ---------------------------------------------------------------------------------------------------------------
// Gangguan (bukan jawaban bisnis)
// ---------------------------------------------------------------------------------------------------------------

/**
 * Kegagalan yang bukan jawaban bisnis: `BPJS_UNAVAILABLE` (jaringan, timeout, 5xx, pemeliharaan) layak dicoba ulang;
 * `BPJS_AUTH` (tanda tangan/kredensial) dan `BPJS_PROTOCOL` (respons tidak bisa dibaca/tidak sesuai kontrak) tidak.
 * Dipakai `BpjsClient` (`@simrs/shared/node`) untuk worker dan lookup sinkron API.
 */
export const BPJS_FAILURES = {
  BPJS_UNAVAILABLE: 'Layanan BPJS tidak tersedia',
  BPJS_AUTH: 'Kredensial BPJS ditolak',
  BPJS_PROTOCOL: 'Respons BPJS tidak dikenali',
} as const;
export type BpjsFailureCode = keyof typeof BPJS_FAILURES;
export type BpjsErrorCode = BpjsRejectionCode | BpjsFailureCode;

/** Label layar untuk kode BPJS mana pun (penolakan atau gangguan). */
export function bpjsErrorLabel(code: BpjsErrorCode): string {
  if (code === 'BPJS_TIDAK_DIKENAL') return 'Ditolak BPJS';
  return code in BPJS_FAILURES
    ? BPJS_FAILURES[code as BpjsFailureCode]
    : BPJS_REJECTIONS[code as BpjsRejectionKnownCode];
}

const UNAVAILABLE_PATTERN =
  /maintenance|pemeliharaan|gangguan|time\s?out|coba\s+(lagi|kembali|beberapa\s+saat)/i;
const AUTH_PATTERN =
  /unauthori[sz]ed|signature\s+tidak\s+valid|invalid\s+signature|x-timestamp\s+kedaluwarsa|user[_\s-]?key\s+tidak\s+valid/i;

/**
 * Amplop dengan kode ≠ sukses yang sebenarnya gangguan, bukan penolakan bisnis: kode 401/403 atau pesan kredensial →
 * `BPJS_AUTH`; kode 5xx atau pesan pemeliharaan → `BPJS_UNAVAILABLE` (dicoba ulang). `undefined` = penolakan bisnis
 * (klasifikasikan dengan `classifyBpjsRejection`).
 */
export function classifyBpjsFailure(
  code: string | number,
  message: string,
): { code: BpjsFailureCode; retryable: boolean } | undefined {
  const n = Number(code);
  if (n === 401 || n === 403 || AUTH_PATTERN.test(message)) return { code: 'BPJS_AUTH', retryable: false };
  if ((n >= 500 && n < 600) || UNAVAILABLE_PATTERN.test(message)) {
    return { code: 'BPJS_UNAVAILABLE', retryable: true };
  }
  return undefined;
}

// ---------------------------------------------------------------------------------------------------------------
// Bentuk data umum
// ---------------------------------------------------------------------------------------------------------------

/** Tanggal BPJS `YYYY-MM-DD` (kalender WIB). */
export const bpjsDateSchema = z.iso.date();
/** No. kartu JKN 13 digit (data fiktif lokal berawalan `0000`). */
export const bpjsNoKartuSchema = z.string().regex(/^\d{13}$/, 'No. kartu harus 13 digit');
export const bpjsNikSchema = z.string().regex(/^\d{16}$/, 'NIK harus 16 digit');
/** Kode ICD-10 seperti yang dipakai VClaim, mis. `I10` atau `E11.9`. */
export const bpjsIcd10Schema = z.string().regex(/^[A-Z]\d{2}(\.\d{1,2})?$/, 'Kode ICD-10 tidak valid');
/** Kode PPK/faskes 8 karakter, mis. `0301R001` (RS) atau `9999P001` (FKTP fiktif). */
export const bpjsKodePpkSchema = z.string().regex(/^[0-9A-Z]{8}$/, 'Kode PPK harus 8 karakter');
/** Jam `HH:mm` (format BPJS, bukan format tampilan `HH.MM`). */
export const bpjsJamSchema = z.string().regex(/^([01]\d|2[0-3]):[0-5]\d$/, 'Jam harus HH:mm');

export const bpjsKodeNamaSchema = z.object({ kode: z.string(), nama: z.string() });
export const bpjsKodeKeteranganSchema = z.object({ kode: z.string(), keterangan: z.string() });

/** Tambah `days` hari ke tanggal `YYYY-MM-DD` (aritmetika kalender, tanpa zona). */
export function bpjsAddDays(isoDate: string, days: number): string {
  const [y, m, d] = isoDate.split('-').map(Number) as [number, number, number];
  return new Date(Date.UTC(y, m - 1, d + days)).toISOString().slice(0, 10);
}

/** Selisih hari kalender `to − from` untuk dua tanggal `YYYY-MM-DD`. */
export function bpjsDiffDays(from: string, to: string): number {
  const ms = (iso: string) => {
    const [y, m, d] = iso.split('-').map(Number) as [number, number, number];
    return Date.UTC(y, m - 1, d);
  };
  return Math.round((ms(to) - ms(from)) / 86_400_000);
}
