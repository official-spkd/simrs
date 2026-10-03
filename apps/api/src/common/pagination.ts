/** Halaman hasil berpaginasi kursor. `nextCursor` null = halaman terakhir. */
export interface Page<T> {
  items: T[];
  nextCursor: string | null;
}

/**
 * Bangun halaman dari `limit + 1` baris yang diambil repository (baris ekstra hanya penanda ada halaman berikutnya).
 * Kursor = id baris terakhir (UUID v7 urut waktu).
 */
export function toPage<T extends { id: string }>(rows: T[], limit: number): Page<T> {
  const items = rows.slice(0, limit);
  return { items, nextCursor: rows.length > limit ? (items.at(-1)?.id ?? null) : null };
}
