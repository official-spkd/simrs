'use server';

import { z } from 'zod';
import { ANESTESIOLOG } from '@/lib/demo/fixtures/penunjang-anestesi';
import {
  ASA_CLASSES,
  INDUCTION_BLOCK_TEXT,
  preAnesthesiaMissing,
  vitalsWarnings,
} from '@/lib/penunjang-anestesi';
import {
  DENIED,
  invalid,
  type PenunjangActionResult,
  penunjangSession,
  simulated,
} from '@/lib/penunjang-aksi';

/**
 * S06 · Server Action anestesi (mode presentasi, ADR-0023): asesmen pra-anestesi lengkap sebelum TTE, induksi hanya
 * setelah asesmen ber-TTE dan sign in WHO, monitoring intraoperasi dalam rentang fisiologis. Tidak menyimpan apa pun.
 */

const caseId = z.string().regex(/^ok\d-\d$/);
const pre = z.strictObject({
  asa: z.enum(ASA_CLASSES).nullable(),
  emergency: z.boolean(),
  fastingSince: z.string().max(10),
  airway: z.string().max(40),
  plan: z.string().max(500),
  consent: z.boolean(),
});

const input = z.discriminatedUnion('kind', [
  z.strictObject({ kind: z.literal('tte'), caseId, pre }),
  z.strictObject({
    kind: z.literal('induksi'),
    caseId,
    preSigned: z.boolean(),
    signInConfirmed: z.boolean(),
  }),
  z.strictObject({
    kind: z.literal('ttv'),
    caseId,
    vitals: z.strictObject({
      systolic: z.number().int().min(30).max(260),
      diastolic: z.number().int().min(10).max(160),
      pulse: z.number().int().min(20).max(250),
      spo2: z.number().int().min(50).max(100),
      etco2: z.number().int().min(5).max(90),
    }),
  }),
]);

export async function recordAnesthesiaAction(raw: unknown): Promise<PenunjangActionResult> {
  const s = await penunjangSession('ok');
  if (!s) return DENIED;
  const p = input.safeParse(raw);
  if (!p.success) return invalid('Catatan anestesi tidak dikenal.');
  const a = p.data;
  switch (a.kind) {
    case 'tte': {
      const missing = preAnesthesiaMissing({ ...a.pre, signed: null });
      if (missing.length) return invalid(`Asesmen pra-anestesi belum lengkap: ${missing.join(', ')}.`);
      return simulated(`Asesmen pra-anestesi ditandatangani (TTE ${ANESTESIOLOG})`);
    }
    case 'induksi':
      if (!a.preSigned) return invalid(INDUCTION_BLOCK_TEXT.PRE_ANESTHESIA);
      if (!a.signInConfirmed) return invalid(INDUCTION_BLOCK_TEXT.SIGN_IN);
      return simulated('Induksi anestesi dicatat');
    case 'ttv': {
      const w = vitalsWarnings(a.vitals);
      return simulated(`Tanda vital intraoperasi dicatat${w.length ? ` · perhatian: ${w.join(', ')}` : ''}`);
    }
  }
}
