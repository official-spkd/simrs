'use server';

import { dlqResendInputSchema, formatJam } from '@simrs/shared';
import { redirect } from 'next/navigation';
import { DEAD_LETTERS, INTERFACE_NAME } from '@/lib/demo/fixtures/manajemen';
import { assertDemo } from '@/lib/server/demo-guard';
import { getSession } from '@/lib/server/session';
import { nextLoginStep } from '@/lib/session-view';

/**
 * Server Action integration hub (mode presentasi, ADR-0023): gerbang demo, sesi lengkap, input zod. Tidak ada
 * yang disimpan atau dikirim ke sistem luar; produksi kelak memasukkan ulang pesan ke outbox dengan kunci
 * idempotensi yang sama.
 */

export interface ResendResult {
  ok: boolean;
  message: string;
  ids: string[];
}

async function demoSession() {
  assertDemo();
  const s = await getSession();
  if (!s || nextLoginStep(s, false) !== 'selesai') redirect('/masuk');
  return s;
}

export async function resendDeadLettersAction(input: unknown): Promise<ResendResult> {
  await demoSession();
  const parsed = dlqResendInputSchema.safeParse(input);
  if (!parsed.success) return { ok: false, message: 'Pilihan pesan tidak dikenal.', ids: [] };
  const known = new Map(DEAD_LETTERS.map((d) => [d.id, d]));
  const ids = [...new Set(parsed.data.ids)];
  const picked = ids.map((id) => known.get(id));
  if (picked.some((d) => d === undefined)) {
    return { ok: false, message: 'Sebagian pesan sudah tidak ada di antrean. Muat ulang halaman.', ids: [] };
  }
  const targets = [...new Set(picked.flatMap((d) => (d ? [INTERFACE_NAME[d.target]] : [])))].join(', ');
  return {
    ok: true,
    ids,
    message: `${ids.length} pesan dikirim ulang ke ${targets} pukul ${formatJam(new Date())} · diterima tujuan, dikeluarkan dari antrean, dan tercatat di log audit (simulasi, tidak disimpan).`,
  };
}
