import { z } from 'zod';
import { type ActorRef, actorRef, idSchema, must, whenSchema } from './backoffice-toko';
import { type DemoActor, defineDomain } from './demo/store/define';
import { ASSETS, CALIBRATION_LABS, type RepairTicket, REPAIR_TICKETS, TECHNICIANS } from './demo/fixtures/aset';
import { DEMO_TODAY } from './demo/fixtures/waktu';
import { completionBlock, type Impact, nextCalibration } from './aset';

/**
 * B02 · Domain toko demo `aset` (ADR-0085, CX-3): hasil kalibrasi (laik → jatuh tempo +12 bulan; tidak laik → alat
 * ditarik + tiket otomatis), tiket perbaikan dilaporkan → diterima IPSRS → dikerjakan → selesai diuji → ditutup
 * unit. Penutupan wajib oleh pengguna lain dari teknisi/petugas yang menandai selesai (utang bug 6 Okt: penutupan
 * tiket belum punya pemisahan). Nomor tiket dihitung toko.
 */

export const ASSET_DOMAIN = 'aset';

export const assetEventSchema = z.discriminatedUnion('type', [
  z.strictObject({
    type: z.literal('kalibrasi.dicatat'),
    assetId: idSchema,
    result: z.enum(['laik', 'tidak']),
    cert: z.string().trim().min(5).max(40),
    lab: z.string().min(1).max(120),
    when: whenSchema,
  }),
  z.strictObject({
    type: z.literal('tiket.dilaporkan'),
    assetId: idSchema,
    complaint: z.string().trim().min(10).max(300),
    impact: z.enum(['kritis', 'sedang', 'ringan']),
    when: whenSchema,
  }),
  z.strictObject({ type: z.literal('tiket.diterima'), id: idSchema, technician: z.string().min(1).max(120), when: whenSchema }),
  z.strictObject({ type: z.literal('tiket.dikerjakan'), id: idSchema, when: whenSchema }),
  z.strictObject({
    type: z.literal('tiket.selesai'),
    id: idSchema,
    functionTest: z.boolean(),
    electricalSafety: z.boolean(),
    note: z.string().trim().max(300),
    when: whenSchema,
  }),
  z.strictObject({ type: z.literal('tiket.ditutup'), id: idSchema, when: whenSchema }),
]);
export type AssetEvent = z.infer<typeof assetEventSchema>;

export interface StoredTicket extends Omit<RepairTicket, 'stage'> {
  stage: number;
  at: Partial<Record<number, string>>;
  by: Partial<Record<number, ActorRef>>;
  note: string;
}

export interface AssetStoreState {
  calibration: Record<string, { lastCalibration: string; nextCalibration: string | null; withdrawn: boolean; cert: string; by: string }>;
  tickets: StoredTicket[];
  seq: number;
}

export function initialAssets(): AssetStoreState {
  return {
    calibration: {},
    tickets: REPAIR_TICKETS.map((t) => ({ ...t, at: {}, by: {}, note: '' })),
    seq: 42,
  };
}

export const ticketNumber = (seq: number) => `WO-2610-${String(seq).padStart(3, '0')}`;

function gate(s: AssetStoreState, ev: AssetEvent, actor: DemoActor): string | null {
  switch (ev.type) {
    case 'kalibrasi.dicatat': {
      const a = ASSETS.find((x) => x.id === ev.assetId);
      if (!a || !a.nextCalibration) return 'Aset ini tidak wajib kalibrasi.';
      return (CALIBRATION_LABS as readonly string[]).includes(ev.lab) ? null : 'Lembaga penguji tidak dikenal.';
    }
    case 'tiket.dilaporkan':
      return ASSETS.some((x) => x.id === ev.assetId) ? null : 'Alat tidak ditemukan.';
    default: {
      const t = s.tickets.find((x) => x.id === ev.id);
      if (!t) return 'Tiket tidak ditemukan.';
      const need = { 'tiket.diterima': 0, 'tiket.dikerjakan': 1, 'tiket.selesai': 2, 'tiket.ditutup': 3 }[ev.type];
      if (t.stage !== need) return `${t.number} tidak di tahap ini.`;
      if (ev.type === 'tiket.diterima')
        return (TECHNICIANS as readonly string[]).includes(ev.technician) ? null : 'Teknisi tidak dikenal.';
      if (ev.type === 'tiket.selesai') return completionBlock(ev);
      if (ev.type === 'tiket.ditutup' && t.by[3]?.userId === actor.userId)
        return 'Konfirmasi unit oleh pengguna lain dari petugas yang menyelesaikan perbaikan (pemisahan tugas).';
      return null;
    }
  }
}

function newTicket(
  s: AssetStoreState,
  p: { assetId: string; complaint: string; impact: Impact; reporter: string; when: string },
): StoredTicket {
  const a = ASSETS.find((x) => x.id === p.assetId);
  const number = ticketNumber(s.seq);
  return {
    id: `tkt-${number}`,
    number,
    assetId: p.assetId,
    unit: a?.location ?? '',
    reporter: p.reporter,
    complaint: p.complaint,
    impact: p.impact,
    reportedAt: p.when,
    stage: 0,
    technician: null,
    respondedAt: null,
    at: {},
    by: {},
    note: '',
  };
}

export const assetDomain = defineDomain<AssetStoreState, AssetEvent>(ASSET_DOMAIN, {
  initial: initialAssets,
  eventSchema: assetEventSchema,
  screens: ['aset'],
  generic: true,
  validate: (s, ev, actor) => gate(s, ev, actor),
  reduce: (s, ev) => {
    const d = ev.data;
    must(gate(s, d, ev.actor));
    const by = actorRef(ev.actor);
    switch (d.type) {
      case 'kalibrasi.dicatat': {
        const a = ASSETS.find((x) => x.id === d.assetId);
        if (d.result === 'laik')
          return {
            ...s,
            calibration: {
              ...s.calibration,
              [d.assetId]: { lastCalibration: DEMO_TODAY, nextCalibration: nextCalibration(DEMO_TODAY), withdrawn: false, cert: d.cert.trim(), by: by.name },
            },
          };
        const t = newTicket(s, {
          assetId: d.assetId,
          complaint: `Hasil kalibrasi tidak laik (sertifikat ${d.cert.trim()})`,
          impact: 'sedang',
          reporter: `Hasil kalibrasi (${by.name})`,
          when: d.when,
        });
        return {
          ...s,
          seq: s.seq + 1,
          tickets: [t, ...s.tickets],
          calibration: {
            ...s.calibration,
            [d.assetId]: { lastCalibration: DEMO_TODAY, nextCalibration: a?.nextCalibration ?? null, withdrawn: true, cert: d.cert.trim(), by: by.name },
          },
        };
      }
      case 'tiket.dilaporkan':
        return {
          ...s,
          seq: s.seq + 1,
          tickets: [
            newTicket(s, { assetId: d.assetId, complaint: d.complaint.trim(), impact: d.impact, reporter: by.name, when: d.when }),
            ...s.tickets,
          ],
        };
      default: {
        const stage = { 'tiket.diterima': 1, 'tiket.dikerjakan': 2, 'tiket.selesai': 3, 'tiket.ditutup': 4 }[d.type];
        return {
          ...s,
          tickets: s.tickets.map((t) =>
            t.id !== d.id
              ? t
              : {
                  ...t,
                  stage,
                  at: { ...t.at, [stage]: d.when },
                  by: { ...t.by, [stage]: by },
                  ...(d.type === 'tiket.diterima' ? { technician: d.technician, respondedAt: d.when } : {}),
                  ...(d.type === 'tiket.selesai' ? { note: d.note.trim() } : {}),
                },
          ),
        };
      }
    }
  },
});
