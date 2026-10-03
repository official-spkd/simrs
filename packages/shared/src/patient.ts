import { jakartaParts } from './datetime';

/**
 * P05 · Master Patient Index: kode, normalisasi, dan penyamaran identitas pasien.
 * Fungsi murni (tanpa crypto) sehingga dipakai API, web, dan seed. Enkripsi kolom ada di `@simrs/shared/node`.
 */

/** Jenis kelamin administratif (kode FHIR `gender`). */
export const PATIENT_SEXES = ['male', 'female', 'unknown'] as const;
export type PatientSex = (typeof PATIENT_SEXES)[number];
export const PATIENT_SEX_LABEL: Record<PatientSex, string> = {
  male: 'Laki-laki',
  female: 'Perempuan',
  unknown: 'Tidak diketahui',
};

export const PATIENT_STATUSES = ['active', 'merged'] as const;
export type PatientStatus = (typeof PATIENT_STATUSES)[number];

/**
 * Identifier eksternal pasien. Nilainya selalu dienkripsi (AES-256-GCM) + blind index HMAC untuk pencarian
 * sama-persis (docs/04 §1). Nomor RM bukan di sini: ia nomor internal RS (`patients.mrn`, layanan penomoran).
 */
export const IDENTIFIER_SYSTEMS = {
  nik: { label: 'NIK', pattern: /^\d{16}$/, hint: 'NIK harus 16 digit angka.' },
  bpjs: { label: 'No. peserta BPJS', pattern: /^\d{13}$/, hint: 'No. peserta BPJS harus 13 digit angka.' },
  ihs: { label: 'IHS SATUSEHAT', pattern: /^P\d{11}$/, hint: 'IHS number berbentuk P diikuti 11 digit.' },
  paspor: { label: 'Paspor', pattern: /^[A-Z0-9]{6,12}$/, hint: 'Nomor paspor 6–12 huruf/angka.' },
} as const;
export type IdentifierSystem = keyof typeof IDENTIFIER_SYSTEMS;
export const IDENTIFIER_SYSTEM_CODES = Object.keys(IDENTIFIER_SYSTEMS) as [
  IdentifierSystem,
  ...IdentifierSystem[],
];

/** Status verifikasi identifier ke sumber resmi (NIK → Dukcapil). */
export const IDENTIFIER_VERIFICATION = [
  'unverified',
  'pending',
  'verified',
  'mismatch',
  'not_found',
] as const;
export type IdentifierVerification = (typeof IDENTIFIER_VERIFICATION)[number];

/** Bentuk baku identifier sebelum validasi/hash: tanpa spasi, titik, strip; huruf kapital. */
export function normalizeIdentifier(raw: string): string {
  return raw.replace(/[\s.-]/g, '').toUpperCase();
}

export function isValidIdentifier(system: IdentifierSystem, normalized: string): boolean {
  return IDENTIFIER_SYSTEMS[system].pattern.test(normalized);
}

const BULLET = '•';

/** Samarkan: tampilkan `head` karakter awal dan `tail` akhir, sisanya `•` (jumlah tetap `fill`). */
function mask(value: string, head: number, tail: number, fill: number): string {
  if (value.length <= head + tail) return BULLET.repeat(Math.max(value.length, 4));
  return `${value.slice(0, head)}${BULLET.repeat(fill)}${value.slice(-tail)}`;
}

/**
 * Tampilan bawaan identitas (docs/05 §3): NIK `3174••••••••0012`, BPJS `0001234•••890`, IHS `P0213•••771`,
 * paspor `A1••••67`. Nilai utuh hanya lewat endpoint khusus yang diaudit.
 */
export function maskIdentifier(system: IdentifierSystem, value: string): string {
  switch (system) {
    case 'nik':
      return mask(value, 4, 4, 8);
    case 'bpjs':
      return mask(value, 7, 3, 3);
    case 'ihs':
      return mask(value, 5, 3, 3);
    case 'paspor':
      return mask(value, 2, 2, 4);
  }
}

/** No. HP tersamar `0812•••4567` (dari bentuk tersimpan `62…`). */
export function maskPhone(normalized: string): string {
  return mask(phoneForDisplay(normalized), 4, 4, 3);
}

/**
 * No. HP Indonesia ke bentuk baku `62…` (untuk hash pencocokan): `0812-3456-7890`, `+62 812…`, `62812…` → sama.
 * Mengembalikan null bila bukan nomor yang masuk akal (8–13 digit setelah kode negara).
 */
export function normalizePhone(raw: string): string | null {
  const digits = raw.replace(/[\s().-]/g, '');
  const m = /^(?:\+?62|0)(\d{8,13})$/.exec(digits);
  return m ? `62${m[1]}` : null;
}

/** `628123…` → `08123…` untuk tampilan. */
export function phoneForDisplay(normalized: string): string {
  return normalized.startsWith('62') ? `0${normalized.slice(2)}` : normalized;
}

/** Sapaan/gelar di depan nama yang tidak ikut dicocokkan (Tn., Ny., By., dr., H., …). */
const NAME_PREFIXES = new Set([
  'tn',
  'tuan',
  'ny',
  'nyonya',
  'nn',
  'nona',
  'sdr',
  'sdri',
  'an',
  'anak',
  'by',
  'bayi',
  'bpk',
  'bapak',
  'ibu',
  'dr',
  'drg',
  'h',
  'hj',
  'ir',
  'prof',
]);

/**
 * Nama untuk pencarian trigram dan deteksi duplikat: huruf kecil, tanpa diakritik dan tanda baca, tanpa
 * sapaan di depan (`By. Ny. Ratna` → `ratna`) dan tanpa gelar setelah koma (`Budi, S.E.` → `budi`).
 */
export function normalizePersonName(name: string): string {
  const base = (name.split(',')[0] ?? '')
    .normalize('NFKD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, ' ')
    .trim();
  const words = base.split(' ').filter(Boolean);
  while (words.length > 1 && NAME_PREFIXES.has(words[0] ?? '')) words.shift();
  return words.join(' ') || name.trim().toLowerCase();
}

/** Format nomor RM baku `00-41-27-88` dari 8 digit (dengan/tanpa strip); null bila bukan nomor RM. */
export function normalizeMrn(raw: string): string | null {
  const s = raw.trim();
  if (!/^\d{2}-?\d{2}-?\d{2}-?\d{2}$/.test(s)) return null;
  return s.replace(/-/g, '').replace(/(\d{2})(?=\d)/g, '$1-');
}

export type PatientQueryKind = 'mrn' | IdentifierSystem | 'name';

/**
 * Tafsir kotak pencarian pasien: RM (8 digit), NIK (16), BPJS (13), IHS (`P…`), selain itu nama.
 * Mengembalikan null bila berupa angka dengan panjang yang tidak dikenal (hindari pencarian nama berisi angka).
 */
export function parsePatientQuery(raw: string): { kind: PatientQueryKind; value: string } | null {
  const mrn = normalizeMrn(raw);
  if (mrn) return { kind: 'mrn', value: mrn };
  const compact = normalizeIdentifier(raw);
  if (/^\d+$/.test(compact)) {
    if (IDENTIFIER_SYSTEMS.nik.pattern.test(compact)) return { kind: 'nik', value: compact };
    if (IDENTIFIER_SYSTEMS.bpjs.pattern.test(compact)) return { kind: 'bpjs', value: compact };
    return null;
  }
  if (IDENTIFIER_SYSTEMS.ihs.pattern.test(compact)) return { kind: 'ihs', value: compact };
  const name = normalizePersonName(raw);
  return name.length >= 2 ? { kind: 'name', value: name } : null;
}

/** Umur ringkas untuk banner pasien: `54 th`, `7 bln`, `12 hr` (dihitung pada tanggal WIB). */
export function patientAge(birthDate: string, now: Date = new Date()): string {
  const [y, m, d] = birthDate.split('-').map(Number) as [number, number, number];
  const t = jakartaParts(now);
  let months = (t.year - y) * 12 + (t.month - m);
  if (t.day < d) months -= 1;
  if (months >= 12) return `${Math.floor(months / 12)} th`;
  if (months >= 1) return `${months} bln`;
  const days = Math.max(
    0,
    Math.round((Date.UTC(t.year, t.month - 1, t.day) - Date.UTC(y, m - 1, d)) / 86_400_000),
  );
  return `${days} hr`;
}
