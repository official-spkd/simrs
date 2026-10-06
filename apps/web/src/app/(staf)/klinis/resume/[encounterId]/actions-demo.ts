'use server';

import { formatJam, RESUME_CHECK_IDS } from '@simrs/shared';
import { z } from 'zod';
import { patientById } from '@/lib/demo/fixtures/pasien';
import { wib } from '@/lib/demo/fixtures/rawat-inap';
import { demoNow } from '@/lib/demo/fixtures/waktu';
import { resumeCompleteness, resumeSignTargetBlocker } from '@/lib/rawat-inap';
import { getDischargeSummary } from '@/lib/server/data/klinis/resume';
import {
  committed,
  klinisSession,
  REKAM_DENIED,
  rekamFail,
  type RekamActionResult,
} from '@/lib/server/data/klinis/rekam';
import { commitEvent } from '@/lib/server/demo/state';
import type { SessionView } from '@/lib/session-view';

/**
 * K13 · Server Action resume medis (mode presentasi, ADR-0023): gerbang demo + sesi + posisi pemakai layar, kontrak
 * zod; resume dibaca server (fixture + toko demo `resume-medis`, ADR-0085). Butir kelengkapan dan rekonsiliasi obat
 * pulang tersimpan selama resume belum final; TTE hanya DPJP (posisi dokter) dan hanya bila ke-12 butir di server
 * lengkap. Resume final (`resume.final`) mengalir ke antrean koder/klaim, kelengkapan RM, dan papan tempat tidur.
 */

const revSchema = z.int().min(0);
const DOCTOR_ONLY = 'Resume medis disusun dan ditandatangani DPJP (posisi dokter).';

async function draftResume(s: SessionView, encounterId: string) {
  const found = await getDischargeSummary(s, encounterId);
  const blocked = resumeSignTargetBlocker(found);
  return blocked || found?.kind !== 'resume'
    ? ({ ok: false, error: blocked ?? 'Resume tidak dikenal.' } as const)
    : ({ ok: true, summary: found.summary } as const);
}

const itemInput = z.strictObject({
  encounterId: z.string().min(1).max(60),
  itemId: z.enum(RESUME_CHECK_IDS),
  done: z.boolean(),
});

/** Centang/batal centang satu butir kelengkapan (selain rekonsiliasi, yang lewat konfirmasi DPJP). */
export async function toggleResumeItemAction(input: unknown, rev: unknown): Promise<RekamActionResult> {
  const s = await klinisSession('resume');
  if (!s) return REKAM_DENIED;
  if (s.role?.code !== 'dokter') return rekamFail(DOCTOR_ONLY);
  const p = itemInput.safeParse(input);
  const r = revSchema.safeParse(rev);
  if (!p.success || !r.success || p.data.itemId === 'rekonsiliasi')
    return rekamFail('Butir resume tidak dikenal.');
  const d = await draftResume(s, p.data.encounterId);
  if (!d.ok) return rekamFail(d.error);
  const c = await commitEvent(
    'resume-medis',
    {
      type: 'resume.butir',
      encounterId: p.data.encounterId,
      itemId: p.data.itemId,
      done: p.data.done,
      at: wib(demoNow()),
    },
    { rev: r.data, session: s },
  );
  return committed(c, { ok: true, message: 'Butir resume tersimpan.' });
}

const reconInput = z.strictObject({ encounterId: z.string().min(1).max(60), confirmed: z.boolean() });

/** Konfirmasi (atau batal) rekonsiliasi obat pulang oleh DPJP, berjam. */
export async function confirmReconciliationAction(
  input: unknown,
  rev: unknown,
): Promise<RekamActionResult & { at?: string }> {
  const s = await klinisSession('resume');
  if (!s) return REKAM_DENIED;
  if (s.role?.code !== 'dokter') return rekamFail(DOCTOR_ONLY);
  const p = reconInput.safeParse(input);
  const r = revSchema.safeParse(rev);
  if (!p.success || !r.success) return rekamFail('Konfirmasi rekonsiliasi tidak valid.');
  const d = await draftResume(s, p.data.encounterId);
  if (!d.ok) return rekamFail(d.error);
  const at = wib(demoNow());
  const c = await commitEvent(
    'resume-medis',
    { type: 'resume.rekonsiliasi', encounterId: p.data.encounterId, confirmed: p.data.confirmed, at },
    { rev: r.data, session: s },
  );
  return committed(c, {
    ok: true,
    message: p.data.confirmed
      ? `Rekonsiliasi obat pulang dikonfirmasi ${formatJam(at)}.`
      : 'Konfirmasi dibatalkan.',
    at,
  });
}

/**
 * TTE resume medis: hanya DPJP (posisi dokter), hanya resume yang dikenal, sudah disiapkan, belum final, bukan milik
 * pasien skenario (TTE-nya lewat tugas skenario), dan hanya bila 12 butir lengkap menurut rekam server.
 */
export async function signResumeAction(
  input: unknown,
  rev: unknown,
): Promise<RekamActionResult & { at?: string; by?: string }> {
  const s = await klinisSession('resume');
  if (!s) return REKAM_DENIED;
  if (s.role?.code !== 'dokter') return rekamFail('TTE resume hanya oleh DPJP (posisi dokter).');
  const p = z.strictObject({ encounterId: z.string().min(1).max(60) }).safeParse(input);
  const r = revSchema.safeParse(rev);
  if (!p.success || !r.success) return rekamFail('Resume tidak dikenal.');
  const d = await draftResume(s, p.data.encounterId);
  if (!d.ok) return rekamFail(d.error);
  const sum = d.summary;
  if (!sum.reconciliationConfirmedAt) return rekamFail('Rekonsiliasi obat pulang belum dikonfirmasi DPJP.');
  const comp = resumeCompleteness(sum.checklist);
  if (!comp.complete) return rekamFail(`Resume belum lengkap: ${comp.total - comp.done} butir lagi.`);
  const pt = patientById(sum.patientId);
  if (!pt) return rekamFail('Pasien tidak dikenal.');
  const signedAt = wib(demoNow());
  const los = Math.max(
    0,
    Math.round((Date.parse(sum.dischargeAt) - Date.parse(sum.admittedAt)) / 86_400_000),
  );
  const c = await commitEvent(
    'resume-medis',
    {
      type: 'resume.final',
      encounterId: sum.encounterId,
      patientId: sum.patientId,
      rm: pt.rm,
      patientName: pt.nama,
      guarantor: `${pt.penjamin}${pt.kelas ? ` ${pt.kelas}` : ''}`,
      admittedAt: sum.admittedAt,
      dischargeAt: sum.dischargeAt,
      los,
      dischargeMethod: sum.dischargeMethod,
      condition: sum.condition,
      dpjp: sum.dpjp,
      codes: sum.codes,
      signedAt,
    },
    { rev: r.data, session: s },
  );
  return committed(c, { ok: true, message: 'Resume final.', at: signedAt, by: s.user.displayName });
}
