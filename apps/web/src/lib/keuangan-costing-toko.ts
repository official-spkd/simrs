import { z } from 'zod';
import { defineDomain } from './demo/store/define';
import { KASUS_COSTING } from './demo/fixtures/costing';
import { TELAAH_REASON_MIN } from './keuangan-costing';

/**
 * I10 · Domain toko demo `costing` (ADR-0085): telaah clinical pathway per kasus yang dikirim ke komite medik
 * (catatan wajib). Data kuartal tertutup tetap hanya baca; yang tersimpan hanya telaah atas nama pengguna sesi.
 * Aturannya cukup skema + `validate` murni (kasus dari fixture), jadi memakai Server Action generik.
 */

export const COSTING_DOMAIN = 'costing';

export const costingEventSchema = z.discriminatedUnion('type', [
  z.strictObject({
    type: z.literal('telaah.dikirim'),
    caseId: z.string().regex(/^[a-z0-9-]{1,40}$/),
    note: z.string().trim().min(TELAAH_REASON_MIN).max(500),
  }),
]);
export type CostingEvent = z.infer<typeof costingEventSchema>;

export interface CostingState {
  reviews: Readonly<Record<string, { note: string; by: string; at: string }>>;
}

function gate(s: CostingState, ev: CostingEvent): string | null {
  if (!KASUS_COSTING.some((k) => k.id === ev.caseId)) return 'Kasus tidak ditemukan.';
  return s.reviews[ev.caseId] ? 'Telaah kasus ini sudah dikirim ke komite medik.' : null;
}

export const costingDomain = defineDomain<CostingState, CostingEvent>(COSTING_DOMAIN, {
  initial: () => ({ reviews: {} }),
  eventSchema: costingEventSchema,
  screens: ['costing'],
  generic: true,
  validate: (s, ev) => gate(s, ev),
  reduce: (s, ev) => {
    const err = gate(s, ev.data);
    if (err) throw new Error(err);
    return {
      reviews: { ...s.reviews, [ev.data.caseId]: { note: ev.data.note, by: ev.actor.name, at: ev.at } },
    };
  },
});
