'use server';

import { formatJam, formatRupiah, sumRupiah } from '@simrs/shared';
import { redirect } from 'next/navigation';
import { z } from 'zod';
import { needsMapping, periodCloseCheck } from '@/lib/keuangan-akuntansi';
import { screenById, screenOpen } from '@/lib/screens';
import { getAccountingBoard } from '@/lib/server/data/keuangan';
import { assertDemo } from '@/lib/server/demo-guard';
import { getSession } from '@/lib/server/session';
import { nextLoginStep } from '@/lib/session-view';

/**
 * Server Action Akuntansi mode presentasi (ADR-0023): gerbang demo, sesi lengkap, posisi akuntan, input zod.
 * Tidak menyimpan apa pun. Jurnal, rekening, dan syarat tutup periode diperiksa terhadap papan versi server
 * (jalur data yang sama dengan halaman): klien hanya mengirim id yang sudah dipetakan/dipadankan, bukan hitungan.
 */

export interface AkuntansiActionResult {
  ok: boolean;
  message: string;
  at?: string;
}

const id = z.string().regex(/^[a-z0-9-]{1,40}$/);
const inputSchema = z.discriminatedUnion('type', [
  z.strictObject({
    type: z.literal('petakan'),
    journalId: id,
    accountCode: z.string().regex(/^\d-\d{4}$/),
  }),
  z.strictObject({ type: z.literal('padankan'), accountId: id }),
  z.strictObject({
    type: z.literal('tutup-periode'),
    periodId: z.string().regex(/^\d{4}-\d{2}$/),
    /** Jurnal yang sudah dipetakan di layar (menunggu penyetuju kedua). */
    mappedJournalIds: z.array(id).max(50),
    /** Rekening yang mutasinya sudah dipadankan di layar. */
    matchedAccountIds: z.array(id).max(20),
  }),
  z.strictObject({ type: z.literal('ekspor') }),
]);
export type AkuntansiActionInput = z.infer<typeof inputSchema>;

async function akuntanSession() {
  assertDemo();
  const s = await getSession();
  if (!s || nextLoginStep(s, false) !== 'selesai') redirect('/masuk');
  const screen = screenById('akuntansi');
  return screen && screenOpen(screen, { dataSource: 'demo', role: s.role?.code ?? null }) ? s : null;
}

const SIM = '(simulasi, tidak disimpan)';

export async function akuntansiAction(input: AkuntansiActionInput): Promise<AkuntansiActionResult> {
  const s = await akuntanSession();
  if (!s) return { ok: false, message: 'Posisi aktif bukan akuntan. Ganti posisi untuk memakai layar ini.' };
  const parsed = inputSchema.safeParse(input);
  if (!parsed.success)
    return { ok: false, message: 'Perintah akuntansi tidak dikenal atau isian tidak sah.' };
  const c = parsed.data;
  const at = formatJam(new Date());
  if (c.type === 'ekspor') {
    return { ok: true, at, message: `Laporan jurnal dan neraca saldo diekspor · ${at} ${SIM}` };
  }
  const board = await getAccountingBoard(s);
  switch (c.type) {
    case 'petakan': {
      const journal = board.journals.find((j) => j.id === c.journalId);
      if (!journal || !needsMapping(journal)) {
        return { ok: false, message: 'Jurnal tidak ditemukan atau tidak perlu pemetaan akun.' };
      }
      const acc = board.mappingOptions.find((o) => o.code === c.accountCode);
      if (!acc) return { ok: false, message: 'Akun lawan tidak ada di bagan akun.' };
      return {
        ok: true,
        at,
        message: `${journal.number} dipetakan ke ${acc.name}; menunggu persetujuan penyetuju kedua · ${at} ${SIM}`,
      };
    }
    case 'padankan': {
      const account = board.bankRecon.find((b) => b.id === c.accountId);
      if (!account || account.unmatched.length === 0) {
        return { ok: false, message: 'Tidak ada mutasi yang perlu dipadankan di rekening ini.' };
      }
      const total = sumRupiah(account.unmatched.map((u) => BigInt(u.amount)));
      return {
        ok: true,
        at,
        message: `${account.unmatched.length} mutasi ${formatRupiah(total)} dipadankan ke batch klaim; jurnal terposting · ${at} ${SIM}`,
      };
    }
    case 'tutup-periode': {
      if (c.periodId !== board.period.id || board.period.status !== 'terbuka') {
        return { ok: false, message: 'Periode tidak sesuai atau sudah ditutup.' };
      }
      const check = periodCloseCheck(board, c);
      if (!check.ready) return { ok: false, message: check.reason };
      return {
        ok: true,
        at,
        message: `Periode ${board.period.label} ditutup dan jurnal dikunci · ${at} ${SIM}`,
      };
    }
  }
}
