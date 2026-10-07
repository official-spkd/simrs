import { CLINICAL_SSE_EVENTS, type EwsEscalationSseEvent, ewsEscalationSseEventSchema } from '@simrs/shared';
import type { EventSourceLike } from './queue-sse';

/**
 * K12 · Klien SSE eskalasi EWS layar Rawat inap (lewat BFF `/klinis/rawat-inap/events`, kanal 3.1 `ews`).
 * - `ews.escalation` divalidasi kontrak bersama lalu diteruskan ke `onEscalation` (muatan tanpa PHI);
 * - sambung ulang otomatis bawaan `EventSource` (CONNECTING) dibiarkan; aliran yang tertutup permanen dicoba lagi
 *   dengan jeda naik sampai `maxDelayMs` (API menutup aliran klinis tiap ≤ 5 menit untuk menghitung ulang lingkup).
 * Modul murni terhadap `EventSource` yang disuntikkan (diuji tanpa browser).
 */

export type EwsStreamStatus = 'menyambung' | 'tersambung' | 'terputus';

export interface EwsStreamOptions {
  url: string;
  onEscalation: (ev: EwsEscalationSseEvent) => void;
  onStatus?: (s: EwsStreamStatus) => void;
  create?: (url: string) => EventSourceLike;
  setTimer?: (fn: () => void, ms: number) => unknown;
  clearTimer?: (t: unknown) => void;
  baseDelayMs?: number;
  maxDelayMs?: number;
}

const CLOSED = 2;

export function connectEwsStream(opts: EwsStreamOptions): { close: () => void } {
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
      return;
    }
    const parsed = ewsEscalationSseEventSchema.safeParse(data);
    if (parsed.success) opts.onEscalation(parsed.data);
  };

  const retry = () => {
    es?.close();
    es = null;
    failures++;
    timer = setTimer(
      () => {
        timer = null;
        open();
      },
      Math.min(max, base * 2 ** (failures - 1)),
    );
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
      if (source.readyState === CLOSED) retry();
    };
    source.addEventListener(CLINICAL_SSE_EVENTS.ewsEscalation, (e) => handle(String(e.data)));
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
