'use server';

import { bedAllocationInputSchema, formatJam } from '@simrs/shared';
import { demoActionSession } from '@/lib/server/data/klinis/shared';

export interface BedActionResult {
  ok?: { at: string };
  error?: string;
}

/**
 * K05 · Alokasi bed untuk permintaan (mode presentasi, ADR-0023): gerbang demo + sesi lengkap + kontrak zod.
 * Tidak menyimpan apa pun; layar menampilkan bed "Dipesan" secara lokal.
 */
export async function allocateBedAction(input: unknown): Promise<BedActionResult> {
  await demoActionSession();
  const parsed = bedAllocationInputSchema.safeParse(input);
  if (!parsed.success) return { error: 'Permintaan alokasi tidak valid.' };
  return { ok: { at: formatJam(new Date()) } };
}
