/** Panjang goresan minimal (piksel kanvas) agar dianggap tanda tangan, bukan sentuhan tak sengaja. */
export const MIN_STROKE = 60;

export interface Point {
  x: number;
  y: number;
}

/**
 * Pelacak goresan bantalan tanda tangan (murni, tanpa DOM): satu pointer menggores pada satu waktu (jari kedua,
 * telapak tangan diabaikan); goresan berakhir lewat `pointerup`, `pointercancel`, atau capture hilang. Panjang
 * dijumlah lintas goresan sampai dihapus.
 */
export class StrokeTracker {
  private pointer: number | null = null;
  private last: Point | null = null;
  length = 0;

  get active(): boolean {
    return this.pointer !== null;
  }

  /** Mulai goresan; false bila pointer lain sedang menggores. */
  down(pointerId: number, p: Point): boolean {
    if (this.pointer !== null) return false;
    this.pointer = pointerId;
    this.last = p;
    return true;
  }

  /** Segmen yang harus digambar, atau null bila pointer ini tidak sedang menggores. */
  move(pointerId: number, p: Point): { from: Point; to: Point } | null {
    if (this.pointer !== pointerId || !this.last) return null;
    const from = this.last;
    this.length += Math.hypot(p.x - from.x, p.y - from.y);
    this.last = p;
    return { from, to: p };
  }

  /**
   * Akhiri goresan pointer ini (up/cancel/capture hilang). Kembali true bila goresan pointer ini memang berakhir
   * di sini dan panjang total sudah cukup untuk menjadi tanda tangan.
   */
  end(pointerId: number): boolean {
    if (this.pointer !== pointerId) return false;
    this.pointer = null;
    this.last = null;
    return this.length >= MIN_STROKE;
  }

  reset(): void {
    this.pointer = null;
    this.last = null;
    this.length = 0;
  }
}
