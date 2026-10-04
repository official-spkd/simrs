'use server';

import { consentFinalizeInputSchema, consentRefusalInputSchema, formatJam } from '@simrs/shared';
import { demoActionSession } from '@/lib/server/data/rawat-inap';

/**
 * K11 · Server Action tablet persetujuan tindakan (mode presentasi, ADR-0023): gerbang demo + sesi lengkap +
 * kontrak zod. Tidak menyimpan apa pun.
 */

/** TTE dokter pelaksana: hanya bila 7 butir dipahami, pasien + saksi bertanda tangan, saksi petugas hadir. */
export async function finalizeConsentAction(
  input: unknown,
): Promise<{ ok?: { at: string }; error?: string }> {
  const s = await demoActionSession();
  const parsed = consentFinalizeInputSchema.safeParse(input);
  if (!parsed.success) return { error: 'Lengkapi informasi, tanda tangan, dan saksi sebelum TTE.' };
  if (s.role?.code !== 'dokter') return { error: 'TTE hanya oleh dokter pelaksana (posisi dokter).' };
  return { ok: { at: formatJam(new Date()) } };
}

/** Penolakan tindakan: alasan wajib (kata-kata pasien), tercatat, DPJP diberi notifikasi. */
export async function refuseConsentAction(input: unknown): Promise<{ ok?: { at: string }; error?: string }> {
  await demoActionSession();
  const parsed = consentRefusalInputSchema.safeParse(input);
  if (!parsed.success) return { error: 'Alasan penolakan wajib diisi (minimal 10 karakter).' };
  return { ok: { at: formatJam(new Date()) } };
}
