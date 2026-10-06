import { z } from 'zod';
import { actorRef, idSchema, jamSchema, must, roleBlock } from './backoffice-toko';
import { type DemoActor, defineDomain } from './demo/store/define';
import { LOGBOOK, TRAINEES } from './demo/fixtures/pendidikan';
import { levelUpBlock, type LogbookEntry, returnBlock, type SupervisionLevel, verifiedCount } from './pendidikan';

/**
 * B10 · Domain toko demo `pendidikan` (ADR-0085, CX-3): verifikasi/pengembalian logbook dan kenaikan tingkat
 * supervisi peserta didik. Langkah supervisor hanya posisi Dokter. Kejadian `tingkat.dinaikkan` {traineeId, level}
 * bisa dilanggan CPPT/CPOE (CD-2) untuk aturan co-sign.
 */

export const EDUCATION_DOMAIN = 'pendidikan';
export const SUPERVISOR_ROLES = ['dokter'] as const;

export const educationEventSchema = z.discriminatedUnion('type', [
  z.strictObject({ type: z.literal('logbook.diverifikasi'), id: idSchema, jam: jamSchema }),
  z.strictObject({
    type: z.literal('logbook.dikembalikan'),
    id: idSchema,
    feedback: z.string().trim().min(10).max(400),
    jam: jamSchema,
  }),
  z.strictObject({
    type: z.literal('tingkat.dinaikkan'),
    traineeId: idSchema,
    level: z.number().int().min(2).max(4),
    reason: z.string().trim().min(10).max(400),
    jam: jamSchema,
  }),
]);
export type EducationEvent = z.infer<typeof educationEventSchema>;

export interface EducationStoreState {
  levels: Record<string, SupervisionLevel>;
  entries: Array<LogbookEntry & { by?: string; jam?: string }>;
  promotions: Array<{ traineeId: string; level: SupervisionLevel; reason: string; jam: string; by: string }>;
}

export function initialEducation(): EducationStoreState {
  return {
    levels: Object.fromEntries(TRAINEES.map((t) => [t.id, t.level])),
    entries: LOGBOOK.map((e) => ({ ...e })),
    promotions: [],
  };
}

const SUP = 'Verifikasi logbook dan kenaikan tingkat oleh supervisor (posisi Dokter).';

function gate(s: EducationStoreState, ev: EducationEvent, actor: DemoActor): string | null {
  const role = roleBlock(actor, SUPERVISOR_ROLES, SUP);
  if (role) return role;
  if (ev.type === 'tingkat.dinaikkan') {
    const t = TRAINEES.find((x) => x.id === ev.traineeId);
    if (!t) return 'Peserta didik tidak ditemukan.';
    const level = s.levels[t.id] ?? t.level;
    if (ev.level !== level + 1) return 'Tingkat hanya naik satu per satu.';
    return levelUpBlock(level, verifiedCount(s.entries, t.id, t.competency));
  }
  const e = s.entries.find((x) => x.id === ev.id);
  if (!e) return 'Entri logbook tidak ditemukan.';
  if (e.status !== 'menunggu') return 'Entri logbook ini sudah diputus.';
  return ev.type === 'logbook.dikembalikan' ? returnBlock(ev.feedback) : null;
}

export const educationDomain = defineDomain<EducationStoreState, EducationEvent>(EDUCATION_DOMAIN, {
  initial: initialEducation,
  eventSchema: educationEventSchema,
  screens: ['pendidikan'],
  generic: true,
  validate: (s, ev, actor) => gate(s, ev, actor),
  reduce: (s, ev) => {
    const d = ev.data;
    must(gate(s, d, ev.actor));
    const by = actorRef(ev.actor).name;
    if (d.type === 'tingkat.dinaikkan') {
      const level = d.level as SupervisionLevel;
      return {
        ...s,
        levels: { ...s.levels, [d.traineeId]: level },
        promotions: [{ traineeId: d.traineeId, level, reason: d.reason.trim(), jam: d.jam, by }, ...s.promotions],
      };
    }
    return {
      ...s,
      entries: s.entries.map((e) =>
        e.id !== d.id
          ? e
          : d.type === 'logbook.diverifikasi'
            ? { ...e, status: 'terverifikasi', by, jam: d.jam }
            : { ...e, status: 'dikembalikan', feedback: d.feedback.trim(), by, jam: d.jam },
      ),
    };
  },
});
