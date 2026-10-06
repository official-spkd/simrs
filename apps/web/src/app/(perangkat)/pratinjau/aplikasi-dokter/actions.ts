'use server';

import { z } from 'zod';
import { DEMO_NOW } from '@/lib/demo/fixtures/waktu';
import { DENIED_MESSAGE, manajemenSession } from '@/lib/manajemen-aksi';
import { APP_READBACK_ROLE, readbackMatches } from '@/lib/manajemen-aplikasi';
import { MAX_REPORT_DELAY_SECONDS, reportedAtFromTimer, SCENARIO_CRITICAL_ELSEWHERE } from '@/lib/penunjang-kritis';
import { findCriticalItem } from '@/lib/server/data/penunjang-lanjut';
import { commitEvent } from '@/lib/server/demo/state';

/**
 * I08 · Read-back nilai kritis dari aplikasi dokter (mode presentasi, ADR-0023/0085). Hasil kritis dicari server di
 * Pusat hasil kritis; dokter (posisi Dokter/residen) mengetik nilai yang dibacakan ulang, server mencocokkan dengan
 * nilai laporan, lalu mencatat kejadian `hasil-kritis/laporan.dicatat` atas nama pengguna sesi (penerima = dokter
 * itu, saluran telepon). Pasien skenario tetap lewat tugas Simulasi.
 */

export interface ReadbackResult {
  ok: boolean;
  message: string;
  stale?: boolean;
}

const READBACK_ROLES = ['dokter', 'dokter_residen'];

const input = z.strictObject({
  id: z.string().min(1).max(64),
  value: z.string().max(60),
  rev: z.number().int().min(0),
  elapsedSeconds: z
    .number()
    .int()
    .min(0)
    .max(MAX_REPORT_DELAY_SECONDS * 2),
});

export async function readbackCriticalAction(raw: unknown): Promise<ReadbackResult> {
  const s = await manajemenSession('app-dokter');
  if (!s) return { ok: false, message: DENIED_MESSAGE };
  if (!READBACK_ROLES.includes(s.role?.code ?? ''))
    return { ok: false, message: 'Read-back nilai kritis oleh dokter (posisi Dokter atau Dokter residen).' };
  const p = input.safeParse(raw);
  if (!p.success) return { ok: false, message: 'Read-back tidak dikenali.' };
  const item = await findCriticalItem(s, p.data.id);
  if (!item) return { ok: false, message: 'Hasil kritis tidak ditemukan.' };
  if (item.scenario) return { ok: false, message: SCENARIO_CRITICAL_ELSEWHERE };
  if (item.report) return { ok: false, message: 'Hasil kritis ini sudah dilaporkan dengan read-back.' };
  if (!readbackMatches(item.valueText, p.data.value))
    return { ok: false, message: `Nilai yang dibacakan ulang tidak sama dengan laporan (${item.test}).` };
  const reportedAt = reportedAtFromTimer(item.raisedAt, DEMO_NOW, p.data.elapsedSeconds);
  const r = await commitEvent(
    'hasil-kritis',
    {
      type: 'laporan.dicatat',
      itemId: item.id,
      recipient: s.user.displayName,
      recipientRole: APP_READBACK_ROLE,
      channel: 'telepon',
      reportedAt,
      via: 'pusat',
    },
    { rev: p.data.rev, session: s },
  );
  if (!r.ok) return { ok: false, message: r.error, stale: r.stale };
  return { ok: true, message: 'Read-back tercatat di Pusat hasil kritis.' };
}
