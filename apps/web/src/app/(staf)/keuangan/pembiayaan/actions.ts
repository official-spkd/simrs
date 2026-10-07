'use server';

import { formatJam, formatRupiah, INSTALMENT_STAGES, isoDateJakarta } from '@simrs/shared';
import { z } from 'zod';
import {
  canReject,
  drawdownRequestError,
  INSTALMENT_FLOW,
  nextInstalmentStage,
  REJECT_REASON_MIN,
} from '@/lib/btn-pembiayaan';
import {
  bpjsPaymentFor,
  bpjsRepaymentJournals,
  disbursementJournal,
  nextDrawdownId,
} from '@/lib/btn-pembiayaan-toko';
import type { EventOf } from '@/lib/demo/store/registry';
import { btnActionSession, getFinancingOverview } from '@/lib/server/data/btn';
import { demoStamp, periodLock } from '@/lib/server/data/keuangan-toko';
import { commitEvent } from '@/lib/server/demo/state';

/**
 * U04 · Server Action layar pembiayaan BTN (mode presentasi, ADR-0023/0085): pengajuan pencairan piutang, keputusan
 * BTN (disimulasikan), pencairan + pembayaran BPJS (jurnal otomatis), dan tahap cicilan pasien (penolakan wajib
 * beralasan). Tersimpan di domain toko `pembiayaan-btn` atas nama pengguna sesi; batch, advance, dan pelunasan dihitung
 * server dari data yang sama dengan halaman.
 */

export interface FinancingActionResult {
  ok?: true;
  error?: string;
  message?: string;
  stale?: boolean;
  /** Revisi toko setelah aksi berhasil; aksi berikutnya memakainya (`useStoreAction`). */
  rev?: number;
}

const id = z.string().regex(/^[A-Za-z0-9-]{1,60}$/);
const rev = z.number().int().min(0);
const eventSchema = z.discriminatedUnion('kind', [
  z.strictObject({
    kind: z.literal('ajukan-pencairan'),
    batchIds: z.array(id).min(1, 'Pilih minimal satu batch layak bayar.').max(20),
    principal: z.string().regex(/^[1-9]\d{0,15}$/),
    rev,
  }),
  z.strictObject({ kind: z.literal('pencairan-lanjut'), drawdownId: id, rev }),
  z.strictObject({ kind: z.literal('bayar-bpjs'), drawdownId: id, rev }),
  z.strictObject({
    kind: z.literal('cicilan-lanjut'),
    applicationId: id,
    stage: z.enum(INSTALMENT_STAGES),
    rev,
  }),
  z.strictObject({
    kind: z.literal('cicilan-tolak'),
    applicationId: id,
    reason: z
      .string()
      .trim()
      .min(REJECT_REASON_MIN, `Alasan penolakan wajib, minimal ${REJECT_REASON_MIN} karakter.`)
      .max(300),
    rev,
  }),
]);
export type FinancingEventInput = z.infer<typeof eventSchema>;

export async function recordFinancingEventAction(input: FinancingEventInput): Promise<FinancingActionResult> {
  const access = await btnActionSession('pembiayaan');
  if ('error' in access) return { error: access.error };
  const s = access.session;
  const parsed = eventSchema.safeParse(input);
  if (!parsed.success) return { error: parsed.error.issues[0]?.message ?? 'Isian tidak sah.' };
  const e = parsed.data;
  const at = demoStamp();
  const { data, state } = await getFinancingOverview(s);
  const commit = async (
    event: EventOf<'pembiayaan-btn'>,
    message: string,
  ): Promise<FinancingActionResult> => {
    const r = await commitEvent('pembiayaan-btn', event, { rev: e.rev, session: s });
    return r.ok
      ? { ok: true, message: `${message} · ${formatJam(at)}`, rev: r.rev }
      : { error: r.error, stale: r.stale };
  };
  const basisOf = (batchIds: readonly string[]) =>
    data.pool
      .filter((b) => batchIds.includes(b.id))
      .map((b) => `${b.period.replace(' 2026', '')} ${b.kind}`)
      .join(', ');
  switch (e.kind) {
    case 'ajukan-pencairan': {
      const err = drawdownRequestError(data, e.batchIds, BigInt(e.principal), isoDateJakarta(data.asOf));
      if (err) return { error: err };
      return commit(
        { type: 'pencairan.ajukan', batchIds: e.batchIds, principal: e.principal, at },
        `Pengajuan ${nextDrawdownId(state)} ${formatRupiah(BigInt(e.principal))} dikirim ke BTN oleh ${s.user.displayName}`,
      );
    }
    case 'pencairan-lanjut': {
      const d = data.drawdowns.find((x) => x.id === e.drawdownId);
      if (!d || (d.stage !== 'diajukan' && d.stage !== 'disetujui'))
        return { error: 'Pengajuan tidak ditemukan.' };
      const cair = d.stage === 'disetujui';
      if (cair) {
        const lock = await periodLock(at);
        if (lock) return { error: lock };
      }
      return commit(
        { type: 'pencairan.lanjut', drawdownId: d.id, at, jurnal: cair ? [disbursementJournal(d)] : [] },
        cair ? `${d.id} dicairkan ke rekening operasional · jurnal terbentuk` : `${d.id} disetujui BTN`,
      );
    }
    case 'bayar-bpjs': {
      const p = bpjsPaymentFor(data, e.drawdownId);
      if (!p) return { error: 'Hanya pencairan yang sudah cair yang bisa dilunasi BPJS.' };
      const lock = await periodLock(at);
      if (lock) return { error: lock };
      return commit(
        {
          type: 'bpjs.bayar',
          drawdownId: p.drawdown.id,
          claims: p.pay.claims.toString(),
          principal: p.pay.principal.toString(),
          margin: p.pay.margin.toString(),
          forwarded: p.pay.forwarded.toString(),
          days: p.pay.days,
          basis: basisOf(p.drawdown.batchIds) || p.drawdown.id,
          at,
          jurnal: bpjsRepaymentJournals(p.drawdown, p.pay, p.inpatient),
        },
        `BPJS membayar klaim dasar ${p.drawdown.id} · auto-debit pokok + margin · jurnal terbentuk`,
      );
    }
    case 'cicilan-lanjut':
    case 'cicilan-tolak': {
      const app = data.applications.find((a) => a.id === e.applicationId);
      if (!app) return { error: 'Pengajuan cicilan tidak ditemukan.' };
      if (app.scenario) return { error: 'Cicilan pasien skenario mengikuti Simulasi.' };
      if (e.kind === 'cicilan-tolak') {
        if (!canReject(app)) return { error: 'Pengajuan ini sudah diputuskan BTN.' };
        return commit(
          { type: 'cicilan.tolak', applicationId: app.id, reason: e.reason, at },
          `${app.reference} ditolak BTN · alasan tercatat`,
        );
      }
      if (app.stage !== e.stage || !nextInstalmentStage(app.stage) || INSTALMENT_FLOW.indexOf(e.stage) < 0) {
        return { error: 'Tahap cicilan tidak sah; muat ulang.', stale: true };
      }
      return commit(
        { type: 'cicilan.lanjut', applicationId: app.id, stage: e.stage, at },
        `${app.reference}: tahap berikutnya`,
      );
    }
  }
}
