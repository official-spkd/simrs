import { z } from 'zod';
import { type DemoActor, defineDomain } from './demo/store/define';
import { TARIF_ITEMS, TARIF_USULAN } from './demo/fixtures/tarif';
import { DEMO_TODAY } from './demo/fixtures/waktu';
import {
  applyApproved,
  approvalProblem,
  type HargaKelas,
  type ItemTarif,
  type UsulanTarif,
  usulanProblems,
} from './keuangan-tarif';

/**
 * U01 · Domain toko demo `tarif` (ADR-0085): usulan perubahan tarif berversi dan keputusannya (mode presentasi).
 * Persetujuan hanya posisi manajemen dan bukan pembuat usulan (id pengguna sesi); versi baru tidak retroaktif dan
 * menutup versi berlaku sehari sebelumnya. Penolakan wajib beralasan.
 */

export const TARIF_DOMAIN = 'tarif';

const stamp = z.iso.datetime({ offset: true });
const price = z.string().regex(/^[1-9]\d{0,11}$/);

export const tarifEventSchema = z.discriminatedUnion('type', [
  z.strictObject({
    type: z.literal('usulan.ajukan'),
    itemCode: z.string().regex(/^[A-Z0-9-]{2,20}$/),
    validFrom: z.iso.date(),
    prices: z.strictObject({ k3: price, k2: price, k1: price, vip: price }),
    reason: z.string().trim().min(15).max(500),
    at: stamp,
  }),
  z.strictObject({
    type: z.literal('usulan.putuskan'),
    proposalId: z.string().regex(/^[a-z0-9-]{1,40}$/),
    approve: z.boolean(),
    note: z.string().trim().min(10).max(300).nullable(),
    at: stamp,
  }),
]);
export type TarifEvent = z.infer<typeof tarifEventSchema>;

export interface StoredUsulan extends UsulanTarif {
  makerId?: string;
}

export interface TarifState {
  items: readonly ItemTarif[];
  proposals: readonly StoredUsulan[];
  seq: number;
}

const toHarga = (p: { k3: string; k2: string; k1: string; vip: string }): HargaKelas => ({
  k3: BigInt(p.k3),
  k2: BigInt(p.k2),
  k1: BigInt(p.k1),
  vip: BigInt(p.vip),
});

function gate(s: TarifState, ev: TarifEvent, actor: DemoActor): string | null {
  if (ev.type === 'usulan.ajukan') {
    const item = s.items.find((i) => i.code === ev.itemCode);
    if (!item) return 'Item tarif tidak ditemukan.';
    if (s.proposals.some((p) => p.itemCode === ev.itemCode && p.status === 'diajukan')) {
      return 'Item ini masih punya usulan yang menunggu persetujuan.';
    }
    const p = usulanProblems(
      item,
      { validFrom: ev.validFrom, prices: toHarga(ev.prices), reason: ev.reason },
      DEMO_TODAY,
    );
    return p.length ? `Belum bisa diajukan: ${p.join(', ')}.` : null;
  }
  const u = s.proposals.find((p) => p.id === ev.proposalId);
  if (!u) return 'Usulan tidak ditemukan.';
  const problem = approvalProblem(u, { name: actor.name, role: actor.role }, DEMO_TODAY);
  if (problem && !problem.startsWith('Pembuat')) return problem;
  const same = u.makerId ? u.makerId === actor.userId : u.maker === actor.name;
  if (same) return 'Pembuat usulan tidak boleh menyetujui usulannya sendiri.';
  if (!ev.approve && !ev.note) return 'Tulis alasan penolakan.';
  return null;
}

export const tarifDomain = defineDomain<TarifState, TarifEvent>(TARIF_DOMAIN, {
  initial: () => ({ items: [...TARIF_ITEMS], proposals: [...TARIF_USULAN], seq: 8 }),
  eventSchema: tarifEventSchema,
  screens: ['tarif'],
  validate: gate,
  reduce: (s, ev) => {
    const d = ev.data;
    const err = gate(s, d, ev.actor);
    if (err) throw new Error(err);
    if (d.type === 'usulan.ajukan') {
      const u: StoredUsulan = {
        id: `ut-${s.seq}`,
        number: `UT-2610-${String(s.seq).padStart(3, '0')}`,
        itemCode: d.itemCode,
        maker: ev.actor.name,
        makerId: ev.actor.userId,
        makerRole: ev.actor.role === 'manajemen' ? 'Manajemen' : 'Akuntan',
        createdAt: d.at,
        status: 'diajukan',
        validFrom: d.validFrom,
        prices: toHarga(d.prices),
        reason: d.reason,
      };
      return { ...s, seq: s.seq + 1, proposals: [u, ...s.proposals] };
    }
    const u = s.proposals.find((p) => p.id === d.proposalId);
    if (!u) return s;
    return {
      ...s,
      proposals: s.proposals.map((p) =>
        p.id === u.id
          ? {
              ...p,
              status: d.approve ? 'disetujui' : 'ditolak',
              decidedBy: ev.actor.name,
              decidedAt: d.at,
              ...(d.note ? { decisionNote: d.note } : {}),
            }
          : p,
      ),
      items: d.approve
        ? s.items.map((i) => (i.code === u.itemCode ? applyApproved(i, u, ev.actor.name, d.at) : i))
        : s.items,
    };
  },
});
