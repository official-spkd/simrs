import { z } from 'zod';
import { defineDomain } from './demo/store/define';
import type { ChemoOrderLock } from './onkologi';

/**
 * Toko demo bersama (ADR-0085) · domain `onkologi`: satu siklus kemoterapi (order dikunci penulis, gerbang lab
 * pra-kemo: lolos / tunda / override beralasan, verifikasi ganda dosis oleh dua verifikator berbeda). Kejadian
 * `siklus.diverifikasi` dengan `n: 2` adalah **kontrak aliran keluar** untuk farmasi (CX-1): order sitostatika siap
 * diracik, berisi dosis per obat (mg) yang diverifikasi.
 */

const isoInstant = z.iso.datetime({ offset: true });
const cycle = z.int().min(1).max(60);

export const oncologyEventSchema = z.discriminatedUnion('type', [
  z.strictObject({
    type: z.literal('siklus.order'),
    cycle,
    heightCm: z.number().min(100).max(220),
    weightKg: z.number().min(25).max(200),
    pct: z.int().min(50).max(100),
    reason: z.string().trim().max(500),
    bsa: z.number().positive().max(4),
    doses: z.record(z.string().min(1).max(80), z.int().min(0).max(100_000)),
    at: isoInstant,
  }),
  z.strictObject({
    type: z.literal('siklus.gerbang'),
    cycle,
    decision: z.enum(['lolos', 'tunda', 'override']),
    reason: z.string().trim().min(10).max(500).nullable(),
    /** Tanggal siklus baru bila ditunda (`YYYY-MM-DD`). */
    deferredTo: z.iso.date().nullable(),
    at: isoInstant,
  }),
  z.strictObject({
    /** Verifikasi dosis ke-n oleh verifikator (nama dari daftar verifikator RS), dicatat pengguna sesi. */
    type: z.literal('siklus.diverifikasi'),
    cycle,
    n: z.union([z.literal(1), z.literal(2)]),
    verifier: z.string().min(1).max(80),
    doses: z.record(z.string().min(1).max(80), z.int().min(0).max(100_000)),
    at: isoInstant,
  }),
]);
export type OncologyEvent = z.infer<typeof oncologyEventSchema>;

export interface OncologyCycle {
  lock: (ChemoOrderLock & { reason: string; by: string; at: string }) | null;
  gate: {
    decision: 'lolos' | 'tunda' | 'override';
    reason: string | null;
    deferredTo: string | null;
    by: string;
    at: string;
  } | null;
  verify: Array<{ n: 1 | 2; verifier: string; by: string; at: string }>;
}

export interface OncologyState {
  cycles: Readonly<Record<number, OncologyCycle>>;
}

const EMPTY: OncologyCycle = { lock: null, gate: null, verify: [] };

export function oncologyConflict(s: OncologyState, d: OncologyEvent): string | null {
  const c = s.cycles[d.cycle] ?? EMPTY;
  switch (d.type) {
    case 'siklus.order':
      return c.lock ? 'Order siklus ini sudah dikunci.' : null;
    case 'siklus.gerbang':
      if (!c.lock) return 'Kunci order siklus dulu.';
      return c.gate ? 'Gerbang lab siklus ini sudah diputuskan.' : null;
    case 'siklus.diverifikasi':
      if (!c.gate || c.gate.decision === 'tunda') return 'Siklus belum melewati gerbang lab.';
      if (c.verify.length !== d.n - 1) return `Verifikasi ${d.n} tidak berurutan.`;
      return null;
  }
}

export const oncologyDomain = defineDomain<OncologyState, OncologyEvent>('onkologi', {
  initial: () => ({ cycles: {} }),
  eventSchema: oncologyEventSchema,
  screens: ['onkologi'],
  validate: (s, ev) => oncologyConflict(s, ev),
  reduce: (s, ev) => {
    const d = ev.data;
    const conflict = oncologyConflict(s, d);
    if (conflict) throw new Error(conflict);
    const c = s.cycles[d.cycle] ?? EMPTY;
    const by = ev.actor.name;
    const next: OncologyCycle =
      d.type === 'siklus.order'
        ? {
            ...c,
            lock: {
              heightCm: d.heightCm,
              weightKg: d.weightKg,
              pct: d.pct,
              bsa: d.bsa,
              doses: d.doses,
              reason: d.reason,
              by,
              at: d.at,
            },
          }
        : d.type === 'siklus.gerbang'
          ? { ...c, gate: { decision: d.decision, reason: d.reason, deferredTo: d.deferredTo, by, at: d.at } }
          : { ...c, verify: [...c.verify, { n: d.n, verifier: d.verifier, by, at: d.at }] };
    return { cycles: { ...s.cycles, [d.cycle]: next } };
  },
});

/** Tahap siklus (0 order, 1 gerbang, 2 verifikasi 1, 3 verifikasi 2, 4 siap diracik). */
export function cycleStage(c: OncologyCycle | undefined): number {
  if (!c?.lock) return 0;
  if (!c.gate) return 1;
  return 2 + c.verify.length;
}
