import { QUEUE_SSE_EVENTS, type QueueDisplayEvent, queueDisplayEventSchema } from '@simrs/shared';

/**
 * F04 · Klien SSE papan antrean TV (ADR-0026, fase 2 potongan 4b), lewat BFF `/display/antrean/events`.
 * - `queue.board` / `queue.call` divalidasi kontrak bersama lalu diteruskan ke `onEvent`;
 * - sambung ulang otomatis bawaan `EventSource` mengirim `Last-Event-ID` (BFF meneruskannya ke API untuk replay);
 * - `reset` (replay tidak tersedia) → aliran ditutup dan dibuka BARU tanpa `Last-Event-ID`, sehingga server
 *   mengirim potret papan lengkap lagi;
 * - aliran yang tertutup permanen (mis. BFF membalas galat) dicoba lagi dengan jeda naik sampai `maxDelayMs`.
 * Modul murni terhadap `EventSource` yang disuntikkan (diuji tanpa browser).
 */

export type QueueStreamStatus = 'menyambung' | 'tersambung' | 'terputus';

export interface EventSourceLike {
  readyState: number;
  onopen: ((this: EventSourceLike, ev: Event) => unknown) | null;
  onerror: ((this: EventSourceLike, ev: Event) => unknown) | null;
  addEventListener(type: string, listener: (ev: MessageEvent) => void): void;
  close(): void;
}

export interface QueueStreamOptions {
  url: string;
  onEvent: (ev: QueueDisplayEvent) => void;
  onStatus?: (s: QueueStreamStatus) => void;
  /** Data event yang tidak sesuai kontrak (diabaikan, tidak menjatuhkan papan). */
  onInvalid?: (raw: string) => void;
  create?: (url: string) => EventSourceLike;
  setTimer?: (fn: () => void, ms: number) => unknown;
  clearTimer?: (t: unknown) => void;
  baseDelayMs?: number;
  maxDelayMs?: number;
}

/** `EventSource.CLOSED` (tanpa bergantung pada global di lingkungan uji). */
const CLOSED = 2;

export function connectQueueStream(opts: QueueStreamOptions): { close: () => void } {
  const create = opts.create ?? ((url: string) => new EventSource(url) as unknown as EventSourceLike);
  const setTimer = opts.setTimer ?? ((fn: () => void, ms: number) => setTimeout(fn, ms));
  const clearTimer = opts.clearTimer ?? ((t: unknown) => clearTimeout(t as ReturnType<typeof setTimeout>));
  const base = opts.baseDelayMs ?? 2000;
  const max = opts.maxDelayMs ?? 30_000;
  let es: EventSourceLike | null = null;
  let timer: unknown = null;
  let failures = 0;
  let stopped = false;

  const handle = (raw: string) => {
    let data: unknown;
    try {
      data = JSON.parse(raw);
    } catch {
      opts.onInvalid?.(raw);
      return;
    }
    const parsed = queueDisplayEventSchema.safeParse(data);
    if (parsed.success) opts.onEvent(parsed.data);
    else opts.onInvalid?.(raw);
  };

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
      // CONNECTING = EventSource menyambung ulang sendiri (dengan Last-Event-ID); CLOSED = kita yang mencoba lagi.
      if (source.readyState === CLOSED) retry();
    };
    source.addEventListener(QUEUE_SSE_EVENTS.board, (e) => handle(String(e.data)));
    source.addEventListener(QUEUE_SSE_EVENTS.call, (e) => handle(String(e.data)));
    source.addEventListener('reset', () => {
      // Replay tidak tersedia: buka aliran baru tanpa Last-Event-ID → potret papan baru dari server.
      source.close();
      if (source === es) open();
    });
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
