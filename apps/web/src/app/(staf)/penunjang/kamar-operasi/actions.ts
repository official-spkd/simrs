'use server';

import { CHECKLIST_PHASES } from '@simrs/shared';
import { z } from 'zod';
import { OVERRIDE_REASON_MIN } from '@/lib/btn-ok';
import { btnActionSession } from '@/lib/server/data/btn';

/**
 * S06 · Server Action kamar operasi (mode presentasi, ADR-0023): validasi catatan daftar tilik, insisi, override
 * gerbang time out (alasan wajib), operasi selesai, dan pindah ke ruang pulih. Tidak menyimpan apa pun; versi
 * produksi mencatatnya di rekam medis dan jejak audit.
 */

export interface OkActionResult {
  ok?: true;
  error?: string;
}

const caseId = z.string().regex(/^ok\d-\d$/);
const eventSchema = z.discriminatedUnion('kind', [
  z.strictObject({ kind: z.literal('konfirmasi'), caseId, phase: z.enum(CHECKLIST_PHASES) }),
  z.strictObject({ kind: z.literal('insisi'), caseId }),
  z.strictObject({
    kind: z.literal('override'),
    caseId,
    reason: z
      .string()
      .trim()
      .min(OVERRIDE_REASON_MIN, `Alasan klinis wajib, minimal ${OVERRIDE_REASON_MIN} karakter.`)
      .max(500),
  }),
  z.strictObject({ kind: z.literal('selesai'), caseId }),
  z.strictObject({ kind: z.literal('pulih'), caseId }),
]);
export type OkEventInput = z.infer<typeof eventSchema>;

export async function recordOkEventAction(input: OkEventInput): Promise<OkActionResult> {
  const access = await btnActionSession('ok');
  if ('error' in access) return { error: access.error };
  const parsed = eventSchema.safeParse(input);
  if (!parsed.success) return { error: parsed.error.issues[0]?.message ?? 'Isian tidak sah.' };
  // Mode presentasi: divalidasi lalu dibuang (simulasi, tidak disimpan).
  return { ok: true };
}
