'use server';

import { formatJam, formatRupiah } from '@simrs/shared';
import { z } from 'zod';
import type { EventOf } from '@/lib/demo/store/registry';
import { captureActions, KOREKSI_REASON_MIN, SUMBER_LABEL } from '@/lib/keuangan-charge';
import { getChargeCaptureStore } from '@/lib/server/data/keuangan-lanjut';
import {
  BAD_INPUT,
  demoStamp,
  keuanganSession,
  type KeuanganActionResult,
  NOT_YOUR_SCREEN,
} from '@/lib/server/data/keuangan-toko';
import { commitEvent } from '@/lib/server/demo/state';

/**
 * U02 · Server Action monitor charge capture (mode presentasi, ADR-0085): permintaan tarif/kelas/koreksi ke unit
 * asal, jawaban admisi (disimulasikan), coba ulang/reprice event tertahan, dan pembatalan baris manual beralasan.
 * Event dicari di jalur data yang sama dengan halaman; gerbang (`captureActions`) diperiksa ulang di server. Baris yang
 * terbentuk masuk ke tagihan berjalan pasien itu di Kasir.
 */

const eventId = z.string().regex(/^[a-z0-9-]{1,40}$/);
const rev = z.number().int().min(0);
const reason = z.string().trim().min(KOREKSI_REASON_MIN).max(300);
const inputSchema = z.discriminatedUnion('type', [
  z.strictObject({ type: z.literal('minta-tarif'), eventId, rev }),
  z.strictObject({ type: z.literal('minta-kelas'), eventId, rev }),
  z.strictObject({ type: z.literal('kelas'), eventId, rev }),
  z.strictObject({ type: z.literal('koreksi'), eventId, reason, rev }),
  z.strictObject({ type: z.literal('selesaikan'), eventId, rev }),
  z.strictObject({ type: z.literal('batal-manual'), eventId, reason, rev }),
]);
export type ChargeActionInput = z.infer<typeof inputSchema>;

export async function chargeAction(input: ChargeActionInput): Promise<KeuanganActionResult> {
  const s = await keuanganSession('charge');
  if (!s) return { ok: false, message: NOT_YOUR_SCREEN };
  const parsed = inputSchema.safeParse(input);
  if (!parsed.success) return { ok: false, message: BAD_INPUT };
  const c = parsed.data;
  const store = await getChargeCaptureStore();
  const e = store.events.find((x) => x.id === c.eventId);
  if (!e) return { ok: false, message: 'Event tidak ditemukan di monitor.' };
  const at = demoStamp();
  const jam = formatJam(at);
  const acts = captureActions(e);
  const commit = async (event: EventOf<'tagihan'>, message: string): Promise<KeuanganActionResult> => {
    const r = await commitEvent('tagihan', event, { rev: c.rev, session: s });
    return r.ok ? { ok: true, message, rev: r.rev } : { ok: false, message: r.error, stale: r.stale };
  };
  switch (c.type) {
    case 'minta-tarif':
      if (e.hold?.kind !== 'tarif-tidak-ada' || e.hold.tariffApprovedAt) {
        return { ok: false, message: 'Event ini tidak menunggu tarif.' };
      }
      return commit(
        { type: 'capture.minta', eventId: e.id, kind: 'tarif', reason: null, at },
        `Permintaan tarif ${e.hold.resolution?.name ?? ''} dikirim ke pengelola tarif · ${jam}`,
      );
    case 'minta-kelas':
      if (e.hold?.kind !== 'kelas-belum-ada')
        return { ok: false, message: 'Event ini tidak menunggu kelas.' };
      return commit(
        { type: 'capture.minta', eventId: e.id, kind: 'kelas', reason: null, at },
        `Permintaan penetapan kelas ${e.patient.name} dikirim ke admisi · ${jam}`,
      );
    case 'kelas':
      if (e.hold?.kind !== 'kelas-belum-ada')
        return { ok: false, message: 'Event ini tidak menunggu kelas.' };
      return commit(
        { type: 'capture.kelas', eventId: e.id, at },
        `Admisi menetapkan kelas rawat ${e.patient.name} · ${jam}; event bisa dicoba ulang`,
      );
    case 'koreksi':
      if (acts.correction) return { ok: false, message: acts.correction };
      return commit(
        { type: 'capture.minta', eventId: e.id, kind: 'koreksi', reason: c.reason, at },
        `Permintaan koreksi dikirim ke ${SUMBER_LABEL[e.source]}; baris tetap sampai unit asal membalik · ${jam}`,
      );
    case 'selesaikan': {
      const kelasOk = e.hold?.kind === 'kelas-belum-ada' && !!e.kelasAt;
      if (acts.retry && !kelasOk) return { ok: false, message: acts.retry };
      const net = e.hold?.reprice
        ? e.hold.reprice.reduce((sum, p) => sum + p.after.amount - p.before.amount, 0n)
        : (e.hold?.resolution?.amount ?? 0n);
      const name = e.hold?.reprice ? 'Selisih tarif penjamin baru' : (e.hold?.resolution?.name ?? '');
      const l = `${name} ${formatRupiah(net)}`;
      return commit(
        { type: 'capture.selesaikan', eventId: e.id, at },
        `${l} masuk tagihan ${e.patient.name} · ${jam}`,
      );
    }
    case 'batal-manual': {
      if (acts.voidManual) return { ok: false, message: acts.voidManual };
      const inv = store.invoiceOf[e.id];
      if (inv && store.lockedInvoices.includes(inv)) {
        return {
          ok: false,
          message: 'Tagihan sudah final di Kasir; koreksi lewat nota kredit, bukan pembatalan baris.',
        };
      }
      return commit(
        { type: 'capture.batal-manual', eventId: e.id, reason: c.reason, at },
        `Baris manual ${e.line?.name ?? ''} dibatalkan dengan baris pembalik · ${jam}`,
      );
    }
  }
}
