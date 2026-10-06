/**
 * Kelas gaya Pelangi Klinis (ADR-0091) yang dipakai bersama layar penunjang dan integrasi.
 * Aksen memakai `brand-*` (rona domain otomatis dari `data-domain`); status memakai pasangan 100/800 yang tidak ikut
 * domain (koral kritis, kunyit peringatan, zamrud sukses, samudra info, batu netral).
 */

/** Kartu putih kaca: radius 16, border putih, bayangan lembut. */
export const CARD = 'rounded-card border border-white/95 bg-white/90 shadow-card';

/** Baris worklist terpilih: gradien satu rona domain 100 → putih. */
export const ROW_SELECTED = 'bg-[linear-gradient(90deg,var(--color-brand-100),rgba(255,255,255,0.4))]';

/** Hover baris worklist/tabel. */
export const ROW_HOVER = 'hover:bg-brand-50/60';

/** Kotak lembut di dalam kartu (mockup `.soft`): gradien satu rona domain 50 → batu 50. */
export const SOFT = 'rounded-[12px] bg-[linear-gradient(135deg,var(--color-brand-50),var(--color-batu-50))]';

/** Kepala tabel (mockup `.tbl th`). */
export const TABLE_HEAD =
  'border-b border-[rgba(23,32,46,0.08)] text-left text-caption font-semibold text-ink-500';

/** Chip status 100/800 per nada. */
export const STATUS_CHIP = {
  danger: 'bg-koral-100 text-koral-800',
  warning: 'bg-kunyit-100 text-kunyit-800',
  success: 'bg-zamrud-100 text-zamrud-700',
  info: 'bg-samudra-100 text-samudra-700',
  brand: 'bg-brand-100 text-brand-800',
  neutral: 'bg-batu-200 text-batu-800',
} as const;

/** Titik berdenyut untuk status kritis saja (denyut tidak dipakai untuk status lain). */
export const CRIT_DOT = 'inline-block size-[7px] flex-none rounded-full bg-koral-600 animate-crit';

/** Langkah alur (mockup `.steps`): selesai, aktif, belum. */
export const STEP = {
  done: 'bg-zamrud-100 font-semibold text-zamrud-700',
  active: 'bg-nav-active font-semibold text-white shadow-[0_6px_16px_rgba(23,32,46,0.18)]',
  todo: 'bg-[rgba(23,32,46,0.05)] text-ink-700',
} as const;
