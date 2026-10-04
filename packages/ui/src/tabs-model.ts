/** Id tab dan panelnya untuk `idBase` yang sama (pasangan `aria-controls` ↔ `id` / `aria-labelledby`). */
export function tabIds(idBase: string, tabId: string): { tab: string; panel: string } {
  return { tab: `${idBase}-tab-${tabId}`, panel: `${idBase}-panel-${tabId}` };
}

/**
 * Indeks tab tujuan untuk tombol keyboard pola tab ARIA: panah kiri/kanan berputar di ujung, Home/End ke tab
 * pertama/terakhir. Null = bukan tombol navigasi tab (biarkan peramban menanganinya).
 */
export function tabKeyTarget(key: string, active: number, count: number): number | null {
  if (count === 0) return null;
  if (key === 'ArrowRight') return (active + 1) % count;
  if (key === 'ArrowLeft') return (active - 1 + count) % count;
  if (key === 'Home') return 0;
  if (key === 'End') return count - 1;
  return null;
}

/**
 * Indeks pilihan tujuan untuk tombol keyboard pola radio ARIA: panah kanan/bawah ke berikutnya, kiri/atas ke
 * sebelumnya, berputar di ujung. Null = bukan tombol navigasi radio.
 */
export function radioKeyTarget(key: string, active: number, count: number): number | null {
  if (count === 0) return null;
  if (key === 'ArrowRight' || key === 'ArrowDown') return (active + 1) % count;
  if (key === 'ArrowLeft' || key === 'ArrowUp') return (active - 1 + count) % count;
  return null;
}
