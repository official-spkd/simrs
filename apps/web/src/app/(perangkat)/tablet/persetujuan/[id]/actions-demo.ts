'use server';

import { consentFinalizeInputSchema, consentRefusalInputSchema, formatJam } from '@simrs/shared';
import { z } from 'zod';
import { patientById } from '@/lib/demo/fixtures/pasien';
import { wib } from '@/lib/demo/fixtures/rawat-inap';
import { consentFinalizeBlocker, consentRefusalBlocker } from '@/lib/rawat-inap';
import { consentTurn, getConsentDocument } from '@/lib/server/data/klinis/consent';
import { committed, rekamFail, type RekamActionResult } from '@/lib/server/data/klinis/rekam';
import { demoActionSession, encounterClock } from '@/lib/server/data/klinis/shared';
import { commitEvent } from '@/lib/server/demo/state';

/**
 * K11 · Server Action tablet persetujuan tindakan (mode presentasi, ADR-0023): gerbang demo + sesi lengkap +
 * kontrak zod, lalu aturan diperiksa terhadap dokumen yang dibaca server (status, butir informasi, nama penanda
 * tangan) dan giliran skenario dokumen itu. Dokumen pasien fixture tersimpan di toko demo (`persetujuan`, ADR-0085):
 * `consent.final` mengalir ke kamar operasi dan kelengkapan RM. Dokumen milik skenario dicatat lewat tugas Simulasi.
 */

const revSchema = z.int().min(0);

export interface ConsentActionResult extends RekamActionResult {
  at?: string;
  /** Dokumen milik skenario: tugas Simulasi yang mencatatnya (tidak ke toko). */
  scenario?: boolean;
}

/**
 * TTE dokter pelaksana: hanya atas dokumen draf, ketujuh butir dipahami (himpunan persis), tanda tangan pasien dan
 * saksi atas nama yang tercantum, saksi petugas hadir. Dokumen milik skenario hanya pada giliran tugasnya.
 */
export async function finalizeConsentAction(input: unknown, rev: unknown): Promise<ConsentActionResult> {
  const s = await demoActionSession();
  if (s.role?.code !== 'dokter') return rekamFail('TTE hanya oleh dokter pelaksana (posisi dokter).');
  const parsed = consentFinalizeInputSchema.safeParse(input);
  const r = revSchema.safeParse(rev);
  if (!parsed.success || !r.success)
    return rekamFail('Lengkapi informasi, tanda tangan, dan saksi sebelum TTE.');
  const doc = await getConsentDocument(s, parsed.data.consentId);
  if (!doc) return rekamFail('Dokumen persetujuan tidak dikenal.');
  const blocked = consentFinalizeBlocker(doc, parsed.data) ?? (await consentTurn(s, doc)).wait;
  if (blocked) return rekamFail(blocked);
  const clock = await encounterClock(s, doc.encounterId);
  const at = formatJam(clock);
  if (patientById(doc.patientId)?.scenario)
    return { ok: true, message: 'Dokumen siap final.', at, scenario: true };
  const c = await commitEvent(
    'persetujuan',
    {
      type: 'consent.final',
      consentId: doc.id,
      encounterId: doc.encounterId,
      patientId: doc.patientId,
      procedure: doc.procedure,
      doctor: doc.doctor,
      patient: parsed.data.patient,
      witness: parsed.data.witness,
      staffWitness: doc.staffWitness,
      finalAt: wib(clock),
    },
    { rev: r.data, session: s },
  );
  return committed(c, { ok: true, message: 'Dokumen final.', at });
}

/**
 * Penolakan tindakan atas dokumen draf: alasan wajib (kata-kata pasien), tercatat, DPJP diberi notifikasi. Dokumen
 * milik skenario hanya pada giliran tugasnya (alur skenario tidak bercabang ke penolakan di luar giliran).
 */
export async function refuseConsentAction(input: unknown, rev: unknown): Promise<ConsentActionResult> {
  const s = await demoActionSession();
  const parsed = consentRefusalInputSchema.safeParse(input);
  const r = revSchema.safeParse(rev);
  if (!parsed.success || !r.success) return rekamFail('Alasan penolakan wajib diisi (minimal 10 karakter).');
  const doc = await getConsentDocument(s, parsed.data.consentId);
  if (!doc) return rekamFail('Dokumen persetujuan tidak dikenal.');
  const blocked = consentRefusalBlocker(doc) ?? (await consentTurn(s, doc)).wait;
  if (blocked) return rekamFail(blocked);
  const clock = await encounterClock(s, doc.encounterId);
  const at = formatJam(clock);
  if (patientById(doc.patientId)?.scenario) {
    return rekamFail('Penolakan dokumen pasien simulasi tidak tersedia di alur skenario.');
  }
  const c = await commitEvent(
    'persetujuan',
    {
      type: 'consent.ditolak',
      consentId: doc.id,
      encounterId: doc.encounterId,
      patientId: doc.patientId,
      procedure: doc.procedure,
      reason: parsed.data.reason,
      at: wib(clock),
    },
    { rev: r.data, session: s },
  );
  return committed(c, { ok: true, message: 'Penolakan tercatat.', at });
}
