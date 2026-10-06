import { z } from 'zod';
import { type DemoActor, defineDomain } from './demo/store/define';
import { GOLIVE_CHECKLIST, GOLIVE_OWNERS } from './demo/fixtures/golive';
import { canDecide, itemStateFrom, type ItemState } from './golive';

/**
 * Fase 10 · Domain toko demo `golive` (ADR-0085): ceklis runbook berpemilik dan keputusan go/no-go. Gerbang memakai
 * pengguna sesi: hanya posisi Manajemen (direksi) yang memutuskan atau membuka kembali keputusan, tercatat atas
 * namanya; GO terkunci sampai item kritis selesai dan berpemilik. Aturan murni terhadap keadaan + pelaku → `generic`.
 */

export const GOLIVE_DOMAIN = 'golive';
export const DECIDER_ROLE = 'manajemen';
export const DECIDER_ONLY = 'Hanya posisi Manajemen (direksi) yang bisa memutuskan go/no-go.';

const jam = z.string().regex(/^([01]\d|2[0-3])\.[0-5]\d$/);
const ITEM_IDS = new Set(GOLIVE_CHECKLIST.flatMap((a) => a.items.map((i) => i.id)));

export const goLiveEventSchema = z.discriminatedUnion('type', [
  z.strictObject({
    type: z.literal('item.diubah'),
    id: z.string().refine((v) => ITEM_IDS.has(v), 'Item ceklis tidak dikenal'),
    done: z.boolean(),
    owner: z.union([z.literal(''), z.enum(GOLIVE_OWNERS as unknown as [string, ...string[]])]),
    jam,
  }),
  z.strictObject({
    type: z.literal('keputusan.diambil'),
    kind: z.enum(['go', 'nogo']),
    note: z.string().max(500),
    jam,
  }),
  z.strictObject({ type: z.literal('keputusan.dibuka'), jam }),
]);
export type GoLiveEvent = z.infer<typeof goLiveEventSchema>;

export interface GoLiveStoreState {
  items: ItemState;
  decision: { kind: 'go' | 'nogo'; note: string; at: string; by: string } | null;
  log: ReadonlyArray<{ t: string; text: string }>;
}

function gate(s: GoLiveStoreState, ev: GoLiveEvent, actor: DemoActor): string | null {
  switch (ev.type) {
    case 'item.diubah':
      return s.decision ? 'Keputusan sudah diambil; buka kembali keputusan untuk mengubah ceklis.' : null;
    case 'keputusan.diambil': {
      if (actor.role !== DECIDER_ROLE) return DECIDER_ONLY;
      if (s.decision) return 'Keputusan sudah diambil.';
      const c = canDecide(ev.kind, ev.note, GOLIVE_CHECKLIST, s.items);
      return c.ok ? null : c.reason;
    }
    case 'keputusan.dibuka':
      if (actor.role !== DECIDER_ROLE) return DECIDER_ONLY;
      return s.decision ? null : 'Belum ada keputusan.';
  }
}

export const goLiveDomain = defineDomain<GoLiveStoreState, GoLiveEvent>(GOLIVE_DOMAIN, {
  initial: () => ({ items: itemStateFrom(GOLIVE_CHECKLIST), decision: null, log: [] }),
  eventSchema: goLiveEventSchema,
  screens: ['golive'],
  generic: true,
  validate: gate,
  reduce: (s, ev) => {
    const d = ev.data;
    const err = gate(s, d, ev.actor);
    if (err) throw new Error(err);
    const by = ev.actor.name;
    switch (d.type) {
      case 'item.diubah':
        return { ...s, items: { ...s.items, [d.id]: { done: d.done, owner: d.owner } } };
      case 'keputusan.diambil':
        return {
          ...s,
          decision: { kind: d.kind, note: d.note.trim(), at: d.jam, by },
          log: [{ t: d.jam, text: `Keputusan ${d.kind === 'go' ? 'GO' : 'NO-GO'} (${by})` }, ...s.log],
        };
      case 'keputusan.dibuka':
        return {
          ...s,
          decision: null,
          log: [{ t: d.jam, text: `Keputusan dibuka kembali (${by})` }, ...s.log],
        };
    }
  },
});
