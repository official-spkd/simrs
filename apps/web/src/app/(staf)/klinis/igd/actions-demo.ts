'use server';

import { formatJam, triageAssessmentSchema } from '@simrs/shared';
import { demoNow } from '@/lib/demo/fixtures/waktu';
import { canTriage, TRIAGE_ROLE_REASON, triageBlocker, triageNeedsReason } from '@/lib/rawat-inap';
import { getEdItem } from '@/lib/server/data/klinis/igd';
import { demoActionSession } from '@/lib/server/data/klinis/shared';

export interface TriageActionResult {
  ok?: { at: string; orders: number; override: boolean };
  error?: string;
}

/**
 * K03 · Simpan triase (mode presentasi, ADR-0023): gerbang demo + sesi lengkap + posisi perawat/dokter, lalu
 * kontrak zod yang sama dengan API kelak. Saran sistem dan batas protokol dibaca dari data IGD server (pasien
 * datang sendiri: bawaan server), bukan dari klien; pasien skenario ditriase lewat langkah skenario. Tidak
 * menyimpan apa pun.
 */
export async function saveTriageAction(input: unknown): Promise<TriageActionResult> {
  const s = await demoActionSession();
  if (!canTriage(s.role?.code)) return { error: `${TRIAGE_ROLE_REASON}.` };
  const parsed = triageAssessmentSchema.safeParse(input);
  if (!parsed.success) {
    return { error: parsed.error.issues[0]?.message ?? 'Data triase tidak valid.' };
  }
  const t = parsed.data;
  const item = await getEdItem(s, t.encounterId);
  if (!item) return { error: 'Pasien IGD tidak dikenal.' };
  if (item.scenario) return { error: 'Triase pasien simulasi dicatat lewat langkah skenario.' };
  const blocked = triageBlocker(item, t.chosenLevel, t.overrideReason ?? '');
  if (blocked) return { error: blocked };
  return {
    ok: {
      at: formatJam(demoNow()),
      orders: t.orders.length,
      override: triageNeedsReason(item.suggestedLevel, t.chosenLevel),
    },
  };
}
