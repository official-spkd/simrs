'use server';

import { formatJam } from '@simrs/shared';
import { redirect } from 'next/navigation';
import { z } from 'zod';
import { screenById, screenOpen } from '@/lib/screens';
import { assertDemo } from '@/lib/server/demo-guard';
import { getSession } from '@/lib/server/session';
import { nextLoginStep } from '@/lib/session-view';

/**
 * Server Action Klaim mode presentasi (ADR-0023): gerbang demo, sesi lengkap, posisi koder, input zod. Tidak
 * menyimpan apa pun. Klaim pasien skenario dimajukan lewat mesin skenario (`demoCommandAction`).
 */

export interface KlaimActionResult {
  ok: boolean;
  message: string;
  at?: string;
}

const claimId = z.string().regex(/^[a-z0-9-]{1,40}$/);
const inputSchema = z.discriminatedUnion('type', [
  z.strictObject({ type: z.literal('kirim'), claimId }),
  z.strictObject({ type: z.literal('tanggapan'), claimId }),
  z.strictObject({ type: z.literal('banding'), claimId }),
  z.strictObject({ type: z.literal('query'), claimId }),
  z.strictObject({
    type: z.literal('terima-saran'),
    claimId,
    code: z.string().regex(/^[A-Z]\d{2}(\.\d{1,2})?$/),
  }),
  z.strictObject({
    type: z.literal('alasan-bukti'),
    claimId,
    reason: z.string().trim().min(10).max(500),
  }),
]);
export type KlaimActionInput = z.infer<typeof inputSchema>;

async function koderSession() {
  assertDemo();
  const s = await getSession();
  if (!s || nextLoginStep(s, false) !== 'selesai') redirect('/masuk');
  const screen = screenById('klaim');
  return screen && screenOpen(screen, { dataSource: 'demo', role: s.role?.code ?? null }) ? s : null;
}

const SIM = '(simulasi, tidak disimpan)';

export async function klaimAction(input: KlaimActionInput): Promise<KlaimActionResult> {
  const s = await koderSession();
  if (!s) return { ok: false, message: 'Posisi aktif bukan koder. Ganti posisi untuk memakai layar ini.' };
  const parsed = inputSchema.safeParse(input);
  if (!parsed.success) return { ok: false, message: 'Perintah klaim tidak dikenal atau isian tidak sah.' };
  const c = parsed.data;
  const at = formatJam(new Date());
  const messages: Record<KlaimActionInput['type'], string> = {
    kirim: `Grouping final dan terkirim ke E-Klaim · ${at} ${SIM}`,
    tanggapan: `Tanggapan dan berkas tambahan terkirim ke verifikator · ${at} ${SIM}`,
    banding: `Penyelesaian dispute diajukan · ${at} ${SIM}`,
    query: `Query koder terkirim ke DPJP · ${at} ${SIM}`,
    'terima-saran': `Saran koding diterima, grouper dihitung ulang · ${at} ${SIM}`,
    'alasan-bukti': `Alasan ketidaksesuaian kode tercatat dan dapat ditinjau · ${at} ${SIM}`,
  };
  return { ok: true, at, message: messages[c.type] };
}
