'use server';

import { formatJam, triageAssessmentSchema } from '@simrs/shared';
import { demoActionSession } from '@/lib/server/data/rawat-inap';

export interface TriageActionResult {
  ok?: { at: string; orders: number; override: boolean };
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
  return {
    ok: {
      at: formatJam(new Date()),
      orders: t.orders.length,
      override: t.chosenLevel > t.suggestedLevel,
    },
  };
}
