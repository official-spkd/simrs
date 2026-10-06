import { z } from 'zod';
import { type DemoActor, defineDomain } from './demo/store/define';
import { JASPEL_START } from './demo/fixtures/jaspel';
import { stepProblem, TAHAP_JASPEL, type TahapJaspel } from './keuangan-jaspel';
import { autoJurnalSchema } from './keuangan-jurnal';

/**
 * U08 · Domain toko demo `jasa-pelayanan` (ADR-0085): tahap rekap jasa pelayanan Oktober (verifikasi akuntan →
 * persetujuan manajemen yang bukan pemverifikasi (id pengguna sesi) → pembayaran akuntan) dan ekspor CSV. Persetujuan
 * membawa jurnal akrual dan pembayaran membawa jurnal bayar (Utang jasa pelayanan 2-1440, Utang PPh 21 2-1430) ke
 * Akuntansi.
 */

export const JASPEL_DOMAIN = 'jasa-pelayanan';

const stamp = z.iso.datetime({ offset: true });
const stages = TAHAP_JASPEL.map((t) => t.id) as [TahapJaspel, ...TahapJaspel[]];

export const jaspelEventSchema = z.discriminatedUnion('type', [
  z.strictObject({
    type: z.literal('tahap.maju'),
    /** Tahap saat ini (yang dimajukan); ditolak bila sudah berubah. */
    from: z.enum(stages),
    at: stamp,
    jurnal: z.array(autoJurnalSchema).max(1),
  }),
  z.strictObject({ type: z.literal('rekap.ekspor'), at: stamp }),
]);
export type JaspelEvent = z.infer<typeof jaspelEventSchema>;

export interface JaspelState {
  stage: TahapJaspel;
  log: Partial<Record<TahapJaspel, { by: string; byId?: string; at: string }>>;
  exported: { by: string; at: string } | null;
}

export function nextStage(stage: TahapJaspel): TahapJaspel | null {
  const i = TAHAP_JASPEL.findIndex((t) => t.id === stage);
  return TAHAP_JASPEL[i + 1]?.id ?? null;
}

function gate(s: JaspelState, ev: JaspelEvent, actor: DemoActor): string | null {
  if (ev.type === 'rekap.ekspor') {
    return s.stage === 'disetujui' || s.stage === 'dibayar'
      ? null
      : 'Ekspor tersedia setelah rekap disetujui.';
  }
  if (ev.from !== s.stage) return 'Tahap rekap sudah berubah; muat ulang.';
  if (!nextStage(s.stage)) return 'Rekap sudah dibayar.';
  const v = s.log.diverifikasi;
  return stepProblem(
    s.stage,
    { id: actor.userId, name: actor.name, role: actor.role },
    v?.by ?? null,
    v?.byId ?? null,
  );
}

export const jaspelDomain = defineDomain<JaspelState, JaspelEvent>(JASPEL_DOMAIN, {
  initial: () => ({ stage: JASPEL_START.stage, log: { ...JASPEL_START.log }, exported: null }),
  eventSchema: jaspelEventSchema,
  screens: ['jaspel'],
  validate: gate,
  reduce: (s, ev) => {
    const d = ev.data;
    const err = gate(s, d, ev.actor);
    if (err) throw new Error(err);
    if (d.type === 'rekap.ekspor') return { ...s, exported: { by: ev.actor.name, at: d.at } };
    const next = nextStage(s.stage);
    if (!next) return s;
    return {
      ...s,
      stage: next,
      log: { ...s.log, [next]: { by: ev.actor.name, byId: ev.actor.userId, at: d.at } },
    };
  },
});
