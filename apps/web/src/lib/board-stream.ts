import type { EventSourceLike } from './queue-sse';

/**
 * W3 · Klien SSE papan IGD dan papan bed (ADR-0104), lewat BFF staf. Event papan hanya SINYAL (id + kode status, tanpa
 * nama pasien): setiap event berarti "papan berubah", dan layar memuat ulang data papannya dari server. Potret awal
 * (`ed.board` / `bed.board`) dikirim setiap kali aliran (sambung ulang) dibuka; potret pertama sesudah halaman tampil
 * diabaikan (data halaman sudah sama), potret berikutnya = tersambung ulang → muat ulang agar perubahan yang terlewat
 * ikut tampil. `reset` juga memicu muat ulang. Aliran yang tertutup permanen dicoba lagi dengan jeda naik.
 * Modul murni terhadap `EventSource` yang disuntikkan (diuji tanpa browser).
 */

export type BoardStreamStatus = 'menyambung' | 'tersambung' | 'terputus';

export interface BoardStreamOptions {
  url: string;
  /** Nama event potret awal (mis. `ed.board`). */
  snapshotEvent: string;
  /** Nama event perubahan (mis. `ed.status`, `ed.changed`). */
  changeEvents: readonly string[];
  /** Papan berubah: muat ulang data papan. */
  onChange: () => void;
  onStatus?: (s: BoardStreamStatus) => void;
  create?: (url: string) => EventSourceLike;
  setTimer?: (fn: () => void, ms: number) => unknown;
  clearTimer?: (t: unknown) => void;
  baseDelayMs?: number;
  maxDelayMs?: number;
}

const CLOSED = 2;

export function connectBoardStream(opts: BoardStreamOptions): { close: () => void } {
  const create = opts.create ?? ((url: string) => new EventSource(url) as unknown as EventSourceLike);
  const setTimer = opts.setTimer ?? ((fn: () => void, ms: number) => setTimeout(fn, ms));
  const clearTimer = opts.clearTimer ?? ((t: unknown) => clearTimeout(t as ReturnType<typeof setTimeout>));
  const base = opts.baseDelayMs ?? 2000;
  const max = opts.maxDelayMs ?? 30_000;
  let es: EventSourceLike | null = null;
  let timer: unknown = null;
  let failures = 0;
  let stopped = false;
  let snapshots = 0;

  const open = () => {
    if (stopped) return;
    opts.onStatus?.('menyambung');
    const source = create(opts.url);
    es = source;
    source.onopen = () => {
      failures = 0;
      opts.onStatus?.('tersambung');
    };
    source.onerror = () => {
      if (source !== es) return;
      opts.onStatus?.('terputus');
      if (source.readyState === CLOSED) retry();
    };
    source.addEventListener(opts.snapshotEvent, () => {
      snapshots += 1;
      if (snapshots > 1) opts.onChange();
    });
    for (const name of opts.changeEvents) source.addEventListener(name, () => opts.onChange());
    source.addEventListener('reset', () => opts.onChange());
  };

  const retry = () => {
    es?.close();
    es = null;
    failures++;
    const delay = Math.min(max, base * 2 ** (failures - 1));
    timer = setTimer(() => {
      timer = null;
      open();
    }, delay);
  };

  open();
  return {
    close: () => {
      stopped = true;
      if (timer !== null) clearTimer(timer);
      es?.close();
      es = null;
    },
  };
}
