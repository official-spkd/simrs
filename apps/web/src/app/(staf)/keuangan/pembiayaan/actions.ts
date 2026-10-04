'use server';

import { INSTALMENT_STAGES, isoDateJakarta } from '@simrs/shared';
import { z } from 'zod';
import {
  canReject,
  drawdownRequestError,
  INSTALMENT_FLOW,
  nextInstalmentStage,
  REJECT_REASON_MIN,
} from '@/lib/btn-pembiayaan';
import { btnActionSession, getFinancingOverview } from '@/lib/server/data/btn';
import type { SessionView } from '@/lib/session-view';

/**
 * U04 · Server Action layar pembiayaan BTN (mode presentasi, ADR-0023): validasi pengajuan pencairan piutang,
 * simulasi keputusan BTN, pembayaran BPJS, dan tahap cicilan pasien (penolakan wajib beralasan). Tidak menyimpan
 * apa pun; versi produksi mengirimnya lewat outbox ke BTN dan membentuk jurnal.
 */

export interface FinancingActionResult {
  ok?: true;
  error?: string;
}

const id = z.string().regex(/^[A-Za-z0-9-]{1,40}$/);
const eventSchema = z.discriminatedUnion('kind', [
  z.strictObject({
    kind: z.literal('ajukan-pencairan'),
    batchIds: z.array(id).min(1, 'Pilih minimal satu batch layak bayar.').max(20),
    principal: z.string().regex(/^[1-9]\d{0,15}$/),
  }),
  z.strictObject({ kind: z.literal('pencairan-lanjut'), drawdownId: id }),
  z.strictObject({ kind: z.literal('bayar-bpjs'), drawdownId: id }),
  z.strictObject({ kind: z.literal('cicilan-lanjut'), applicationId: id, stage: z.enum(INSTALMENT_STAGES) }),
  z.strictObject({
    kind: z.literal('cicilan-tolak'),
    applicationId: id,
    reason: z
      .string()
      .trim()
      .min(REJECT_REASON_MIN, `Alasan penolakan wajib, minimal ${REJECT_REASON_MIN} karakter.`)
      .max(300),
  }),
]);
export type FinancingEventInput = z.infer<typeof eventSchema>;

export async function recordFinancingEventAction(input: FinancingEventInput): Promise<FinancingActionResult> {
  const access = await btnActionSession('pembiayaan');
  if ('error' in access) return { error: access.error };
  const parsed = eventSchema.safeParse(input);
  if (!parsed.success) return { error: parsed.error.issues[0]?.message ?? 'Isian tidak sah.' };
  const error = await serverCheck(access.session, parsed.data);
  if (error) return { error };
  // Mode presentasi: divalidasi lalu dibuang (simulasi, tidak disimpan).
  return { ok: true };
}

/**
 * Aturan yang tidak boleh dipercayakan ke layar, diperiksa terhadap data server (pintu data yang sama dengan
 * halaman): batch layak dan pokok ≤ advance terhitung; cicilan ada, bukan pasien skenario, dan tahapnya sah.
 */
async function serverCheck(session: SessionView, e: FinancingEventInput): Promise<string | null> {
  if (e.kind === 'pencairan-lanjut' || e.kind === 'bayar-bpjs') return null; // id pengajuan baru hanya ada di layar
  const { data } = await getFinancingOverview(session);
  if (e.kind === 'ajukan-pencairan') {
    return drawdownRequestError(data, e.batchIds, BigInt(e.principal), isoDateJakarta(data.asOf));
  }
  const app = data.applications.find((a) => a.id === e.applicationId);
  if (!app) return 'Pengajuan cicilan tidak ditemukan.';
  if (app.scenario) return 'Cicilan pasien skenario mengikuti Simulasi.';
  if (e.kind === 'cicilan-tolak') return canReject(app) ? null : 'Pengajuan ini sudah diputuskan BTN.';
  // Tahap dari layar boleh lebih maju dari server (tidak disimpan), tetapi tidak mundur dan harus punya lanjutan.
  const behind = INSTALMENT_FLOW.indexOf(e.stage) < INSTALMENT_FLOW.indexOf(app.stage);
  const open = !!nextInstalmentStage(app.stage) && !!nextInstalmentStage(e.stage);
  return behind || !open ? 'Tahap cicilan tidak sah.' : null;
}
