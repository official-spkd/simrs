/** Id tab dan panelnya untuk `idBase` yang sama (hubungan `aria-controls` ↔ `aria-labelledby`). */
export function pillTabIds(idBase: string, tabId: string): { tab: string; panel: string } {
  return { tab: `${idBase}-tab-${tabId}`, panel: `${idBase}-panel-${tabId}` };
}

/** Indeks tab tujuan untuk tombol panah/Home/End (berputar di ujung); null = bukan tombol navigasi tab. */
export function pillTabTarget(key: string, active: number, count: number): number | null {
  if (count === 0) return null;
  if (key === 'ArrowRight') return (active + 1) % count;
  if (key === 'ArrowLeft') return (active - 1 + count) % count;
  if (key === 'Home') return 0;
  if (key === 'End') return count - 1;
  return null;
}
