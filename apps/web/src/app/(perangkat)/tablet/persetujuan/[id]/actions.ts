'use server';

import { consentFinalizeInputSchema, consentRefusalInputSchema, formatJam } from '@simrs/shared';
import { consentFinalizeBlocker, consentRefusalBlocker } from '@/lib/rawat-inap';
import {
  consentTurn,
  demoActionSession,
  encounterClock,
  getConsentDocument,
} from '@/lib/server/data/rawat-inap';

/**
 * K11 · Server Action tablet persetujuan tindakan (mode presentasi, ADR-0023): gerbang demo + sesi lengkap +
 * kontrak zod, lalu aturan diperiksa terhadap dokumen yang dibaca server (status, butir informasi, nama penanda
 * tangan) dan giliran skenario dokumen itu. Tidak menyimpan apa pun.
 */

/**
 * TTE dokter pelaksana: hanya atas dokumen draf, ketujuh butir dipahami (himpunan persis), tanda tangan pasien dan
 * saksi atas nama yang tercantum, saksi petugas hadir. Dokumen milik skenario hanya pada giliran tugasnya.
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
  const blocked = consentFinalizeBlocker(doc, parsed.data) ?? (await consentTurn(s, doc)).wait;
  if (blocked) return { error: blocked };
  return { ok: { at: formatJam(await encounterClock(s, doc.encounterId)) } };
}

/**
 * Penolakan tindakan atas dokumen draf: alasan wajib (kata-kata pasien), tercatat, DPJP diberi notifikasi. Dokumen
 * milik skenario hanya pada giliran tugasnya (alur skenario tidak bercabang ke penolakan di luar giliran).
 */
export async function refuseConsentAction(input: unknown): Promise<{ ok?: { at: string }; error?: string }> {
  const s = await demoActionSession();
  const parsed = consentRefusalInputSchema.safeParse(input);
  if (!parsed.success) return { error: 'Alasan penolakan wajib diisi (minimal 10 karakter).' };
  const doc = await getConsentDocument(s, parsed.data.consentId);
  if (!doc) return { error: 'Dokumen persetujuan tidak dikenal.' };
  const blocked = consentRefusalBlocker(doc) ?? (await consentTurn(s, doc)).wait;
  if (blocked) return { error: blocked };
  return { ok: { at: formatJam(await encounterClock(s, doc.encounterId)) } };
}
