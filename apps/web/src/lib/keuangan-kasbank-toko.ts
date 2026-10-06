import { z } from 'zod';
import { defineDomain, on } from './demo/store/define';
import { LACI, MUTASI_BANK } from './demo/fixtures/kas-bank';
import { autoJurnalSchema, type DrafJurnal, jurnal } from './keuangan-jurnal';
import {
  candidateFits,
  closeProblems,
  expectedCash,
  type Laci,
  type MutasiBank,
  PENGECUALIAN_NOTE_MIN,
} from './keuangan-kasbank';
import { tagihanDomain } from './keuangan-tagihan-toko';

/**
 * U09 · Domain toko demo `kas-bank` (ADR-0085): laci kasir dan mutasi rekening BTN (mode presentasi).
 *
 * - Langganan `tagihan` · `tagihan.bayar` tunai: pembayaran tunai di Kasir masuk transaksi laci loket 1 (laci yang
 *   sama dengan shift Kasir).
 * - Tutup laci (hitung fisik, selisih beralasan, saksi supervisor bila di atas ambang), buka laci, padanan mutasi,
 *   pengecualian bercatatan, dan lepas padanan (jurnal balik) tersimpan atas nama pengguna sesi; setiap mutasi uang
 *   membawa jurnal otomatis seimbang ke Akuntansi.
 */

export const KASBANK_DOMAIN = 'kas-bank';

const stamp = z.iso.datetime({ offset: true });
const id = z.string().regex(/^[a-z0-9-]{1,40}$/);

export const kasbankEventSchema = z.discriminatedUnion('type', [
  z.strictObject({
    type: z.literal('laci.tutup'),
    drawerId: id,
    physical: z.string().regex(/^\d{1,12}$/),
    reason: z.string().trim().min(15).max(300).nullable(),
    witnessed: z.boolean(),
    at: stamp,
    jurnal: z.array(autoJurnalSchema).length(1),
  }),
  z.strictObject({ type: z.literal('laci.buka'), drawerId: id, at: stamp }),
  z.strictObject({
    type: z.literal('mutasi.padan'),
    mutationId: id,
    candidateId: id,
    at: stamp,
    jurnal: z.array(autoJurnalSchema).length(1),
  }),
  z.strictObject({
    type: z.literal('mutasi.pengecualian'),
    mutationId: id,
    note: z.string().trim().min(PENGECUALIAN_NOTE_MIN).max(300),
    at: stamp,
    jurnal: z.array(autoJurnalSchema).length(1),
  }),
  z.strictObject({
    type: z.literal('mutasi.lepas'),
    mutationId: id,
    reason: z.string().trim().min(PENGECUALIAN_NOTE_MIN).max(300),
    at: stamp,
    jurnal: z.array(autoJurnalSchema).max(1),
  }),
]);
export type KasbankEvent = z.infer<typeof kasbankEventSchema>;

export interface KasbankState {
  drawers: readonly Laci[];
  mutations: readonly MutasiBank[];
  /** Jurnal terakhir per laci/mutasi (tampilan jurnal berpasangan). */
  journals: Readonly<Record<string, DrafJurnal>>;
  /** Jejak siapa (pengguna sesi) per laci/mutasi. */
  by: Readonly<Record<string, string>>;
  depositSeq: number;
}

/** Jurnal otomatis berstring → draf bigint (tampilan). */
function toDraf(j: {
  memo: string;
  lines: Array<{ code: string; name: string; debit: string; credit: string }>;
}): DrafJurnal {
  return jurnal(
    j.memo,
    j.lines.map((l) => ({
      account: { code: l.code, name: l.name },
      debit: BigInt(l.debit),
      credit: BigInt(l.credit),
    })),
  );
}

function gate(s: KasbankState, ev: KasbankEvent): string | null {
  switch (ev.type) {
    case 'laci.tutup': {
      const d = s.drawers.find((x) => x.id === ev.drawerId);
      if (!d || d.status !== 'buka') return 'Laci tidak terbuka.';
      const p = closeProblems(BigInt(ev.physical), expectedCash(d), ev.reason ?? '', ev.witnessed, d.float);
      return p.length ? `Belum bisa ditutup: ${p.join(', ')}.` : null;
    }
    case 'laci.buka': {
      const d = s.drawers.find((x) => x.id === ev.drawerId);
      return d && d.status === 'tutup' ? null : 'Laci sudah terbuka.';
    }
    case 'mutasi.padan':
    case 'mutasi.pengecualian': {
      const m = s.mutations.find((x) => x.id === ev.mutationId);
      if (!m) return 'Mutasi tidak ditemukan.';
      if (m.status !== 'belum') return 'Mutasi ini sudah dipadankan atau dikecualikan.';
      if (ev.type === 'mutasi.padan') {
        const c = m.candidates.find((x) => x.id === ev.candidateId);
        if (!c || !candidateFits(m, c)) return 'Dokumen padanan tidak cocok dengan nominal mutasi.';
      }
      return null;
    }
    case 'mutasi.lepas': {
      const m = s.mutations.find((x) => x.id === ev.mutationId);
      return m && m.status !== 'belum' ? null : 'Mutasi belum dipadankan.';
    }
  }
}

export const kasbankDomain = defineDomain<KasbankState, KasbankEvent>(KASBANK_DOMAIN, {
  initial: () => ({
    drawers: LACI.map((d) => ({ ...d, transactions: [...d.transactions] })),
    mutations: MUTASI_BANK.map((m) => ({ ...m, candidates: [...m.candidates] })),
    journals: {},
    by: {},
    depositSeq: 413,
  }),
  eventSchema: kasbankEventSchema,
  screens: ['kas-bank'],
  validate: (s, ev) => gate(s, ev),
  reduce: (s, ev) => {
    const d = ev.data;
    const err = gate(s, d);
    if (err) throw new Error(err);
    const who = ev.actor.name;
    switch (d.type) {
      case 'laci.tutup': {
        const physical = BigInt(d.physical);
        return {
          ...s,
          depositSeq: s.depositSeq + 1,
          drawers: s.drawers.map((x) =>
            x.id === d.drawerId
              ? {
                  ...x,
                  status: 'tutup',
                  lastClose: { at: d.at, physical, expected: expectedCash(x), reason: d.reason },
                }
              : x,
          ),
          journals: d.jurnal[0] ? { ...s.journals, [d.drawerId]: toDraf(d.jurnal[0]) } : s.journals,
          by: { ...s.by, [d.drawerId]: `ditutup ${who}${d.witnessed ? ' · disaksikan supervisor' : ''}` },
        };
      }
      case 'laci.buka':
        return {
          ...s,
          drawers: s.drawers.map((x) =>
            x.id === d.drawerId ? { ...x, status: 'buka', openedAt: d.at, transactions: [] } : x,
          ),
          by: { ...s.by, [d.drawerId]: `dibuka ${who}` },
        };
      case 'mutasi.padan': {
        const m = s.mutations.find((x) => x.id === d.mutationId);
        const c = m?.candidates.find((x) => x.id === d.candidateId);
        return {
          ...s,
          mutations: s.mutations.map((x) =>
            x.id === d.mutationId ? { ...x, status: 'cocok', matchedTo: c?.label ?? null } : x,
          ),
          journals: d.jurnal[0] ? { ...s.journals, [d.mutationId]: toDraf(d.jurnal[0]) } : s.journals,
          by: { ...s.by, [d.mutationId]: `dipadankan ${who}` },
        };
      }
      case 'mutasi.pengecualian':
        return {
          ...s,
          mutations: s.mutations.map((x) =>
            x.id === d.mutationId ? { ...x, status: 'pengecualian', note: d.note } : x,
          ),
          journals: d.jurnal[0] ? { ...s.journals, [d.mutationId]: toDraf(d.jurnal[0]) } : s.journals,
          by: { ...s.by, [d.mutationId]: `dikecualikan ${who}` },
        };
      case 'mutasi.lepas': {
        const journals = { ...s.journals };
        delete journals[d.mutationId];
        return {
          ...s,
          mutations: s.mutations.map((x) =>
            x.id === d.mutationId ? { ...x, status: 'belum', matchedTo: null, note: null } : x,
          ),
          journals,
          by: { ...s.by, [d.mutationId]: `padanan dilepas ${who}: ${d.reason}` },
        };
      }
    }
  },
  subscriptions: [
    on(tagihanDomain, (s, ev) => {
      const d = ev.data;
      if (d.type !== 'tagihan.bayar' || d.method !== 'tunai') return s;
      const first = s.drawers[0];
      if (!first || first.transactions.some((t) => t.id === `kasir-${ev.seq}`)) return s;
      return {
        ...s,
        drawers: s.drawers.map((x, i) =>
          i === 0
            ? {
                ...x,
                transactions: [
                  ...x.transactions,
                  {
                    id: `kasir-${ev.seq}`,
                    at: d.at,
                    label: `${d.invoiceNo} · tunai (Kasir)`,
                    amount: BigInt(d.amount),
                  },
                ],
              }
            : x,
        ),
      };
    }),
  ],
});
