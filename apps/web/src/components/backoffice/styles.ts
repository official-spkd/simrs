/**
 * Kelas Pelangi Klinis (ADR-0091) bersama layar manajemen, back office, dan sistem. Sengaja bukan modul klien agar
 * aman diimpor komponen server (string, bukan referensi klien). Aksen memakai `brand-*` sehingga mengikuti rona domain
 * (`data-domain`): bougenvil di manajemen, batu di sistem.
 */

/** Kartu tanpa warna garis: dipadukan dengan warna garis nada (mis. `border-danger-border`). */
export const CARD_BASE = 'rounded-card border bg-white/90 shadow-card';

/** Kartu isi: putih 90% di atas kaca, garis putih, bayangan lembut, radius 16. */
export const CARD = `${CARD_BASE} border-white/95`;

/** Judul halaman 22 px tebal, tracking rapat. */
export const H1 = 'm-0 text-h1 font-bold tracking-[-0.02em]';

/** Judul kartu 15 px. */
export const H2 = 'm-0 text-[15px] font-semibold';

/** Kotak lembut di dalam kartu (butir keputusan, modul, ringkasan): gradien satu rona domain 50 → putih. */
export const SOFT =
  'rounded-[12px] bg-[linear-gradient(135deg,var(--color-brand-50),rgba(255,255,255,0.75))]';

/** Kepala kolom tabel: 12 px ink-500, garis tipis. */
export const TH_BASE =
  'border-b border-[rgba(23,32,46,0.08)] text-left text-caption font-semibold text-ink-500';

/** Sorotan baris saat kursor di atasnya (dipasang di pembungkus tabel; berlaku ke semua `tbody tr`). */
export const TABLE_HOVER = '[&_tbody_tr]:transition-colors [&_tbody_tr:hover>td]:bg-brand-50/60';

/** Baris tabel tunggal yang bisa disorot. */
export const ROW_HOVER = 'transition-colors hover:bg-brand-50/60';

/** Baris/butir terpilih: gradien rona domain 100 → putih transparan. */
export const ROW_SELECTED = 'bg-[linear-gradient(90deg,var(--color-brand-100),rgba(255,255,255,0.4))]';

/** Bilah kemajuan: rel abu tipis + isi gradien satu rona domain (800 → 600). */
export const PROGRESS_TRACK = 'h-2 overflow-hidden rounded-full bg-[rgba(23,32,46,0.08)]';
export const PROGRESS_FILL = 'block h-full rounded-full bg-btn-primary animate-grow origin-left';
export const PROGRESS_FILL_DANGER =
  'block h-full rounded-full bg-[linear-gradient(90deg,var(--color-koral-700),var(--color-koral-600))] animate-grow origin-left';

/**
 * Gradien KPI satu rona (100 → 50), bergiliran per kartu seperti papan C14. Kunyit dan koral tidak dipakai karena
 * khusus status. Ditulis lengkap agar terbaca pemindai Tailwind.
 */
export const KPI_TINTS = [
  'bg-[linear-gradient(135deg,var(--color-samudra-100),var(--color-samudra-50))]',
  'bg-[linear-gradient(135deg,var(--color-zamrud-100),var(--color-zamrud-50))]',
  'bg-[linear-gradient(135deg,var(--color-anggrek-100),var(--color-anggrek-50))]',
  'bg-[linear-gradient(135deg,var(--color-toska-100),var(--color-toska-50))]',
  'bg-[linear-gradient(135deg,var(--color-bougenvil-100),var(--color-bougenvil-50))]',
  'bg-[linear-gradient(135deg,var(--color-batu-200),var(--color-batu-50))]',
] as const;

/** Gradien KPI rona domain aktif (100 → 50). */
export const KPI_TINT_BRAND = 'bg-[linear-gradient(135deg,var(--color-brand-100),var(--color-brand-50))]';

/** Bingkai kartu KPI (tanpa latar): dipadukan dengan salah satu `KPI_TINTS`. */
export const KPI_FRAME =
  'shine-once flex flex-col gap-0.5 rounded-card border border-white/90 px-4 py-3.5 shadow-[0_8px_22px_rgba(23,32,46,0.07)]';

/** Warna kategori grafik (urutan tetap, papan F5): maksimal 6 kategori. */
export const CATEGORY_FILLS = [
  'bg-samudra-500',
  'bg-zamrud-500',
  'bg-anggrek-500',
  'bg-kunyit-400',
  'bg-bougenvil-500',
  'bg-toska-500',
] as const;

export function kpiTint(i: number): string {
  return KPI_TINTS[i % KPI_TINTS.length] ?? KPI_TINT_BRAND;
}
