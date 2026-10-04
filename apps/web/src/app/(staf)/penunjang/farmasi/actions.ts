'use server';

import { z } from 'zod';
import { APOTEKER_JAGA } from '@/lib/demo/fixtures/penunjang';
import {
  DENIED,
  invalid,
  type PenunjangActionResult,
  penunjangSession,
  simulated,
} from '@/lib/penunjang-aksi';
import { secondPharmacistError } from '@/lib/penunjang-farmasi';

/**
 * S04/S05 · Server Action layar Farmasi (mode presentasi, ADR-0023). Tidak menyimpan apa pun; gerbang keselamatan
 * (override CDS wajib alasan, cek ganda high alert oleh apoteker kedua) tetap ditegakkan di sini.
 */

const rxId = z.string().regex(/^rx-[a-z]{2,20}$/);

const REVIEW_TEXT = {
  setujui: 'Resep lolos telaah dan masuk antrean penyiapan',
  tahan: 'Resep ditahan sampai dokter merespons',
  lepas: 'Tahanan resep dilepas',
  sebagian: 'Obat tanpa masalah disiapkan sebagian',
} as const;

export async function reviewRxAction(input: {
  rxId: string;
  decision: keyof typeof REVIEW_TEXT;
}): Promise<PenunjangActionResult> {
  if (!(await penunjangSession('farmasi'))) return DENIED;
  const p = z
    .strictObject({ rxId, decision: z.enum(['setujui', 'tahan', 'lepas', 'sebagian']) })
    .safeParse(input);
  if (!p.success) return invalid('Keputusan telaah tidak dikenal.');
  return simulated(REVIEW_TEXT[p.data.decision]);
}

const FOLLOW_UP_TEXT = {
  usul: 'Usulan terkirim ke dokter penulis resep',
  setuju: 'Dokter menyetujui usulan apoteker',
  konfirmasi: 'Dosis dikonfirmasi sesuai fungsi ginjal',
  override: 'Override apoteker tercatat dengan alasan klinis',
} as const;

/** Tindak lanjut peringatan CDS: override hanya dengan alasan klinis tertulis (≥ 10 karakter). */
export async function cdsFollowUpAction(input: {
  rxId: string;
  alertId: string;
  action: keyof typeof FOLLOW_UP_TEXT;
  reason?: string;
}): Promise<PenunjangActionResult> {
  if (!(await penunjangSession('farmasi'))) return DENIED;
  const p = z
    .strictObject({
      rxId,
      alertId: z.string().regex(/^[a-z0-9-]{3,40}$/),
      action: z.enum(['usul', 'setuju', 'konfirmasi', 'override']),
      reason: z.string().max(500).optional(),
    })
    .safeParse(input);
  if (!p.success) return invalid('Tindak lanjut CDS tidak dikenal.');
  if (p.data.action === 'override' && (p.data.reason ?? '').trim().length < 10) {
    return invalid('Alasan klinis wajib diisi, minimal 10 karakter.', 'reason');
  }
  return simulated(FOLLOW_UP_TEXT[p.data.action]);
}

/** Cek ganda obat high alert: apoteker kedua yang bertugas dan bukan apoteker penyiap. */
export async function doubleCheckAction(input: {
  rxId: string;
  second: string;
}): Promise<PenunjangActionResult> {
  const s = await penunjangSession('farmasi');
  if (!s) return DENIED;
  const p = z.strictObject({ rxId, second: z.string().max(120) }).safeParse(input);
  if (!p.success) return invalid('Cek ganda tidak dikenal.');
  const error = secondPharmacistError(p.data.second, s.user.displayName, APOTEKER_JAGA);
  if (error) return invalid(error, 'second');
  return simulated(`Cek ganda high alert oleh ${p.data.second}`);
}

export async function prepareRxAction(input: { rxId: string }): Promise<PenunjangActionResult> {
  if (!(await penunjangSession('farmasi'))) return DENIED;
  if (!z.strictObject({ rxId }).safeParse(input).success) return invalid('Resep tidak dikenal.');
  return simulated('Obat selesai disiapkan, etiket aturan pakai tercetak');
}

const RECEIVER = { pasien: 'pasien', keluarga: 'keluarga pasien', perawat: 'perawat ruangan' } as const;

export async function dispenseRxAction(input: {
  rxId: string;
  receiver: keyof typeof RECEIVER;
}): Promise<PenunjangActionResult> {
  if (!(await penunjangSession('farmasi'))) return DENIED;
  const p = z.strictObject({ rxId, receiver: z.enum(['pasien', 'keluarga', 'perawat']) }).safeParse(input);
  if (!p.success) return invalid('Penerima obat tidak dikenal.');
  return simulated(
    `Obat diserahkan ke ${RECEIVER[p.data.receiver]}; stok depo berkurang, tercatat di eMAR dan billing`,
  );
}
