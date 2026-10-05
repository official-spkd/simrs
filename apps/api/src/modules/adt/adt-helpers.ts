import { randomInt } from 'node:crypto';
import { AppError, clinicalError } from '@simrs/shared';

const HONORIFIC = /^(tn|ny|nn|an|by|sdr|sdri|bpk|ibu)\.?\s+/i;

/** Inisial pasien untuk papan bed ("Ny. Endang Wijaya" → "E. W."); tanpa nama lengkap. */
export function patientInitials(name: string): string {
  const words = name.replace(HONORIFIC, '').trim().split(/\s+/).filter(Boolean);
  if (words.length === 0) return '–';
  return words
    .slice(0, 3)
    .map((w) => `${w.charAt(0).toUpperCase()}.`)
    .join(' ');
}

const CODE_ALPHABET = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';

/** Kode gelang acak (bukan No. RM, keputusan fase 3 no. 8): `GL` + 10 karakter tanpa huruf/angka mirip. */
export function newWristbandCode(): string {
  let s = 'GL';
  for (let i = 0; i < 10; i++) s += CODE_ALPHABET.charAt(randomInt(CODE_ALPHABET.length));
  return s;
}

/** Kode kelas → akhiran kode ruang Aplicare (`MELATI-K2`). */
const CLASS_SUFFIX: Readonly<Record<string, string>> = {
  vvip: 'VVIP',
  vip: 'VIP',
  kelas_1: 'K1',
  kelas_2: 'K2',
  kelas_3: 'K3',
  icu: 'ICU',
  hcu: 'HCU',
  nicu: 'NICU',
  picu: 'PICU',
  isolasi: 'ISO',
};

export const CARE_CLASS_LABEL: Readonly<Record<string, string>> = {
  vvip: 'VVIP',
  vip: 'VIP',
  kelas_1: 'Kelas 1',
  kelas_2: 'Kelas 2',
  kelas_3: 'Kelas 3',
  icu: 'ICU',
  hcu: 'HCU',
  nicu: 'NICU',
  picu: 'PICU',
  isolasi: 'Isolasi',
};

export function aplicareRoomCode(unitCode: string, careClass: string): string | null {
  const suffix = CLASS_SUFFIX[careClass];
  if (!suffix) return null;
  const base = unitCode
    .toUpperCase()
    .replace(/[^A-Z0-9-]/g, '')
    .slice(0, 20 - suffix.length - 1);
  return `${base}-${suffix}`;
}

/** Galat database hunian ganda (EXCLUDE btree_gist, SQLSTATE 23P01) → 409 `BED_NOT_AVAILABLE`. */
export function bedConflict(err: unknown): AppError | null {
  if (!(err instanceof Error)) return null;
  const cause = (err as { meta?: { driverAdapterError?: { cause?: { originalCode?: unknown } } } }).meta
    ?.driverAdapterError?.cause;
  const code = cause?.originalCode ?? (err as { code?: unknown }).code ?? null;
  if (code === '23P01' || /bed_assignments_(no_double_occupancy|one_bed_per_encounter)/.test(err.message)) {
    return clinicalError('BED_NOT_AVAILABLE');
  }
  return null;
}

/** Menit penuh sejak `from` sampai `now` (tidak negatif). */
export const minutesSince = (from: Date, now: Date): number =>
  Math.max(0, Math.floor((now.getTime() - from.getTime()) / 60_000));
