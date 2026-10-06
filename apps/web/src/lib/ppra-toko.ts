import { z } from 'zod';
import {
  type ActorRef,
  actorRef,
  idSchema,
  jamSchema,
  type LogLine,
  must,
  pushLog,
  roleBlock,
} from './backoffice-toko';
import { type DemoActor, defineDomain } from './demo/store/define';
import { AMS_REQUESTS, GYSSENS_DONE, GYSSENS_PENDING } from './demo/fixtures/ppra';
import { DEMO_NOW } from './demo/fixtures/waktu';
import { approvalHoursLeft, decisionBlock, gyssensResult } from './ppra';

/**
 * B08 · Domain toko demo `ppra` (ADR-0085, CX-3): putusan antibiotik cadangan, audit Gyssens berurutan, dan modul
 * PPRA aktif/tidak per RS. Langkah tim PPRA hanya posisi berhak (Apoteker atau Dokter, bukan residen) dan penyetuju
 * ≠ penulis resep (utang bug 6 Okt). `moduleOn` bisa dibaca CPOE (CD-2) untuk `orderHold`.
 */

export const PPRA_DOMAIN = 'ppra';
export const PPRA_TEAM_ROLES = ['apoteker', 'dokter'] as const;
export const MIN_MODULE_REASON = 10;

export const ppraEventSchema = z.discriminatedUnion('type', [
  z.strictObject({
    type: z.literal('putusan.dicatat'),
    id: idSchema,
    kind: z.enum(['setuju', 'tolak']),
    reason: z.string().trim().min(1).max(500),
    alternative: z.string().trim().max(200),
    jam: jamSchema,
  }),
  z.strictObject({
    type: z.literal('gyssens.dijawab'),
    caseId: idSchema,
    answer: z.boolean(),
    jam: jamSchema,
  }),
  z.strictObject({
    type: z.literal('modul.diubah'),
    on: z.boolean(),
    reason: z.string().trim().min(MIN_MODULE_REASON).max(300),
    jam: jamSchema,
  }),
]);
export type PpraEvent = z.infer<typeof ppraEventSchema>;

export interface PpraDecision {
  kind: 'setuju' | 'tolak';
  reason: string;
  alternative: string;
  jam: string;
  by: ActorRef;
}

export interface PpraStoreState {
  moduleOn: boolean;
  decisions: Record<string, PpraDecision>;
  answers: Record<string, boolean[]>;
  auditors: Record<string, string>;
  /** Kategori hasil audit bulan ini (fixture + audit di layar). */
  results: string[];
  log: LogLine[];
}

export function initialPpra(): PpraStoreState {
  return { moduleOn: true, decisions: {}, answers: {}, auditors: {}, results: [...GYSSENS_DONE], log: [] };
}

function gate(s: PpraStoreState, ev: PpraEvent, actor: DemoActor): string | null {
  switch (ev.type) {
    case 'putusan.dicatat': {
      const r = AMS_REQUESTS.find((x) => x.id === ev.id);
      if (!r) return 'Permintaan tidak ditemukan.';
      if (!s.moduleOn) return 'Modul PPRA tidak aktif; putusan tidak diperlukan.';
      if (s.decisions[ev.id]) return `${r.number} sudah diputus.`;
      if (approvalHoursLeft(r.requestedAt, DEMO_NOW) < 0) return `${r.number} sudah kedaluwarsa (24 jam).`;
      const role = roleBlock(
        actor,
        PPRA_TEAM_ROLES,
        'Putusan diambil tim PPRA (posisi Apoteker atau Dokter).',
      );
      if (role) return role;
      if (actor.name === r.prescriber)
        return 'Penulis resep tidak bisa memutus permintaannya sendiri (pemisahan tugas).';
      return decisionBlock(ev.kind, ev.reason, ev.alternative);
    }
    case 'gyssens.dijawab': {
      if (!GYSSENS_PENDING.some((c) => c.id === ev.caseId)) return 'Kasus audit tidak ditemukan.';
      if (!s.moduleOn) return 'Modul PPRA tidak aktif; audit hanya bisa dibaca.';
      const role = roleBlock(
        actor,
        PPRA_TEAM_ROLES,
        'Audit Gyssens oleh tim PPRA (posisi Apoteker atau Dokter).',
      );
      if (role) return role;
      return gyssensResult(s.answers[ev.caseId] ?? []).done ? 'Audit kasus ini sudah selesai.' : null;
    }
    case 'modul.diubah':
      return ev.on === s.moduleOn ? `Modul PPRA sudah ${s.moduleOn ? 'aktif' : 'tidak aktif'}.` : null;
  }
}

export const ppraDomain = defineDomain<PpraStoreState, PpraEvent>(PPRA_DOMAIN, {
  initial: initialPpra,
  eventSchema: ppraEventSchema,
  screens: ['ppra'],
  generic: true,
  validate: (s, ev, actor) => gate(s, ev, actor),
  reduce: (s, ev) => {
    const d = ev.data;
    must(gate(s, d, ev.actor));
    const by = actorRef(ev.actor);
    const log = (text: string) => pushLog(s.log, { jam: d.jam, text, by: by.name });
    switch (d.type) {
      case 'putusan.dicatat':
        return {
          ...s,
          decisions: {
            ...s.decisions,
            [d.id]: {
              kind: d.kind,
              reason: d.reason.trim(),
              alternative: d.alternative.trim(),
              jam: d.jam,
              by,
            },
          },
          log: log(`${d.id} ${d.kind === 'setuju' ? 'disetujui' : 'ditolak'}`),
        };
      case 'gyssens.dijawab': {
        const next = [...(s.answers[d.caseId] ?? []), d.answer];
        const out = gyssensResult(next);
        return {
          ...s,
          answers: { ...s.answers, [d.caseId]: next },
          auditors: { ...s.auditors, [d.caseId]: by.name },
          results: out.done ? [...s.results, out.category] : s.results,
        };
      }
      case 'modul.diubah':
        return {
          ...s,
          moduleOn: d.on,
          log: log(`Modul PPRA ${d.on ? 'diaktifkan' : 'dimatikan'}: ${d.reason.trim()}`),
        };
    }
  },
});
