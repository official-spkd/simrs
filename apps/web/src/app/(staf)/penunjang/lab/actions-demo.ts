'use server';

import { z } from 'zod';
import { criticalReportGate } from '@/lib/penunjang';
import {
  DENIED,
  invalid,
  type PenunjangActionResult,
  penunjangSession,
  saveSupport,
} from '@/lib/penunjang-aksi';
import { supportEventSchema } from '@/lib/penunjang-demo';
import { DEMO_NOW } from '@/lib/demo/fixtures/waktu';
import {
  type CriticalStoreActionResult,
  criticalIdOfLab,
  MAX_REPORT_DELAY_SECONDS,
  reportedAtFromTimer,
  SCENARIO_CRITICAL_ELSEWHERE,
  storedFeedback,
} from '@/lib/penunjang-kritis';
import { findLabSample } from '@/lib/server/data/penunjang/lab';
import { findCriticalItem } from '@/lib/server/data/penunjang/kritis';
import { commitEvent } from '@/lib/server/demo/state';

/**
 * S01/S09 · Server Action layar Laboratorium (mode presentasi, ADR-0023). Klien hanya mengirim id; sampel dicari
 * server di worklist sesi. Validasi dan sampel ulang tersimpan di domain penunjang; pelaporan nilai
 * kritis tersimpan di toko demo bersama (domain `hasil-kritis`, ADR-0085) dan tampil di Pusat hasil kritis. Pasien
 * skenario dimajukan lewat mesin skenario.
 */

const sampleId = z.uuid();

export async function receiveLabAction(
  input: { sampleId: string; specimen: string; identityConfirmed: boolean },
  rev: number,
): Promise<PenunjangActionResult> {
  const session = await penunjangSession('lab');
  if (!session) return DENIED;
  const parsed = supportEventSchema.safeParse({ type: 'lab.terima', ...input });
  if (!parsed.success) return invalid('Lengkapi jenis spesimen dan pencocokan identitas.');
  return saveSupport(session, parsed.data, rev);
}

export async function validateLabAction(
  input: { sampleId: string; level: 'teknis' | 'klinis' },
  rev: number,
): Promise<PenunjangActionResult> {
  const s = await penunjangSession('lab');
  if (!s) return DENIED;
  const p = supportEventSchema.safeParse({ type: 'lab.validasi', ...input });
  if (!p.success) return invalid('Permintaan validasi tidak dikenal.');
  return saveSupport(s, p.data, rev);
}
export async function resampleLabAction(
  input: { sampleId: string; cancel: boolean },
  rev: number,
): Promise<PenunjangActionResult> {
  const s = await penunjangSession('lab');
  if (!s) return DENIED;
  const p = supportEventSchema.safeParse({ type: 'lab.sampel-ulang', ...input });
  if (!p.success) return invalid('Permintaan sampel ulang tidak dikenal.');
  return saveSupport(s, p.data, rev);
}

/**
 * Pelaporan nilai kritis (S09): hanya untuk sampel yang nilai kritisnya masih terbuka; nama penerima wajib
 * (≥ 5 karakter) dan read-back wajib dikonfirmasi; laporan tanpa read-back tidak sah sehingga ditolak. Tersimpan
 * atas nama pengguna sesi; `rev` = revisi domain `hasil-kritis` yang dilihat layar (tampilan basi ditolak).
 */
export async function reportCriticalAction(input: {
  sampleId: string;
  recipient: string;
  readBack: boolean;
  rev: number;
  /** Timer layar (detik sejak hasil keluar) saat read-back; dibatasi server. */
  elapsedSeconds: number;
}): Promise<CriticalStoreActionResult> {
  const s = await penunjangSession('lab');
  if (!s) return DENIED;
  const p = z
    .strictObject({
      sampleId,
      recipient: z.string().max(120),
      readBack: z.boolean(),
      rev: z.number().int().min(0),
      elapsedSeconds: z
        .number()
        .int()
        .min(0)
        .max(MAX_REPORT_DELAY_SECONDS * 2),
    })
    .safeParse(input);
  if (!p.success) return invalid('Laporan nilai kritis tidak dikenal.');
  const sample = await findLabSample(s, p.data.sampleId);
  const gate = criticalReportGate(sample, p.data.recipient, p.data.readBack);
  if (gate || !sample) return invalid(gate?.message ?? 'Sampel tidak ditemukan.', gate?.field);
  const item = await findCriticalItem(s, criticalIdOfLab(sample));
  if (!item) return invalid('Sampel ini tidak memiliki nilai kritis terbuka untuk dilaporkan.');
  if (item.scenario) return invalid(SCENARIO_CRITICAL_ELSEWHERE);
  const recipient = p.data.recipient.trim();
  const reportedAt = reportedAtFromTimer(item.raisedAt, DEMO_NOW, p.data.elapsedSeconds);
  const r = await commitEvent(
    'hasil-kritis',
    {
      type: 'laporan.dicatat',
      itemId: item.id,
      recipient,
      recipientRole: 'DPJP / dokter jaga',
      channel: 'telepon',
      reportedAt,
      via: 'lab',
    },
    { rev: p.data.rev, session: s },
  );
  if (!r.ok) return { ok: false, message: r.error, stale: r.stale };
  return storedFeedback(`Nilai kritis dilaporkan ke ${recipient}, read-back terkonfirmasi`, reportedAt);
}
