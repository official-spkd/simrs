'use server';

import { consentFinalizeInputSchema, consentRefusalInputSchema, formatJam } from '@simrs/shared';
import { consentFinalizeBlocker, SCENARIO_CONSENT_WAIT } from '@/lib/rawat-inap';
import {
  demoActionSession,
  encounterClock,
  getConsentDocument,
  scenarioSteps,
} from '@/lib/server/data/rawat-inap';

/**
 * K11 · Server Action tablet persetujuan tindakan (mode presentasi, ADR-0023): gerbang demo + sesi lengkap +
 * kontrak zod, lalu aturan diperiksa terhadap dokumen yang dibaca server (status, butir informasi, nama penanda
 * tangan). Tidak menyimpan apa pun.
 */

/**
 * TTE dokter pelaksana: hanya atas dokumen draf, ketujuh butir dipahami (himpunan persis), tanda tangan pasien dan
 * saksi atas nama yang tercantum, saksi petugas hadir. Persetujuan Tn. Hartono hanya pada giliran tugasnya.
 */
export async function finalizeConsentAction(
  input: unknown,
): Promise<{ ok?: { at: string }; error?: string }> {
  const s = await demoActionSession();
  if (s.role?.code !== 'dokter') return { error: 'TTE hanya oleh dokter pelaksana (posisi dokter).' };
  const parsed = consentFinalizeInputSchema.safeParse(input);
  if (!parsed.success) return { error: 'Lengkapi informasi, tanda tangan, dan saksi sebelum TTE.' };
  const doc = await getConsentDocument(s, parsed.data.consentId);
  if (!doc) return { error: 'Dokumen persetujuan tidak dikenal.' };
  const blocked = consentFinalizeBlocker(doc, parsed.data);
  if (blocked) return { error: blocked };
  if (doc.id === 'pk-hartono') {
    const [tl] = await scenarioSteps(s, [['igd-ranap', 'tata-laksana']]);
    if (!tl?.tasks.consent?.enabled) return { error: SCENARIO_CONSENT_WAIT };
  }
  return { ok: { at: formatJam(await encounterClock(s, doc.encounterId)) } };
}

/** Penolakan tindakan atas dokumen draf: alasan wajib (kata-kata pasien), tercatat, DPJP diberi notifikasi. */
export async function refuseConsentAction(input: unknown): Promise<{ ok?: { at: string }; error?: string }> {
  const s = await demoActionSession();
  const parsed = consentRefusalInputSchema.safeParse(input);
  if (!parsed.success) return { error: 'Alasan penolakan wajib diisi (minimal 10 karakter).' };
  const doc = await getConsentDocument(s, parsed.data.consentId);
  if (!doc) return { error: 'Dokumen persetujuan tidak dikenal.' };
  if (doc.status !== 'draf') return { error: 'Dokumen sudah final; penolakan tidak bisa dicatat.' };
  return { ok: { at: formatJam(await encounterClock(s, doc.encounterId)) } };
}
