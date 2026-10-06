import { describe, expect, it } from 'vitest';
import { z } from 'zod';
import { affectedBy, type DemoActor, defineDomain, on, project, type StoredEvent } from './define';

const actor: DemoActor = { userId: 'u-1', name: 'Analis Uji', role: 'analis_lab', baseRole: null };

const orderEvent = z.discriminatedUnion('type', [
  z.strictObject({ type: z.literal('order.dibuat'), id: z.string(), item: z.string() }),
  z.strictObject({ type: z.literal('order.dibatalkan'), id: z.string() }),
]);

/** Domain sumber contoh: order. */
const orders = defineDomain('order-uji', {
  initial: () => ({ open: [] as string[] }),
  eventSchema: orderEvent,
  screens: ['cpoe'],
  reduce: (s, ev) => {
    const d = ev.data;
    if (d.type === 'order.dibuat') {
      if (s.open.includes(d.id)) throw new Error('ganda');
      return { open: [...s.open, d.id] };
    }
    return { open: s.open.filter((x) => x !== d.id) };
  },
});

/** Domain pelanggan contoh: worklist lab membaca order tanpa mengimpor komponen order. */
interface Worklist {
  rows: string[];
  validated: string[];
}
const worklist = defineDomain('worklist-uji', {
  initial: (): Worklist => ({ rows: [], validated: [] }),
  eventSchema: z.strictObject({ type: z.literal('hasil.divalidasi'), id: z.string() }),
  screens: ['lab'],
  subscriptions: [
    on(orders, (s: Worklist, ev) =>
      ev.data.type === 'order.dibuat' ? { ...s, rows: [...s.rows, `${ev.data.id}:${ev.data.item}`] } : s,
    ),
  ],
  reduce: (s, ev) => ({ ...s, validated: [...s.validated, ev.data.id] }),
});

let seq = 0;
const ev = (domain: string, data: unknown): StoredEvent => ({
  seq: ++seq,
  domain,
  at: '2026-10-05T03:45:00.000Z',
  actor,
  data,
});

describe('definisi domain toko demo', () => {
  it('nama domain dibatasi; domain tidak boleh melanggan dirinya', () => {
    expect(() =>
      defineDomain('Bukan Nama', {
        initial: () => 0,
        eventSchema: orderEvent,
        reduce: (s) => s,
        screens: [],
      }),
    ).toThrow(/tidak sah/);
    expect(() =>
      defineDomain('order-uji', {
        initial: () => 0,
        eventSchema: orderEvent,
        reduce: (s) => s,
        screens: [],
        subscriptions: [on(orders, (s: number) => s)],
      }),
    ).toThrow(/dirinya sendiri/);
    expect(orders.generic).toBe(false);
  });

  it('keadaan = initial + kejadian berurutan; initial tidak pernah dimutasi', () => {
    seq = 0;
    const log = {
      seq: 2,
      resetSeq: 0,
      events: [
        ev('order-uji', { type: 'order.dibuat', id: 'o1', item: 'kalium' }),
        ev('order-uji', { type: 'order.dibuat', id: 'o2', item: 'darah lengkap' }),
      ],
    };
    const p = project(orders, log);
    expect(p.state.open).toEqual(['o1', 'o2']);
    expect(p.rev).toBe(2);
    expect(p.applied).toBe(2);
    expect(project(orders, { seq: 0, resetSeq: 0, events: [] }).state.open).toEqual([]);
  });

  it('kejadian yang gagal skema atau ditolak reducer dilewati, tetapi revisi tetap maju', () => {
    seq = 0;
    const log = {
      seq: 3,
      resetSeq: 0,
      events: [
        ev('order-uji', { type: 'order.dibuat', id: 'o1', item: 'kalium' }),
        ev('order-uji', { type: 'order.dibuat', id: 'o1', item: 'ganda' }),
        ev('order-uji', { type: 'tidak.dikenal' }),
      ],
    };
    const p = project(orders, log);
    expect(p.state.open).toEqual(['o1']);
    expect(p.applied).toBe(1);
    expect(p.rev).toBe(3);
  });

  it('langganan lintas domain: pelanggan membaca kejadian sumber; revisi ikut kejadian sumber', () => {
    seq = 0;
    const log = {
      seq: 4,
      resetSeq: 0,
      events: [
        ev('order-uji', { type: 'order.dibuat', id: 'o1', item: 'kalium' }),
        ev('lain', { type: 'apa.saja' }),
        ev('worklist-uji', { type: 'hasil.divalidasi', id: 'o1' }),
        ev('order-uji', { type: 'order.dibatalkan', id: 'o1' }),
      ],
    };
    const w = project(worklist, log);
    expect(w.state).toEqual({ rows: ['o1:kalium'], validated: ['o1'] });
    // Kejadian sumber yang tidak dibaca reducer pelanggan tetap memajukan revisi (tampilan bisa basi).
    expect(w.rev).toBe(4);
    // Domain sumber tidak terpengaruh kejadian pelanggan.
    expect(project(orders, log).rev).toBe(4);
    expect(project(orders, { ...log, events: log.events.slice(0, 3) }).rev).toBe(1);
  });

  it('revisi setelah mulai ulang = seq mulai ulang', () => {
    expect(project(orders, { seq: 9, resetSeq: 9, events: [] }).rev).toBe(9);
  });

  it('affectedBy: domain sumber + pelanggannya', () => {
    expect(affectedBy('order-uji', [orders, worklist])).toEqual(['order-uji', 'worklist-uji']);
    expect(affectedBy('worklist-uji', [orders, worklist])).toEqual(['worklist-uji']);
  });
});
