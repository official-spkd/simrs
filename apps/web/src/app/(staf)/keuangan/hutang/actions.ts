'use server';

import { formatJam, sumRupiah } from '@simrs/shared';
import { z } from 'zod';
import type { EventOf } from '@/lib/demo/store/registry';
import { approvalJournal, paymentJournal } from '@/lib/keuangan-hutang';
import { finalApproval, nextBatchNo } from '@/lib/keuangan-hutang-toko';
import { ringkasJurnal, toAutoJurnal } from '@/lib/keuangan-jurnal';
import {
  BAD_INPUT,
  demoStamp,
  keuanganSession,
  type KeuanganActionResult,
  NOT_YOUR_SCREEN,
  periodLock,
} from '@/lib/server/data/keuangan-toko';
import { commitEvent, readDomain } from '@/lib/server/demo/state';

/**
 * U10 · Server Action Hutang usaha (mode presentasi, ADR-0085): nota kredit/selisih beralasan, verifikasi akuntan,
 * persetujuan berjenjang manajemen (pembuat ≠ penyetuju dari id pengguna sesi), jadwal bayar, dan posting pembayaran.
 * Tersimpan di domain toko `hutang`; jurnal faktur dan pembayaran dihitung server dan mengalir ke Akuntansi.
 */

const id = z.string().regex(/^[a-z0-9-]{1,60}$/);
const rev = z.number().int().min(0);
const inputSchema = z.discriminatedUnion('type', [
  z.strictObject({ type: z.literal('nota-kredit'), invoiceId: id, rev }),
  z.strictObject({
    type: z.literal('selisih'),
    invoiceId: id,
    reason: z.string().trim().min(15).max(300),
    rev,
  }),
  z.strictObject({ type: z.literal('verifikasi'), invoiceId: id, rev }),
  z.strictObject({ type: z.literal('setujui'), invoiceId: id, rev }),
  z.strictObject({ type: z.literal('batch'), invoiceIds: z.array(id).min(1).max(30), rev }),
  z.strictObject({ type: z.literal('bayar'), rev }),
]);
export type HutangActionInput = z.infer<typeof inputSchema>;

export async function hutangAction(input: HutangActionInput): Promise<KeuanganActionResult> {
  const s = await keuanganSession('hutang');
  if (!s) return { ok: false, message: NOT_YOUR_SCREEN };
  const parsed = inputSchema.safeParse(input);
  if (!parsed.success) return { ok: false, message: BAD_INPUT };
  const c = parsed.data;
  const at = demoStamp();
  const jam = formatJam(at);
  const { state } = await readDomain('hutang');
  const commit = async (event: EventOf<'hutang'>, message: string): Promise<KeuanganActionResult> => {
    const r = await commitEvent('hutang', event, { rev: c.rev, session: s });
    return r.ok ? { ok: true, message } : { ok: false, message: r.error, stale: r.stale };
  };
  const f = 'invoiceId' in c ? state.invoices.find((x) => x.id === c.invoiceId) : undefined;
  switch (c.type) {
    case 'nota-kredit':
      return commit(
        { type: 'faktur.nota-kredit', invoiceId: c.invoiceId, at },
        `Nota kredit ${f?.supplier ?? ''} diterima; faktur ${f?.invoiceNo ?? ''} disesuaikan ke nilai penerimaan · ${jam}`,
      );
    case 'selisih':
      return commit(
        { type: 'faktur.selisih', invoiceId: c.invoiceId, reason: c.reason, at },
        `Selisih faktur ${f?.invoiceNo ?? ''} diterima dengan alasan · ${jam}`,
      );
    case 'verifikasi':
      return commit(
        { type: 'faktur.verifikasi', invoiceId: c.invoiceId, at },
        `Faktur ${f?.invoiceNo ?? ''} diverifikasi ${s.user.displayName} · ${jam}`,
      );
    case 'setujui': {
      if (!f) return { ok: false, message: 'Faktur tidak ditemukan.' };
      const final = finalApproval(f);
      if (final) {
        const lock = await periodLock(at);
        if (lock) return { ok: false, message: lock };
      }
      const j = approvalJournal(f);
      return commit(
        {
          type: 'faktur.setujui',
          invoiceId: f.id,
          at,
          jurnal: final
            ? [toAutoJurnal(j, { source: 'logistik', reference: `Hutang · ${f.invoiceNo}` })]
            : [],
        },
        final
          ? `Faktur ${f.invoiceNo} disetujui tingkat ${f.approvals.length + 1} · ${ringkasJurnal(j)} · ${jam}`
          : `Faktur ${f.invoiceNo} disetujui tingkat ${f.approvals.length + 1}; menunggu tingkat 2 · ${jam}`,
      );
    }
    case 'batch':
      return commit(
        { type: 'batch.buat', invoiceIds: c.invoiceIds, at },
        `Batch ${nextBatchNo(state)} dijadwalkan · ${c.invoiceIds.length} faktur · ${jam}`,
      );
    case 'bayar': {
      const b = state.batch;
      if (!b) return { ok: false, message: 'Tidak ada batch pembayaran terbuka.' };
      const lock = await periodLock(at);
      if (lock) return { ok: false, message: lock };
      const total = sumRupiah(state.invoices.filter((x) => b.ids.includes(x.id)).map((x) => x.invoiceAmount));
      const j = paymentJournal(b.number, total);
      return commit(
        {
          type: 'batch.bayar',
          number: b.number,
          at,
          jurnal: [toAutoJurnal(j, { source: 'logistik', reference: `Hutang · ${b.number}` })],
        },
        `${b.number} dibayar ${jam} · ${ringkasJurnal(j)}`,
      );
    }
  }
}
