'use server';

import { formatJam } from '@simrs/shared';
import { z } from 'zod';
import { ATURAN_JASPEL, TINDAKAN_JASPEL } from '@/lib/demo/fixtures/jaspel';
import type { EventOf } from '@/lib/demo/store/registry';
import { accrualJournal, paymentJournal, rekap, TAHAP_JASPEL } from '@/lib/keuangan-jaspel';
import { nextStage } from '@/lib/keuangan-jaspel-toko';
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
 * U08 · Server Action Jasa pelayanan (mode presentasi, ADR-0085): majukan tahap rekap (gerbang posisi + pemverifikasi ≠
 * penyetuju dari id pengguna sesi) dan ekspor CSV, tersimpan di domain toko `jasa-pelayanan`. Jurnal akrual/bayar
 * dihitung server dari rekap yang sama dengan halaman.
 */

const inputSchema = z.discriminatedUnion('type', [
  z.strictObject({ type: z.literal('maju'), rev: z.number().int().min(0) }),
  z.strictObject({ type: z.literal('ekspor'), rev: z.number().int().min(0) }),
]);
export type JaspelActionInput = z.infer<typeof inputSchema>;

const PERIOD = 'Oktober 2026';

export async function jaspelAction(input: JaspelActionInput): Promise<KeuanganActionResult> {
  const s = await keuanganSession('jaspel');
  if (!s) return { ok: false, message: NOT_YOUR_SCREEN };
  const parsed = inputSchema.safeParse(input);
  if (!parsed.success) return { ok: false, message: BAD_INPUT };
  const c = parsed.data;
  const at = demoStamp();
  const jam = formatJam(at);
  const commit = async (event: EventOf<'jasa-pelayanan'>, message: string): Promise<KeuanganActionResult> => {
    const r = await commitEvent('jasa-pelayanan', event, { rev: c.rev, session: s });
    return r.ok ? { ok: true, message } : { ok: false, message: r.error, stale: r.stale };
  };
  if (c.type === 'ekspor') {
    return commit(
      { type: 'rekap.ekspor', at },
      `Ekspor CSV rekap jasa Oktober disiapkan · ${jam} · tercatat di jejak audit`,
    );
  }
  const { state } = await readDomain('jasa-pelayanan');
  const next = nextStage(state.stage);
  if (!next) return { ok: false, message: 'Rekap sudah dibayar.' };
  const r = rekap(TINDAKAN_JASPEL, ATURAN_JASPEL);
  const j =
    next === 'disetujui' ? accrualJournal(r, PERIOD) : next === 'dibayar' ? paymentJournal(r, PERIOD) : null;
  if (j) {
    const lock = await periodLock(at);
    if (lock) return { ok: false, message: lock };
  }
  const label = TAHAP_JASPEL.find((t) => t.id === next)?.label.toLowerCase() ?? next;
  return commit(
    {
      type: 'tahap.maju',
      from: state.stage,
      at,
      jurnal: j ? [toAutoJurnal(j, { source: 'klaim', reference: `Jasa pelayanan · ${PERIOD}` })] : [],
    },
    `Rekap jasa Oktober ${label} oleh ${s.user.displayName} · ${jam}${j ? ` · ${ringkasJurnal(j)}` : ''}`,
  );
}
