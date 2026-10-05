'use server';

import { RESUME_CHECK_IDS } from '@simrs/shared';
import { z } from 'zod';
import { wib } from '@/lib/demo/fixtures/rawat-inap';
import { demoNow } from '@/lib/demo/fixtures/waktu';
import { resumeSignTargetBlocker } from '@/lib/rawat-inap';
import { getDischargeSummary } from '@/lib/server/data/klinis/resume';
import { demoActionSession } from '@/lib/server/data/klinis/shared';

const signSchema = z.strictObject({
  encounterId: z.string().min(1).max(60),
  /** Butir kelengkapan yang terpenuhi; TTE hanya bila ke-12 butir ada. */
  done: z.array(z.enum(RESUME_CHECK_IDS)).max(RESUME_CHECK_IDS.length),
  reconciliationConfirmed: z.literal(true),
});

/**
 * K13 · TTE resume medis (mode presentasi, ADR-0023): gerbang demo + sesi lengkap + kontrak; hanya DPJP (posisi
 * dokter), hanya resume yang dikenal, sudah disiapkan, belum final, dan bukan milik pasien skenario (TTE-nya lewat
 * tugas skenario), dan hanya bila 12 butir lengkap. Tidak menyimpan apa pun; setelah final, perubahan lewat addendum.
 */
export async function signResumeAction(
  input: unknown,
): Promise<{ ok?: { at: string; by: string }; error?: string }> {
  const s = await demoActionSession();
  if (s.role?.code !== 'dokter') return { error: 'TTE resume hanya oleh DPJP (posisi dokter).' };
  const parsed = signSchema.safeParse(input);
  if (!parsed.success) return { error: 'Rekonsiliasi obat pulang belum dikonfirmasi DPJP.' };
  const blocked = resumeSignTargetBlocker(await getDischargeSummary(s, parsed.data.encounterId));
  if (blocked) return { error: blocked };
  const missing = RESUME_CHECK_IDS.filter((id) => !parsed.data.done.includes(id));
  if (missing.length) return { error: `Resume belum lengkap: ${missing.length} butir lagi.` };
  return { ok: { at: wib(demoNow()), by: s.user.displayName } };
}
