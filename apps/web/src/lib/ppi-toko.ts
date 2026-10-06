import { z } from 'zod';
import { type ActorRef, actorRef, idSchema, jamSchema, must, whenSchema } from './backoffice-toko';
import { defineDomain } from './demo/store/define';
import {
  BUNDLE_AUDITS,
  BUNDLES,
  HAI_MONTH,
  HAI_SUSPECTS,
  handHygieneObservations,
  ISOLATION_REQUESTS,
  ISOLATION_ROOMS,
} from './demo/fixtures/ppi';
import {
  bundleCompliant,
  confirmBlock,
  HH_MOMENTS,
  type HaiType,
  type HhObservation,
  type IsolationRoom,
  roomBlock,
} from './ppi';

/**
 * B07 · Domain toko demo `ppi` (ADR-0085, CX-3): konfirmasi/penolakan suspek HAI (pembilang), sensus harian hari alat
 * (penyebut), observasi kebersihan tangan 5 momen, audit bundle all-or-none, dan penempatan isolasi. Indikator Mutu
 * (INM-01 kebersihan tangan) dan Dasbor dihitung dari keadaan ini, bukan angka ketik.
 */

export const PPI_DOMAIN = 'ppi';
export const MIN_PPI_REASON = 10;
const count = z.number().int().min(0).max(999);

export const ppiEventSchema = z.discriminatedUnion('type', [
  z.strictObject({
    type: z.literal('suspek.dikonfirmasi'),
    id: idSchema,
    checks: z.array(z.boolean()).max(10),
    when: whenSchema,
  }),
  z.strictObject({
    type: z.literal('suspek.ditolak'),
    id: idSchema,
    reason: z.string().trim().min(MIN_PPI_REASON).max(300),
    when: whenSchema,
  }),
  z.strictObject({
    type: z.literal('sensus.dicatat'),
    counts: z.strictObject({ isk: count, vap: count, phlebitis: count, ido: count }),
    jam: jamSchema,
  }),
  z.strictObject({
    type: z.literal('hh.dicatat'),
    profession: z.enum(['Perawat', 'Dokter', 'Bidan', 'Penunjang']),
    moment: z.number().int().min(0).max(HH_MOMENTS.length - 1),
    action: z.enum(['handrub', 'cuci', 'tidak']),
    jam: jamSchema,
  }),
  z.strictObject({
    type: z.literal('bundle.diaudit'),
    bundleId: idSchema,
    rm: z.string().regex(/^\d{2}-\d{2}-\d{2}-\d{2}$/),
    checks: z.array(z.boolean()).max(10),
    jam: jamSchema,
  }),
  z.strictObject({ type: z.literal('isolasi.ditempatkan'), requestId: idSchema, roomId: idSchema, jam: jamSchema }),
]);
export type PpiEvent = z.infer<typeof ppiEventSchema>;

export interface PpiStoreState {
  month: Record<HaiType, { cases: number; denominator: number }>;
  decisions: Record<string, { kind: 'hai' | 'bukan'; when: string; reason?: string; by: ActorRef }>;
  census: { jam: string; by: string } | null;
  handHygiene: HhObservation[];
  hhSession: number;
  bundleAudits: Record<string, { total: number; compliant: number }>;
  rooms: IsolationRoom[];
  placed: Record<string, { room: string; jam: string; by: string }>;
}

export function initialPpi(): PpiStoreState {
  return {
    month: Object.fromEntries(Object.entries(HAI_MONTH).map(([k, v]) => [k, { ...v }])) as PpiStoreState['month'],
    decisions: {},
    census: null,
    handHygiene: handHygieneObservations(),
    hhSession: 0,
    bundleAudits: Object.fromEntries(Object.entries(BUNDLE_AUDITS).map(([k, v]) => [k, { ...v }])),
    rooms: ISOLATION_ROOMS.map((r) => ({ ...r })),
    placed: {},
  };
}

function gate(s: PpiStoreState, ev: PpiEvent): string | null {
  switch (ev.type) {
    case 'suspek.dikonfirmasi':
    case 'suspek.ditolak': {
      const x = HAI_SUSPECTS.find((h) => h.id === ev.id);
      if (!x) return 'Kasus suspek tidak ditemukan.';
      if (s.decisions[ev.id]) return 'Kasus suspek ini sudah diputus.';
      return ev.type === 'suspek.dikonfirmasi' ? confirmBlock(x.type, ev.checks) : null;
    }
    case 'sensus.dicatat':
      return s.census ? 'Sensus hari ini sudah tercatat.' : null;
    case 'hh.dicatat':
      return null;
    case 'bundle.diaudit': {
      const b = BUNDLES.find((x) => x.id === ev.bundleId);
      if (!b) return 'Bundle tidak dikenal.';
      return ev.checks.length === b.elements.length ? null : 'Elemen bundle tidak sesuai.';
    }
    case 'isolasi.ditempatkan': {
      const r = ISOLATION_REQUESTS.find((x) => x.id === ev.requestId);
      if (!r) return 'Permintaan isolasi tidak ditemukan.';
      if (s.placed[ev.requestId]) return 'Pasien sudah ditempatkan.';
      return roomBlock(
        r.precaution,
        s.rooms.find((x) => x.id === ev.roomId),
      );
    }
  }
}

export const ppiDomain = defineDomain<PpiStoreState, PpiEvent>(PPI_DOMAIN, {
  initial: initialPpi,
  eventSchema: ppiEventSchema,
  // Mutu menghitung INM-01 dari observasi kebersihan tangan di sini.
  screens: ['ppi', 'mutu'],
  generic: true,
  validate: (s, ev) => gate(s, ev),
  reduce: (s, ev) => {
    const d = ev.data;
    must(gate(s, d));
    const by = actorRef(ev.actor);
    switch (d.type) {
      case 'suspek.dikonfirmasi': {
        const x = HAI_SUSPECTS.find((h) => h.id === d.id);
        if (!x) return s;
        return {
          ...s,
          month: { ...s.month, [x.type]: { ...s.month[x.type], cases: s.month[x.type].cases + 1 } },
          decisions: { ...s.decisions, [d.id]: { kind: 'hai', when: d.when, by } },
        };
      }
      case 'suspek.ditolak':
        return {
          ...s,
          decisions: { ...s.decisions, [d.id]: { kind: 'bukan', when: d.when, reason: d.reason.trim(), by } },
        };
      case 'sensus.dicatat': {
        const month = { ...s.month };
        for (const t of ['isk', 'vap', 'phlebitis', 'ido'] as const)
          month[t] = { ...s.month[t], denominator: s.month[t].denominator + d.counts[t] };
        return { ...s, month, census: { jam: d.jam, by: by.name } };
      }
      case 'hh.dicatat':
        return {
          ...s,
          handHygiene: [...s.handHygiene, { profession: d.profession, moment: d.moment, action: d.action }],
          hhSession: s.hhSession + 1,
        };
      case 'bundle.diaudit': {
        const a = s.bundleAudits[d.bundleId] ?? { total: 0, compliant: 0 };
        return {
          ...s,
          bundleAudits: {
            ...s.bundleAudits,
            [d.bundleId]: { total: a.total + 1, compliant: a.compliant + (bundleCompliant(d.checks) ? 1 : 0) },
          },
        };
      }
      case 'isolasi.ditempatkan': {
        const r = ISOLATION_REQUESTS.find((x) => x.id === d.requestId);
        const room = s.rooms.find((x) => x.id === d.roomId);
        if (!r || !room) return s;
        return {
          ...s,
          rooms: s.rooms.map((x) => (x.id === room.id ? { ...x, occupiedBy: r.rm } : x)),
          placed: { ...s.placed, [d.requestId]: { room: room.label, jam: d.jam, by: by.name } },
        };
      }
    }
  },
});
