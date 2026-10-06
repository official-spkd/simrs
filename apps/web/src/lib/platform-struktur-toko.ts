import { CARE_CLASSES, UNIT_KINDS } from '@simrs/shared';
import { z } from 'zod';
import { defineDomain } from './demo/store/define';
import { DEMO_STRUCTURE, DEMO_STRUCTURE_LOG } from './demo/fixtures/platform';
import {
  addChild,
  canDeactivate,
  canReactivate,
  deactivate,
  KIND_LABEL,
  reactivate,
  type StructNode,
} from './platform-struktur';

/**
 * P01 · Domain toko demo `struktur` (ADR-0085): simpul baru, nonaktif/aktif kembali, dan kiriman rekap bed ke antrean
 * Aplicare dari layar Struktur RS. Aturan murni (`addChild`, `canDeactivate`, `canReactivate`) → `generic`.
 * Kejadian `simpul.dinonaktifkan` (id simpul + turunannya nonaktif) bisa dilanggan papan Tempat tidur (CD-2) agar
 * bed nonaktif tidak bisa dipakai admisi.
 */

export const STRUCTURE_DOMAIN = 'struktur';

const jam = z.string().regex(/^([01]\d|2[0-3])\.[0-5]\d$/);
const nodeId = z.string().min(1).max(200);

export const structureEventSchema = z.discriminatedUnion('type', [
  z.strictObject({
    type: z.literal('simpul.ditambah'),
    parentId: nodeId,
    code: z.string().max(40),
    name: z.string().max(120),
    unitKind: z.enum(UNIT_KINDS).optional(),
    careClass: z.enum(CARE_CLASSES).optional(),
    jam,
  }),
  z.strictObject({
    type: z.literal('simpul.dinonaktifkan'),
    id: nodeId,
    reason: z.string().trim().min(5).max(300),
    jam,
  }),
  z.strictObject({ type: z.literal('simpul.diaktifkan'), id: nodeId, jam }),
  z.strictObject({ type: z.literal('aplicare.dikirim'), jam }),
]);
export type StructureEvent = z.infer<typeof structureEventSchema>;

export interface StructureStoreState {
  nodes: readonly StructNode[];
  log: ReadonlyArray<{ t: string; text: string }>;
  aplicare: { jam: string; by: string } | null;
}

function gate(s: StructureStoreState, ev: StructureEvent): string | null {
  switch (ev.type) {
    case 'simpul.ditambah': {
      const r = addChild(s.nodes, ev.parentId, ev);
      return r.ok ? null : r.message;
    }
    case 'simpul.dinonaktifkan': {
      const c = canDeactivate(s.nodes, ev.id);
      return c.ok ? null : c.reason;
    }
    case 'simpul.diaktifkan': {
      const c = canReactivate(s.nodes, ev.id);
      return c.ok ? null : c.reason;
    }
    case 'aplicare.dikirim':
      return null;
  }
}

export const structureDomain = defineDomain<StructureStoreState, StructureEvent>(STRUCTURE_DOMAIN, {
  initial: () => ({ nodes: [...DEMO_STRUCTURE], log: [...DEMO_STRUCTURE_LOG], aplicare: null }),
  eventSchema: structureEventSchema,
  screens: ['struktur'],
  generic: true,
  validate: (s, ev) => gate(s, ev),
  reduce: (s, ev) => {
    const d = ev.data;
    const err = gate(s, d);
    if (err) throw new Error(err);
    const by = ev.actor.name;
    const entry = (text: string) => [{ t: d.jam, text: `${text} (${by})` }, ...s.log];
    switch (d.type) {
      case 'simpul.ditambah': {
        const r = addChild(s.nodes, d.parentId, d);
        if (!r.ok) return s;
        const parent = s.nodes.find((n) => n.id === d.parentId);
        return {
          ...s,
          nodes: r.nodes,
          log: entry(
            `${KIND_LABEL[r.node.kind]} ${r.node.code} (${r.node.name}) ditambahkan di ${parent?.name ?? ''}`,
          ),
        };
      }
      case 'simpul.dinonaktifkan': {
        const n = s.nodes.find((x) => x.id === d.id);
        return {
          ...s,
          nodes: deactivate(s.nodes, d.id),
          log: entry(`${n ? `${KIND_LABEL[n.kind]} ${n.code}` : d.id} dinonaktifkan · ${d.reason}`),
        };
      }
      case 'simpul.diaktifkan': {
        const n = s.nodes.find((x) => x.id === d.id);
        return {
          ...s,
          nodes: reactivate(s.nodes, d.id),
          log: entry(`${n ? `${KIND_LABEL[n.kind]} ${n.code}` : d.id} diaktifkan kembali`),
        };
      }
      case 'aplicare.dikirim':
        return {
          ...s,
          aplicare: { jam: d.jam, by },
          log: entry('Ketersediaan bed per kelas dikirim ke antrean Aplicare'),
        };
    }
  },
});
