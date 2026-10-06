'use server';

import { formatJam, formatTanggalWaktu } from '@simrs/shared';
import { z } from 'zod';
import type { EventOf } from '@/lib/demo/store/registry';
import { tanggalPendek } from '@/lib/keuangan-jurnal';
import {
  BAD_INPUT,
  demoStamp,
  keuanganSession,
  type KeuanganActionResult,
  NOT_YOUR_SCREEN,
} from '@/lib/server/data/keuangan-toko';
import { commitEvent, readDomain } from '@/lib/server/demo/state';

/**
 * U01 · Server Action Tarif & paket (mode presentasi, ADR-0085): ajukan usulan perubahan tarif dan putuskan
 * (manajemen, bukan pembuat usulan menurut id pengguna sesi; penolakan beralasan). Tersimpan di domain toko `tarif`;
 * gerbang usulan (berjenjang, tidak retroaktif, alasan) ditegakkan domain.
 */

const price = z.string().regex(/^[1-9]\d{0,11}$/);
const rev = z.number().int().min(0);
const inputSchema = z.discriminatedUnion('type', [
  z.strictObject({
    type: z.literal('ajukan'),
    itemCode: z.string().regex(/^[A-Z0-9-]{2,20}$/),
    validFrom: z.iso.date(),
    prices: z.strictObject({ k3: price, k2: price, k1: price, vip: price }),
    reason: z.string().trim().min(15).max(500),
    rev,
  }),
  z.strictObject({
    type: z.literal('putuskan'),
    proposalId: z.string().regex(/^[a-z0-9-]{1,40}$/),
    approve: z.boolean(),
    note: z.string().trim().min(10).max(300).nullable(),
    rev,
  }),
]);
export type TarifActionInput = z.infer<typeof inputSchema>;

export async function tarifAction(input: TarifActionInput): Promise<KeuanganActionResult> {
  const s = await keuanganSession('tarif');
  if (!s) return { ok: false, message: NOT_YOUR_SCREEN };
  const parsed = inputSchema.safeParse(input);
  if (!parsed.success) return { ok: false, message: BAD_INPUT };
  const c = parsed.data;
  const at = demoStamp();
  const jam = formatJam(at);
  const commit = async (event: EventOf<'tarif'>, message: string): Promise<KeuanganActionResult> => {
    const r = await commitEvent('tarif', event, { rev: c.rev, session: s });
    return r.ok ? { ok: true, message } : { ok: false, message: r.error, stale: r.stale };
  };
  const { state } = await readDomain('tarif');
  if (c.type === 'ajukan') {
    const number = `UT-2610-${String(state.seq).padStart(3, '0')}`;
    return commit(
      {
        type: 'usulan.ajukan',
        itemCode: c.itemCode,
        validFrom: c.validFrom,
        prices: c.prices,
        reason: c.reason,
        at,
      },
      `Usulan ${number} diajukan · ${formatTanggalWaktu(at)} · oleh ${s.user.displayName} · berlaku mulai ${tanggalPendek(c.validFrom)} setelah disetujui manajemen`,
    );
  }
  const u = state.proposals.find((p) => p.id === c.proposalId);
  if (!u) return { ok: false, message: 'Usulan tidak ditemukan.' };
  const name = state.items.find((i) => i.code === u.itemCode)?.name ?? u.itemCode;
  return commit(
    { type: 'usulan.putuskan', proposalId: u.id, approve: c.approve, note: c.approve ? null : c.note, at },
    c.approve
      ? `${u.number} disetujui · ${jam} · ${name} versi baru terjadwal berlaku ${tanggalPendek(u.validFrom)}; versi berlaku ditutup sehari sebelumnya`
      : `${u.number} ditolak · ${jam} · alasan dikirim ke ${u.maker}`,
  );
}
