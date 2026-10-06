'use server';

import { z } from 'zod';
import { demoDietOrders } from '@/lib/demo/fixtures/penunjang-gizi';
import {
  DENIED,
  invalid,
  type PenunjangActionResult,
  penunjangSession,
  simulated,
} from '@/lib/penunjang-aksi';
import { deliveryGate, GIZI_GATE_TEXT, mealOf, mstScore } from '@/lib/penunjang-gizi';

/**
 * S07 · Server Action gizi (mode presentasi, ADR-0023). Order diet dicari server dari fixture (klien mengirim id);
 * puasa dan alergi makanan dievaluasi server dari data order, bukan dari kiriman klien. Tidak menyimpan apa pun.
 */

const id = z.string().min(1).max(40);
const meal = z.enum(['pagi', 'siang', 'sore']);

const input = z.discriminatedUnion('kind', [
  z.strictObject({ kind: z.literal('verifikasi'), orderId: id, screened: z.boolean() }),
  z.strictObject({
    kind: z.literal('skrining'),
    orderId: id,
    weightLoss: z.enum(['tidak', 'tidak-yakin', '1-5', '6-10', '11-15', '>15']),
    poorAppetite: z.boolean(),
  }),
  z.strictObject({
    kind: z.literal('antar'),
    orderId: id,
    meal,
    substituted: z.boolean(),
    overrideReason: z.string().max(300).nullable(),
    verified: z.boolean(),
  }),
  z.strictObject({
    kind: z.literal('terima'),
    orderId: id,
    meal,
    leftover: z.union([z.literal(0), z.literal(25), z.literal(50), z.literal(75), z.literal(100)]),
  }),
]);

export async function recordGiziAction(raw: unknown): Promise<PenunjangActionResult> {
  const s = await penunjangSession('gizi');
  if (!s) return DENIED;
  const p = input.safeParse(raw);
  if (!p.success) return invalid('Langkah gizi tidak dikenal.');
  const a = p.data;
  const o = demoDietOrders().find((x) => x.id === a.orderId);
  if (!o) return invalid('Order diet tidak ditemukan.');
  switch (a.kind) {
    case 'verifikasi':
      if (!a.screened && !o.screening) return invalid('Skrining gizi belum dilakukan untuk pasien ini.');
      return simulated(`Order ${o.diet} untuk ${o.patient.name} diverifikasi`);
    case 'skrining': {
      const r = mstScore(a.weightLoss, a.poorAppetite);
      return simulated(
        `Skrining gizi ${o.patient.name}: skor MST ${r.score}${r.atRisk ? ', berisiko malnutrisi · asuhan gizi ≤ 24 jam' : ', tidak berisiko'}`,
      );
    }
    case 'antar': {
      const gate = deliveryGate({ ...o, status: a.verified ? 'diverifikasi' : o.status }, a.meal, {
        substituted: a.substituted,
        overrideReason: a.overrideReason,
      });
      if (gate) return invalid(GIZI_GATE_TEXT[gate]);
      const m = mealOf(o, a.meal, a.substituted);
      return simulated(
        `Baki ${o.patient.name} (${o.ward} ${o.bed}) diantar: ${m.name}${a.substituted ? ' · menu pengganti' : ''}${a.overrideReason ? ' · override alergi tercatat' : ''}`,
      );
    }
    case 'terima':
      return simulated(`Baki ${o.patient.name} diterima, sisa makanan ${a.leftover}%`);
  }
}
