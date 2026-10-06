'use server';

import { formatJam } from '@simrs/shared';
import { z } from 'zod';
import { demoKemenkesReports } from '@/lib/demo/fixtures/integrasi-kemenkes';
import { applyFix, SEND_BLOCK_TEXT, sendGate } from '@/lib/integrasi-kemenkes';
import { DENIED_MESSAGE, manajemenSession } from '@/lib/manajemen-aksi';

/**
 * I04 · Server Action laporan Kemenkes (mode presentasi, ADR-0023): perbaikan data sumber dan kirim laporan
 * berkonfirmasi. Laporan dicari server dari fixture; validasi bentuk dan idempotensi per periode ditegakkan server.
 */

export interface KemenkesActionResult {
  ok: boolean;
  message: string;
}

const id = z.string().min(1).max(40);
const input = z.discriminatedUnion('kind', [
  z.strictObject({ kind: z.literal('perbaiki'), reportId: id, checkId: id }),
  z.strictObject({
    kind: z.literal('kirim'),
    reportId: id,
    confirmed: z.literal(true),
    fixedChecks: z.array(id).max(20),
  }),
]);

export async function kemenkesAction(raw: unknown): Promise<KemenkesActionResult> {
  if (!(await manajemenSession('kemenkes'))) return { ok: false, message: DENIED_MESSAGE };
  const p = input.safeParse(raw);
  if (!p.success) return { ok: false, message: 'Permintaan tidak dikenal (kirim wajib dikonfirmasi).' };
  const a = p.data;
  const r = demoKemenkesReports().find((x) => x.id === a.reportId);
  if (!r) return { ok: false, message: 'Laporan tidak ditemukan.' };
  const at = formatJam(new Date());
  if (a.kind === 'perbaiki') {
    const c = r.checks.find((x) => x.id === a.checkId);
    if (!c) return { ok: false, message: 'Pemeriksaan tidak dikenal.' };
    return { ok: true, message: `Data sumber dilengkapi: ${c.label} · ${at} (simulasi, tidak disimpan)` };
  }
  const fixed = a.fixedChecks.reduce((acc, c) => applyFix(acc, c), r);
  const gate = sendGate(fixed);
  if (gate) return { ok: false, message: SEND_BLOCK_TEXT[gate] };
  return {
    ok: true,
    message: `${r.name} periode ${r.period} dikirim ${at} → diterima Kemenkes · tercatat di jejak audit (simulasi, tidak disimpan)`,
  };
}
