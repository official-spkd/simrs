'use server';

import { cpptNoteInputSchema, formatJam } from '@simrs/shared';
import { z } from 'zod';
import { canWriteCppt } from '@/lib/rawat-inap';
import { handoverBlocker } from '@/lib/rme-cppt';
import { cpptOf } from '@/lib/rme-toko';
import {
  commitCpptNote,
  commitCpptSign,
  committed,
  type CpptActionResult,
  klinisSession,
  readRekam,
  REKAM_DENIED,
  rekamFail,
  type RekamActionResult,
} from '@/lib/server/data/klinis/rekam';
import { rmeChartById } from '@/lib/server/data/klinis/rme';
import { commitEvent } from '@/lib/server/demo/state';
import { demoNow } from '@/lib/demo/fixtures/waktu';
import { wib } from '@/lib/demo/fixtures/rawat-inap';

/**
 * K07 · Server Action CPPT terintegrasi + serah terima SBAR (mode presentasi, ADR-0023). Rekam dibaca server (bagan
 * RME + toko demo `rekam-medis`, ADR-0085) dan semua aksi tersimpan atas nama pengguna sesi: catatan tampil juga di
 * Rawat inap; co-sign/verifikasi tampil di Worklist dan Kelengkapan.
 */

const revSchema = z.int().min(0);
const UNKNOWN = 'Kunjungan tidak dikenal.';

/** Rekam CPPT kunjungan bagan RME (rawat inap: rekam rawat inap; lainnya: catatan tersimpan saja). */
async function chartCppt(encounterId: string) {
  const view = await rmeChartById(encounterId);
  if (!view) return null;
  const { chart, state } = view;
  return {
    encounterId,
    dpjp: chart.dpjp,
    entries: chart.inpatient ? chart.inpatient.cppt : cpptOf([], state, encounterId),
  };
}

export async function saveChartCpptAction(input: unknown, rev: unknown): Promise<CpptActionResult> {
  const s = await klinisSession('cppt');
  if (!s) return REKAM_DENIED;
  if (!canWriteCppt(s.role?.code)) return rekamFail('Posisi ini tidak menulis CPPT.');
  const p = cpptNoteInputSchema.safeParse(input);
  const r = revSchema.safeParse(rev);
  if (!p.success || !r.success) return rekamFail(p.error?.issues[0]?.message ?? 'CPPT tidak valid.');
  const rec = await chartCppt(p.data.encounterId);
  if (!rec) return rekamFail(UNKNOWN);
  return commitCpptNote(s, rec.entries, p.data, r.data);
}

const signSchema = z.strictObject({
  encounterId: z.string().min(1).max(60),
  entryId: z.string().min(1).max(80),
  kind: z.enum(['cosign', 'verifikasi']),
});

/** Co-sign residen atau verifikasi DPJP atas CPPT PPA lain (identitas dari sesi). */
export async function signChartCpptAction(
  input: unknown,
  rev: unknown,
): Promise<RekamActionResult & { at?: string; by?: string }> {
  const s = await klinisSession('cppt');
  if (!s) return REKAM_DENIED;
  const p = signSchema.safeParse(input);
  const r = revSchema.safeParse(rev);
  if (!p.success || !r.success) return rekamFail('Permintaan tanda tangan tidak valid.');
  const rec = await chartCppt(p.data.encounterId);
  if (!rec) return rekamFail(UNKNOWN);
  return commitCpptSign(s, rec, p.data.entryId, p.data.kind, r.data);
}

const handoverSchema = z.strictObject({
  encounterId: z.string().min(1).max(60),
  shift: z.string().trim().min(1).max(40),
  receiver: z.string().max(80),
  sbar: z.strictObject({
    s: z.string().max(600),
    b: z.string().max(600),
    a: z.string().max(600),
    r: z.string().max(600),
  }),
});

const NURSE_ONLY = 'Serah terima shift dicatat perawat atau bidan.';

/** Serahkan shift: SBAR lengkap + penerima shift berikutnya (bukan pemberi). */
export async function giveHandoverAction(
  input: unknown,
  rev: unknown,
): Promise<RekamActionResult & { at?: string }> {
  const s = await klinisSession('cppt');
  if (!s) return REKAM_DENIED;
  if (s.role?.code !== 'perawat' && s.role?.code !== 'bidan') return rekamFail(NURSE_ONLY);
  const p = handoverSchema.safeParse(input);
  const r = revSchema.safeParse(rev);
  if (!p.success || !r.success) return rekamFail('Serah terima tidak valid.');
  const blocked = handoverBlocker(p.data.sbar, p.data.receiver, s.user.displayName);
  if (blocked) return rekamFail(blocked);
  if (!(await rmeChartById(p.data.encounterId))) return rekamFail(UNKNOWN);
  const at = wib(demoNow());
  const c = await commitEvent(
    'rekam-medis',
    {
      type: 'serahterima.diserahkan',
      encounterId: p.data.encounterId,
      shift: p.data.shift,
      receiver: p.data.receiver,
      sbar: {
        s: p.data.sbar.s.trim(),
        b: p.data.sbar.b.trim(),
        a: p.data.sbar.a.trim(),
        r: p.data.sbar.r.trim(),
      },
      at,
    },
    { rev: r.data, session: s },
  );
  return committed(c, {
    ok: true,
    message: `Diserahkan · ${formatJam(at)} · menunggu konfirmasi ${p.data.receiver}.`,
    at,
  });
}

const acceptSchema = z.strictObject({
  encounterId: z.string().min(1).max(60),
  handoverId: z.string().min(1).max(100),
});

/** Konfirmasi penerimaan serah terima (tercatat berjam atas nama pengguna sesi). */
export async function acceptHandoverAction(
  input: unknown,
  rev: unknown,
): Promise<RekamActionResult & { at?: string }> {
  const s = await klinisSession('cppt');
  if (!s) return REKAM_DENIED;
  if (s.role?.code !== 'perawat' && s.role?.code !== 'bidan') return rekamFail(NURSE_ONLY);
  const p = acceptSchema.safeParse(input);
  const r = revSchema.safeParse(rev);
  if (!p.success || !r.success) return rekamFail('Konfirmasi tidak valid.');
  const { state } = await readRekam();
  const h = state.handovers.find((x) => x.id === p.data.handoverId && x.encounterId === p.data.encounterId);
  if (!h) return rekamFail('Serah terima tidak ditemukan.');
  const at = wib(demoNow());
  const c = await commitEvent(
    'rekam-medis',
    { type: 'serahterima.diterima', encounterId: h.encounterId, handoverId: h.id, at },
    { rev: r.data, session: s },
  );
  return committed(c, {
    ok: true,
    message: `Serah terima diterima ${h.receiver} · ${formatJam(at)}.`,
    at,
  });
}
