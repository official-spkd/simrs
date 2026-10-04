'use server';

import { type CpptRole, cpptNoteInputSchema, emarAdministrationInputSchema, formatJam } from '@simrs/shared';
import { z } from 'zod';
import { wib } from '@/lib/demo/fixtures/rawat-inap';
import { cpptRoleOf } from '@/lib/rawat-inap';
import { demoActionSession } from '@/lib/server/data/rawat-inap';

/**
 * K04/K07 · Server Action rawat inap (mode presentasi, ADR-0023): gerbang demo + sesi lengkap + kontrak zod.
 * Tidak menyimpan apa pun; layar menambah entri secara lokal dengan penanda "(simulasi, tidak disimpan)".
 */

export interface CpptActionResult {
  ok?: { id: string; at: string; author: string; role: CpptRole };
  error?: string;
}

/** CPPT baru atau koreksi (versi baru dengan alasan). Penulis = pengguna yang masuk. */
export async function saveCpptAction(input: unknown): Promise<CpptActionResult> {
  const s = await demoActionSession();
  const parsed = cpptNoteInputSchema.safeParse(input);
  if (!parsed.success) return { error: parsed.error.issues[0]?.message ?? 'CPPT tidak valid.' };
  return {
    ok: {
      id: `cppt-${Date.now().toString(36)}`,
      at: wib(new Date()),
      author: s.user.displayName,
      role: cpptRoleOf(s.role?.code),
    },
  };
}

const cosignSchema = z.strictObject({
  encounterId: z.string().min(1).max(60),
  entryId: z.string().min(1).max(60),
});

/** Co-sign DPJP atas catatan residen: hanya posisi dokter (DPJP). */
export async function cosignCpptAction(
  input: unknown,
): Promise<{ ok?: { by: string; at: string }; error?: string }> {
  const s = await demoActionSession();
  if (!cosignSchema.safeParse(input).success) return { error: 'Permintaan co-sign tidak valid.' };
  if (s.role?.code !== 'dokter') return { error: 'Co-sign hanya oleh DPJP (posisi dokter).' };
  return { ok: { by: s.user.displayName, at: wib(new Date()) } };
}

/** Catat pemberian satu dosis eMAR (gelang cocok, atau override beralasan). */
export async function recordAdministrationAction(
  input: unknown,
): Promise<{ ok?: { at: string }; error?: string }> {
  await demoActionSession();
  const parsed = emarAdministrationInputSchema.safeParse(input);
  if (!parsed.success) return { error: parsed.error.issues[0]?.message ?? 'Pemberian obat tidak valid.' };
  return { ok: { at: formatJam(new Date()) } };
}
