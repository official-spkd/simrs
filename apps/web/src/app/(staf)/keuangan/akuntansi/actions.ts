'use server';

import { formatJam } from '@simrs/shared';
import { redirect } from 'next/navigation';
import { z } from 'zod';
import { MAPPING_OPTIONS } from '@/lib/demo/fixtures/keuangan';
import { screenById, screenOpen } from '@/lib/screens';
import { assertDemo } from '@/lib/server/demo-guard';
import { getSession } from '@/lib/server/session';
import { nextLoginStep } from '@/lib/session-view';

/**
 * Server Action Akuntansi mode presentasi (ADR-0023): gerbang demo, sesi lengkap, posisi akuntan, input zod.
 * Tidak menyimpan apa pun. Tutup periode ditolak bila syarat (pemetaan, rekonsiliasi) belum terpenuhi.
 */

export interface AkuntansiActionResult {
  ok: boolean;
  message: string;
  at?: string;
}

const inputSchema = z.discriminatedUnion('type', [
  z.strictObject({
    type: z.literal('petakan'),
    journalId: z.string().regex(/^[a-z0-9-]{1,40}$/),
    accountCode: z.string().regex(/^\d-\d{4}$/),
  }),
  z.strictObject({ type: z.literal('padankan'), accountId: z.string().regex(/^[a-z0-9-]{1,40}$/) }),
  z.strictObject({
    type: z.literal('tutup-periode'),
    periodId: z.string().regex(/^\d{4}-\d{2}$/),
    unmapped: z.number().int().min(0),
    unmatched: z.number().int().min(0),
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
  switch (c.type) {
    case 'petakan': {
      const acc = MAPPING_OPTIONS.find((o) => o.code === c.accountCode);
      if (!acc) return { ok: false, message: 'Akun lawan tidak ada di bagan akun.' };
      return {
        ok: true,
        at,
        message: `Dipetakan ke ${acc.name}; menunggu persetujuan penyetuju kedua · ${at} ${SIM}`,
      };
    }
    case 'padankan':
      return { ok: true, at, message: `Mutasi dipadankan ke batch klaim; jurnal terposting · ${at} ${SIM}` };
    case 'tutup-periode':
      if (c.unmapped > 0 || c.unmatched > 0) {
        return {
          ok: false,
          message: 'Belum bisa ditutup: masih ada jurnal tanpa pemetaan atau selisih bank.',
        };
      }
      return { ok: true, at, message: `Periode ditutup dan jurnal dikunci · ${at} ${SIM}` };
    case 'ekspor':
      return { ok: true, at, message: `Laporan jurnal dan neraca saldo diekspor · ${at} ${SIM}` };
  }
}
