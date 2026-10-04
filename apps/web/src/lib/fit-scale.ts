/**
 * Skala agar kanvas tetap (anjungan 1080×1920, TV 1920×1080, tablet 834×1194, ponsel 390×844) muat utuh di
 * jendela presentasi tanpa terpotong, dengan margin di sekelilingnya. Boleh memperbesar di layar besar.
 */
export function fitScale(
  viewportW: number,
  viewportH: number,
  canvasW: number,
  canvasH: number,
  margin = 16,
): number {
  if (canvasW <= 0 || canvasH <= 0) return 1;
  const w = Math.max(viewportW - 2 * margin, 1);
  const h = Math.max(viewportH - 2 * margin, 1);
  return Math.max(0.1, Math.min(w / canvasW, h / canvasH));
}
