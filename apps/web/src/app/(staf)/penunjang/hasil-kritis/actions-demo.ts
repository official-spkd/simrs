'use server';

import { z } from 'zod';
import { DEMO_NOW } from '@/lib/demo/fixtures/waktu';
import { DENIED, invalid, penunjangSession } from '@/lib/penunjang-aksi';
import {
  type CriticalStoreActionResult,
  MAX_REPORT_DELAY_SECONDS,
  reportedAtFromTimer,
  reportGate,
  SCENARIO_CRITICAL_ELSEWHERE,
  storedFeedback,
} from '@/lib/penunjang-kritis';
import { findCriticalItem } from '@/lib/server/data/penunjang/kritis';
import { commitEvent } from '@/lib/server/demo/state';

/**
 * S09 · Server Action Pusat hasil kritis (mode presentasi, ADR-0023). Klien hanya mengirim id + isian; hasil kritis
 * dicari server dari jalur data halaman. Penerima + peran + saluran + read-back wajib (sama dengan CHECK DB kelak);
 * tidak ada jalan lain menutup hasil kritis. Laporan tersimpan di toko demo bersama (domain `hasil-kritis`,
 * ADR-0085) atas nama pengguna sesi, sehingga tampil juga di layar Laboratorium.
 */

const input = z.strictObject({
  id: z.string().min(1).max(64),
  recipient: z.string().max(120),
  recipientRole: z.string().max(60),
  channel: z.enum(['telepon', 'langsung', '']),
  readBack: z.boolean(),
  rev: z.number().int().min(0),
  /** Timer layar (detik sejak hasil terbit) saat read-back; dibatasi server. */
  elapsedSeconds: z
    .number()
    .int()
    .min(0)
    .max(MAX_REPORT_DELAY_SECONDS * 2),
});

export async function reportCriticalCenterAction(raw: unknown): Promise<CriticalStoreActionResult> {
  const s = await penunjangSession('kritis');
  if (!s) return DENIED;
  const p = input.safeParse(raw);
  if (!p.success) return invalid('Laporan hasil kritis tidak dikenal.');
  const item = await findCriticalItem(s, p.data.id);
  if (item?.scenario) return invalid(SCENARIO_CRITICAL_ELSEWHERE);
  const errors = reportGate(item, p.data);
  const first = errors[0];
  if (first || !item || p.data.channel === '') {
    return invalid(first?.message ?? 'Pilih saluran pelaporan.', first?.field ?? 'channel');
  }
  const recipient = p.data.recipient.trim();
  const recipientRole = p.data.recipientRole.trim();
  const reportedAt = reportedAtFromTimer(item.raisedAt, DEMO_NOW, p.data.elapsedSeconds);
  const r = await commitEvent(
    'hasil-kritis',
    {
      type: 'laporan.dicatat',
      itemId: item.id,
      recipient,
      recipientRole,
      channel: p.data.channel,
      reportedAt,
      via: 'pusat',
    },
    { rev: p.data.rev, session: s },
  );
  if (!r.ok) return { ok: false, message: r.error, stale: r.stale };
  return storedFeedback(
    `Hasil kritis dilaporkan ke ${recipient} (${recipientRole}), read-back terkonfirmasi`,
    reportedAt,
  );
}
