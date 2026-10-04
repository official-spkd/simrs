'use server';

import { RESUME_CHECK_IDS } from '@simrs/shared';
import { z } from 'zod';
import { wib } from '@/lib/demo/fixtures/rawat-inap';
import { demoActionSession } from '@/lib/server/data/rawat-inap';

const signSchema = z.strictObject({
  encounterId: z.string().min(1).max(60),
  /** Butir kelengkapan yang terpenuhi; TTE hanya bila ke-12 butir ada. */
  done: z.array(z.enum(RESUME_CHECK_IDS)).max(RESUME_CHECK_IDS.length),
  reconciliationConfirmed: z.literal(true),
});

/**
 * K13 · TTE resume medis (mode presentasi, ADR-0023): gerbang demo + sesi lengkap + kontrak; hanya DPJP (posisi
 * dokter) dan hanya bila 12 butir lengkap. Tidak menyimpan apa pun; setelah final, perubahan lewat addendum.
 */
export async function signResumeAction(
  input: unknown,
): Promise<{ ok?: { at: string; by: string }; error?: string }> {
  const s = await demoActionSession();
  const parsed = signSchema.safeParse(input);
  if (!parsed.success) return { error: 'Rekonsiliasi obat pulang belum dikonfirmasi DPJP.' };
  const missing = RESUME_CHECK_IDS.filter((id) => !parsed.data.done.includes(id));
  if (missing.length) return { error: `Resume belum lengkap: ${missing.length} butir lagi.` };
  if (s.role?.code !== 'dokter') return { error: 'TTE resume hanya oleh DPJP (posisi dokter).' };
  return { ok: { at: wib(new Date()), by: s.user.displayName } };
}
