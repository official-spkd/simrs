'use server';

import { formatJam, formatRupiah, sumRupiah } from '@simrs/shared';
import { z } from 'zod';
import { BANK_RECON, MAPPING_OPTIONS, STATIC_JOURNALS } from '@/lib/demo/fixtures/keuangan';
import type { EventOf } from '@/lib/demo/store/registry';
import {
  BAD_INPUT,
  demoStamp,
  keuanganSession,
  type KeuanganActionResult,
  NOT_YOUR_SCREEN,
} from '@/lib/server/data/keuangan-toko';
import { commitEvent } from '@/lib/server/demo/state';

/**
 * Server Action Akuntansi mode presentasi (ADR-0023/0085): gerbang demo, sesi lengkap, posisi akuntan, input zod.
 * Pemetaan akun, persetujuan penyetuju kedua, pemadanan mutasi bank, ekspor, dan tutup periode tersimpan di domain
 * toko `akuntansi` atas nama pengguna sesi. Gerbang (pembuat ≠ penyetuju dari id pengguna sesi, syarat tutup periode,
 * periode terkunci) ditegakkan domain di dalam kunci toko; klien hanya mengirim id.
 */

export type AkuntansiActionResult = KeuanganActionResult;

const id = z.string().regex(/^[a-z0-9-]{1,40}$/);
const rev = z.number().int().min(0);
const inputSchema = z.discriminatedUnion('type', [
  z.strictObject({
    type: z.literal('petakan'),
    journalId: id,
    accountCode: z.string().regex(/^\d-\d{4}$/),
    rev,
  }),
  z.strictObject({ type: z.literal('setujui'), journalId: id, rev }),
  z.strictObject({ type: z.literal('padankan'), accountId: id, rev }),
  z.strictObject({ type: z.literal('tutup-periode'), periodId: z.string().regex(/^\d{4}-\d{2}$/), rev }),
  z.strictObject({ type: z.literal('ekspor'), rev }),
]);
export type AkuntansiActionInput = z.infer<typeof inputSchema>;

const numberOf = (journalId: string) => STATIC_JOURNALS.find((j) => j.id === journalId)?.number ?? journalId;

export async function akuntansiAction(input: AkuntansiActionInput): Promise<AkuntansiActionResult> {
  const s = await keuanganSession('akuntansi');
  if (!s) return { ok: false, message: NOT_YOUR_SCREEN };
  const parsed = inputSchema.safeParse(input);
  if (!parsed.success) return { ok: false, message: BAD_INPUT };
  const c = parsed.data;
  const at = demoStamp();
  const jam = formatJam(at);
  const commit = async (event: EventOf<'akuntansi'>, message: string): Promise<AkuntansiActionResult> => {
    const r = await commitEvent('akuntansi', event, { rev: c.rev, session: s });
    return r.ok ? { ok: true, message, rev: r.rev } : { ok: false, message: r.error, stale: r.stale };
  };
  switch (c.type) {
    case 'petakan': {
      const acc = MAPPING_OPTIONS.find((o) => o.code === c.accountCode);
      return commit(
        { type: 'jurnal.petakan', journalId: c.journalId, accountCode: c.accountCode, at },
        `${numberOf(c.journalId)} dipetakan ke ${acc?.name ?? c.accountCode} oleh ${s.user.displayName}; menunggu penyetuju kedua · ${jam}`,
      );
    }
    case 'setujui':
      return commit(
        { type: 'jurnal.setujui', journalId: c.journalId, at },
        `${numberOf(c.journalId)} disetujui ${s.user.displayName} dan terposting · ${jam}`,
      );
    case 'padankan': {
      const acc = BANK_RECON.find((b) => b.id === c.accountId);
      const total = sumRupiah((acc?.unmatched ?? []).map((u) => BigInt(u.amount)));
      return commit(
        { type: 'rekening.padankan', accountId: c.accountId, at },
        `${acc?.unmatched.length ?? 0} mutasi ${formatRupiah(total)} dipadankan ke batch klaim; jurnal terposting · ${jam}`,
      );
    }
    case 'tutup-periode':
      return commit(
        { type: 'periode.tutup', periodId: c.periodId, at },
        `Periode ditutup ${jam} oleh ${s.user.displayName}; jurnal periode ini dikunci`,
      );
    case 'ekspor':
      return commit(
        { type: 'laporan.ekspor', at },
        `Laporan jurnal dan neraca saldo diekspor ${jam} · tercatat di jejak audit`,
      );
  }
}
