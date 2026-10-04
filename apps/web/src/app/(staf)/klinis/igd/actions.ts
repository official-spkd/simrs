'use server';

import { formatJam, triageAssessmentSchema } from '@simrs/shared';
import { demoActionSession } from '@/lib/server/data/rawat-inap';

export interface TriageActionResult {
  ok?: { message: string; at: string };
  error?: string;
}

/**
 * K03 · Simpan triase (mode presentasi, ADR-0023): gerbang demo + sesi lengkap, lalu kontrak zod yang sama
 * dengan API kelak (turun dari saran sistem wajib alasan). Tidak menyimpan apa pun.
 */
export async function saveTriageAction(input: unknown): Promise<TriageActionResult> {
  await demoActionSession();
  const parsed = triageAssessmentSchema.safeParse(input);
  if (!parsed.success) {
    return { error: parsed.error.issues[0]?.message ?? 'Data triase tidak valid.' };
  }
  const t = parsed.data;
  const at = formatJam(new Date());
  const override = t.chosenLevel > t.suggestedLevel ? ' · override beralasan tercatat di jejak audit' : '';
  return {
    ok: {
      at,
      message: `Triase ${t.chosenLevel} tersimpan ${at} · ${t.orders.length} order dikirim${override} (simulasi, tidak disimpan)`,
    },
  };
}
