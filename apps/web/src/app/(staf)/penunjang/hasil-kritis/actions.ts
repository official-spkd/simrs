'use server';

import { z } from 'zod';
import {
  DENIED,
  invalid,
  type PenunjangActionResult,
  penunjangSession,
  simulated,
} from '@/lib/penunjang-aksi';
import { reportGate } from '@/lib/penunjang-kritis';
import { findCriticalItem } from '@/lib/server/data/penunjang-lanjut';

/**
 * S09 · Server Action Pusat hasil kritis (mode presentasi, ADR-0023). Klien hanya mengirim id + isian; hasil kritis
 * dicari server dari jalur data halaman. Penerima + peran + saluran + read-back wajib (sama dengan CHECK DB kelak);
 * tidak ada jalan lain menutup hasil kritis. Tidak menyimpan apa pun.
 */

const input = z.strictObject({
  id: z.string().min(1).max(64),
  recipient: z.string().max(120),
  recipientRole: z.string().max(60),
  channel: z.enum(['telepon', 'langsung', '']),
  readBack: z.boolean(),
});

export async function reportCriticalCenterAction(raw: unknown): Promise<PenunjangActionResult> {
  const s = await penunjangSession('kritis');
  if (!s) return DENIED;
  const p = input.safeParse(raw);
  if (!p.success) return invalid('Laporan hasil kritis tidak dikenal.');
  const item = await findCriticalItem(s, p.data.id);
  if (item?.scenario) {
    return invalid('Pasien skenario dilaporkan dari layar Laboratorium agar alur Simulasi ikut maju.');
  }
  const errors = reportGate(item, p.data);
  const first = errors[0];
  if (first) return invalid(first.message, first.field);
  return simulated(
    `Hasil kritis dilaporkan ke ${p.data.recipient.trim()} (${p.data.recipientRole.trim()}), read-back terkonfirmasi`,
  );
}
