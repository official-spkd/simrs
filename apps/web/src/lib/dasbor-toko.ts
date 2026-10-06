import { z } from 'zod';
import { jamSchema, roleBlock } from './backoffice-toko';
import { defineDomain } from './demo/store/define';

/**
 * I09 · Domain toko demo `dasbor` (ADR-0085, CX-3): tanda "ditindaklanjuti" pada butir "Perlu keputusan direksi"
 * (log direksi), menggantikan penyimpanan sesi peramban. Kunci = id + judul alert: bila keadaan berubah (mis. stok
 * enoksaparin, jumlah pasien IGD menunggu) dan judulnya berubah, butir itu terbuka lagi. Hanya posisi Manajemen.
 */

export const DASHBOARD_DOMAIN = 'dasbor';

export const dashboardEventSchema = z.discriminatedUnion('type', [
  z.strictObject({
    type: z.literal('alert.ditandai'),
    key: z.string().min(1).max(300),
    title: z.string().min(1).max(200),
    jam: jamSchema,
  }),
  z.strictObject({ type: z.literal('alert.dibatalkan'), key: z.string().min(1).max(300), jam: jamSchema }),
]);
export type DashboardEvent = z.infer<typeof dashboardEventSchema>;

export interface DashboardStoreState {
  acks: Record<string, { title: string; jam: string; by: string }>;
}

export const dashboardAlertKey = (a: { id: string; title: string }) => `${a.id}|${a.title}`;

export const dashboardDomain = defineDomain<DashboardStoreState, DashboardEvent>(DASHBOARD_DOMAIN, {
  initial: () => ({ acks: {} }),
  eventSchema: dashboardEventSchema,
  screens: ['dasbor'],
  generic: true,
  validate: (s, ev, actor) =>
    roleBlock(actor, ['manajemen'], 'Keputusan direksi ditandai posisi Manajemen.') ??
    (ev.type === 'alert.ditandai'
      ? s.acks[ev.key]
        ? 'Butir ini sudah ditindaklanjuti.'
        : null
      : s.acks[ev.key]
        ? null
        : 'Butir ini belum ditandai.'),
  reduce: (s, ev) => {
    const d = ev.data;
    if (d.type === 'alert.ditandai')
      return { acks: { ...s.acks, [d.key]: { title: d.title, jam: d.jam, by: ev.actor.name } } };
    const acks = { ...s.acks };
    delete acks[d.key];
    return { acks };
  },
});
