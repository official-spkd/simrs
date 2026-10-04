'use server';

import { z } from 'zod';
import { STAF } from '@/lib/demo/fixtures/staf';
import {
  DENIED,
  invalid,
  type PenunjangActionResult,
  penunjangSession,
  simulated,
} from '@/lib/penunjang-aksi';

/**
 * S01/S09 · Server Action layar Laboratorium (mode presentasi, ADR-0023). Tidak menyimpan apa pun: memvalidasi
 * input dan mengembalikan umpan balik "(simulasi, tidak disimpan)". Pasien skenario dimajukan lewat mesin skenario.
 */

const sampleId = z.string().regex(/^lab-[a-z]{2,20}$/);

export async function validateLabAction(input: {
  sampleId: string;
  level: 'teknis' | 'klinis';
}): Promise<PenunjangActionResult> {
  if (!(await penunjangSession('lab'))) return DENIED;
  const p = z.strictObject({ sampleId, level: z.enum(['teknis', 'klinis']) }).safeParse(input);
  if (!p.success) return invalid('Permintaan validasi tidak dikenal.');
  return simulated(
    p.data.level === 'teknis'
      ? 'Validasi teknis tersimpan'
      : `Validasi klinis ditandatangani (TTE ${STAF.dokterPatologiKlinik}), hasil dirilis`,
  );
}

export async function resampleLabAction(input: {
  sampleId: string;
  cancel: boolean;
}): Promise<PenunjangActionResult> {
  if (!(await penunjangSession('lab'))) return DENIED;
  const p = z.strictObject({ sampleId, cancel: z.boolean() }).safeParse(input);
  if (!p.success) return invalid('Permintaan sampel ulang tidak dikenal.');
  return simulated(
    p.data.cancel ? 'Permintaan sampel ulang dibatalkan' : 'Permintaan sampel ulang dikirim ke ruangan',
  );
}

/**
 * Pelaporan nilai kritis (S09): nama penerima wajib (≥ 5 karakter) dan read-back wajib dikonfirmasi; laporan
 * tanpa read-back tidak sah sehingga ditolak.
 */
export async function reportCriticalAction(input: {
  sampleId: string;
  recipient: string;
  readBack: boolean;
}): Promise<PenunjangActionResult> {
  if (!(await penunjangSession('lab'))) return DENIED;
  const p = z
    .strictObject({ sampleId, recipient: z.string().max(120), readBack: z.boolean() })
    .safeParse(input);
  if (!p.success) return invalid('Laporan nilai kritis tidak dikenal.');
  const recipient = p.data.recipient.trim();
  if (recipient.length < 5) return invalid('Nama penerima wajib diisi (minimal 5 karakter).', 'recipient');
  if (!p.data.readBack) return invalid('Read-back wajib dikonfirmasi sebelum disimpan.', 'readBack');
  return simulated(`Nilai kritis dilaporkan ke ${recipient}, read-back terkonfirmasi`);
}
