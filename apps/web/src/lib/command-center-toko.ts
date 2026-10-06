import { z } from 'zod';
import { jamSchema, must, roleBlock } from './backoffice-toko';
import { defineDomain } from './demo/store/define';

/**
 * I09 · Domain toko demo `command-center` (ADR-0085, CX-3): keputusan atas alert (tindakan + catatan + penanggung
 * jawab). Kapasitas bed, IGD, dan antrean TIDAK disimpan di sini: halaman membacanya langsung dari domain asalnya
 * (`tempat-tidur`, `klinis-igd`, `antrean`/`pendaftaran`) lewat pengambil data layar Tempat tidur, IGD, dan papan
 * antrean, sehingga angkanya sama dengan layar asal. Keputusan dikunci ke isi alert saat diputus (`key` = id +
 * judul + rincian): bila keadaan berubah dan alert muncul dengan rincian baru, alert itu perlu keputusan baru.
 */

export const COMMAND_CENTER_DOMAIN = 'command-center';
export const DECIDER_ROLES = ['manajemen'] as const;

export const commandEventSchema = z.discriminatedUnion('type', [
  z.strictObject({
    type: z.literal('alert.ditindaklanjuti'),
    key: z.string().min(1).max(400),
    title: z.string().min(1).max(200),
    action: z.string().min(1).max(120),
    note: z.string().trim().min(10).max(300),
    jam: jamSchema,
  }),
]);
export type CommandEvent = z.infer<typeof commandEventSchema>;

export interface CommandAck {
  title: string;
  action: string;
  note: string;
  jam: string;
  by: string;
}

export interface CommandStoreState {
  acks: Record<string, CommandAck>;
}

export const alertKey = (a: { id: string; title: string; detail: string }) => `${a.id}|${a.title}|${a.detail}`;

export const commandDomain = defineDomain<CommandStoreState, CommandEvent>(COMMAND_CENTER_DOMAIN, {
  initial: () => ({ acks: {} }),
  eventSchema: commandEventSchema,
  screens: ['command-center'],
  generic: true,
  validate: (s, ev, actor) =>
    roleBlock(actor, DECIDER_ROLES, 'Keputusan alert oleh posisi Manajemen.') ??
    (s.acks[ev.key] ? 'Alert ini sudah ditindaklanjuti.' : null),
  reduce: (s, ev) => {
    const d = ev.data;
    must(s.acks[d.key] ? 'Alert ini sudah ditindaklanjuti.' : null);
    return {
      acks: {
        ...s.acks,
        [d.key]: { title: d.title, action: d.action, note: d.note.trim(), jam: d.jam, by: ev.actor.name },
      },
    };
  },
});
