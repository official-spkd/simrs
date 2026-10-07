'use server';

import { formatJam, formatRupiah } from '@simrs/shared';
import { z } from 'zod';
import type { EventOf } from '@/lib/demo/store/registry';
import {
  closeJournal,
  exceptionJournal,
  expectedCash,
  matchJournal,
  PENGECUALIAN_NOTE_MIN,
  reverseJournal,
} from '@/lib/keuangan-kasbank';
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
 * U09 · Server Action Kas & bank (mode presentasi, ADR-0085): tutup/buka laci, padanan mutasi, pengecualian, dan
 * lepas padanan tersimpan di domain toko `kas-bank` atas nama pengguna sesi. Selisih kas, setoran, dan jurnal dihitung
 * server dari laci/mutasi versi server; mutasi bertanggal periode tertutup ditolak.
 */

const id = z.string().regex(/^[a-z0-9-]{1,40}$/);
const rev = z.number().int().min(0);
const note = z.string().trim().min(PENGECUALIAN_NOTE_MIN).max(300);
const inputSchema = z.discriminatedUnion('type', [
  z.strictObject({
    type: z.literal('tutup'),
    drawerId: id,
    physical: z.string().regex(/^\d{1,12}$/),
    reason: z.string().trim().max(300).nullable(),
    witnessed: z.boolean(),
    rev,
  }),
  z.strictObject({ type: z.literal('buka'), drawerId: id, rev }),
  z.strictObject({ type: z.literal('padan'), mutationId: id, candidateId: id, rev }),
  z.strictObject({ type: z.literal('pengecualian'), mutationId: id, note, rev }),
  z.strictObject({ type: z.literal('lepas'), mutationId: id, reason: note, rev }),
]);
export type KasBankActionInput = z.infer<typeof inputSchema>;

const STATEMENT = 'BTN ••••4417';

export async function kasBankAction(input: KasBankActionInput): Promise<KeuanganActionResult> {
  const s = await keuanganSession('kas-bank');
  if (!s) return { ok: false, message: NOT_YOUR_SCREEN };
  const parsed = inputSchema.safeParse(input);
  if (!parsed.success) return { ok: false, message: BAD_INPUT };
  const c = parsed.data;
  const at = demoStamp();
  const jam = formatJam(at);
  const { state } = await readDomain('kas-bank');
  const commit = async (event: EventOf<'kas-bank'>, message: string): Promise<KeuanganActionResult> => {
    const r = await commitEvent('kas-bank', event, { rev: c.rev, session: s });
    return r.ok ? { ok: true, message, rev: r.rev } : { ok: false, message: r.error, stale: r.stale };
  };
  const ref = (reference: string) => ({ source: 'kasir' as const, reference });
  if (c.type !== 'buka') {
    const lock = await periodLock(at);
    if (lock) return { ok: false, message: lock };
  }
  switch (c.type) {
    case 'tutup': {
      const d = state.drawers.find((x) => x.id === c.drawerId);
      if (!d) return { ok: false, message: 'Laci tidak ditemukan.' };
      const physical = BigInt(c.physical);
      const expected = expectedCash(d);
      const j = closeJournal(d.counter, physical, expected, d.float);
      const no = `STR-2610-${String(state.depositSeq).padStart(4, '0')}`;
      return commit(
        {
          type: 'laci.tutup',
          drawerId: d.id,
          physical: c.physical,
          reason: physical === expected ? null : (c.reason ?? '').trim() || null,
          witnessed: c.witnessed,
          at,
          jurnal: [toAutoJurnal(j, ref(`Kas · ${no}`))],
        },
        `Laci ${d.counter} ditutup ${jam} · setoran ${no} ${formatRupiah(physical - d.float)} ke ${STATEMENT} · ${ringkasJurnal(j)}`,
      );
    }
    case 'buka': {
      const d = state.drawers.find((x) => x.id === c.drawerId);
      return commit(
        { type: 'laci.buka', drawerId: c.drawerId, at },
        `Laci ${d?.counter ?? ''} dibuka ${jam} dengan modal ${formatRupiah(d?.float ?? 0n)} (dihitung dua orang)`,
      );
    }
    case 'padan': {
      const m = state.mutations.find((x) => x.id === c.mutationId);
      const cand = m?.candidates.find((x) => x.id === c.candidateId);
      if (!m || !cand) return { ok: false, message: 'Mutasi atau dokumen padanan tidak ditemukan.' };
      const mLock = await periodLock(m.at);
      if (mLock) return { ok: false, message: mLock };
      const j = matchJournal(m, cand);
      return commit(
        {
          type: 'mutasi.padan',
          mutationId: m.id,
          candidateId: cand.id,
          at,
          jurnal: [toAutoJurnal(j, ref(`Bank · ${m.description}`))],
        },
        `${m.description} dipadankan ke ${cand.label} · ${jam} · ${ringkasJurnal(j)}`,
      );
    }
    case 'pengecualian': {
      const m = state.mutations.find((x) => x.id === c.mutationId);
      if (!m) return { ok: false, message: 'Mutasi tidak ditemukan.' };
      const mLock = await periodLock(m.at);
      if (mLock) return { ok: false, message: mLock };
      const j = exceptionJournal(m);
      return commit(
        {
          type: 'mutasi.pengecualian',
          mutationId: m.id,
          note: c.note,
          at,
          jurnal: [toAutoJurnal(j, ref(`Bank · ${m.description}`))],
        },
        `${m.description} dicatat sebagai pengecualian · ${jam} · ${ringkasJurnal(j)}`,
      );
    }
    case 'lepas': {
      const m = state.mutations.find((x) => x.id === c.mutationId);
      if (!m) return { ok: false, message: 'Mutasi tidak ditemukan.' };
      const mLock = await periodLock(m.at);
      if (mLock) return { ok: false, message: mLock };
      const prev = state.journals[m.id];
      const back = prev ? reverseJournal(prev, `Jurnal balik ${m.description}`) : null;
      return commit(
        {
          type: 'mutasi.lepas',
          mutationId: m.id,
          reason: c.reason,
          at,
          jurnal: back ? [toAutoJurnal(back, ref(`Bank · ${m.description}`))] : [],
        },
        `Padanan ${m.description} dilepas · ${jam} · alasan: ${c.reason}${back ? ` · jurnal balik ${ringkasJurnal(back)}` : ''}`,
      );
    }
  }
}
