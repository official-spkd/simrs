import { describe, expect, it, vi } from 'vitest';
import { connectEwsStream } from './ews-sse';
import type { EventSourceLike } from './queue-sse';

class FakeSource implements EventSourceLike {
  static all: FakeSource[] = [];
  readyState = 0;
  onopen: EventSourceLike['onopen'] = null;
  onerror: EventSourceLike['onerror'] = null;
  closed = false;
  private listeners = new Map<string, Array<(ev: MessageEvent) => void>>();
  constructor(readonly url: string) {
    FakeSource.all.push(this);
  }
  addEventListener(type: string, fn: (ev: MessageEvent) => void) {
    this.listeners.set(type, [...(this.listeners.get(type) ?? []), fn]);
  }
  emit(type: string, data: unknown) {
    for (const fn of this.listeners.get(type) ?? []) {
      fn({ data: typeof data === 'string' ? data : JSON.stringify(data) } as MessageEvent);
    }
  }
  open() {
    this.readyState = 1;
    this.onopen?.call(this, new Event('open'));
  }
  fail(state: number) {
    this.readyState = state;
    this.onerror?.call(this, new Event('error'));
  }
  close() {
    this.closed = true;
    this.readyState = 2;
  }
}

const escalation = {
  observationId: '01a107db-b268-746d-92f7-10598bb1cc42',
  encounterId: '01a107db-b268-746d-92f7-10598bb1cc43',
  unitId: null,
  score: 9,
  maxParam: 3,
  risk: 'tinggi',
  at: '2026-10-07T08:00:00.000Z',
};

describe('klien SSE eskalasi EWS (layar Rawat inap mode api)', () => {
  const setup = () => {
    FakeSource.all = [];
    const events: unknown[] = [];
    const statuses: string[] = [];
    const timers: Array<{ fn: () => void; ms: number }> = [];
    const conn = connectEwsStream({
      url: '/klinis/rawat-inap/events',
      onEscalation: (e) => events.push(e),
      onStatus: (s) => statuses.push(s),
      create: (url) => new FakeSource(url),
      setTimer: (fn, ms) => timers.push({ fn, ms }),
      clearTimer: vi.fn(),
    });
    return { conn, events, statuses, timers };
  };

  it('event ews.escalation divalidasi kontrak; muatan rusak atau ber-PHI tambahan diabaikan', () => {
    const { events, statuses } = setup();
    const es = FakeSource.all[0];
    if (!es) throw new Error('EventSource');
    expect(es.url).toBe('/klinis/rawat-inap/events');
    es.open();
    es.emit('ews.escalation', escalation);
    es.emit('ews.escalation', { ...escalation, patientName: 'Tn. Fiktif' });
    es.emit('ews.escalation', '{rusak');
    expect(events).toEqual([escalation]);
    expect(statuses).toEqual(['menyambung', 'tersambung']);
  });

  it('aliran tertutup permanen dicoba lagi dengan jeda naik; tutup menghentikan percobaan', () => {
    const { conn, statuses, timers } = setup();
    FakeSource.all[0]?.fail(2);
    expect(statuses.at(-1)).toBe('terputus');
    expect(timers.map((t) => t.ms)).toEqual([2000]);
    timers[0]?.fn();
    expect(FakeSource.all).toHaveLength(2);
    FakeSource.all[1]?.fail(2);
    expect(timers.map((t) => t.ms)).toEqual([2000, 4000]);
    // Sambung ulang bawaan EventSource (CONNECTING) tidak memicu percobaan kita.
    timers[1]?.fn();
    FakeSource.all[2]?.fail(0);
    expect(timers).toHaveLength(2);
    conn.close();
    expect(FakeSource.all[2]?.closed).toBe(true);
  });
});
