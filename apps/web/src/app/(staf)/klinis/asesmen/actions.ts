'use server';

import { diffAnswers, formAnswersSchema, formatJam, validateAnswers } from '@simrs/shared';
import { z } from 'zod';
import { ASSESSMENT_PACKAGES, assessmentForm } from '@/lib/demo/fixtures/rme-asesmen';
import { wib } from '@/lib/demo/fixtures/rawat-inap';
import { demoNow } from '@/lib/demo/fixtures/waktu';
import { hasReason } from '@/lib/rme';
import { canWriteForm, formScore, latestResponse, newResponse, writeRoleLabel } from '@/lib/rme-asesmen';
import {
  committed,
  klinisSession,
  REKAM_DENIED,
  rekamFail,
  type RekamActionResult,
} from '@/lib/server/data/klinis/rekam';
import { assessmentsOf, rmeChartById } from '@/lib/server/data/klinis/rme';
import { commitEvent } from '@/lib/server/demo/state';

/**
 * K06 · Simpan isian asesmen/skrining (mode presentasi, ADR-0023/0085): formulir dari paket setting kunjungan, hak
 * tulis per profesi dari sesi, isian divalidasi skema formulir di server; koreksi = versi baru beralasan atas isian
 * terbaru (isian lama tetap). Tersimpan di toko `rekam-medis` atas nama pengguna sesi (Kelengkapan dan Worklist
 * membaca isian yang sama).
 */

const input = z.strictObject({
  encounterId: z.string().min(1).max(60),
  formCode: z.string().min(1).max(60),
  answers: formAnswersSchema,
  /** Koreksi: id isian terbaru yang dikoreksi + alasan. */
  correctsId: z.string().min(1).max(120).nullable(),
  reason: z.string().max(500).nullable(),
});

export async function saveAssessmentAction(
  raw: unknown,
  rev: unknown,
): Promise<RekamActionResult & { at?: string; version?: number; scoreText?: string }> {
  const s = await klinisSession('asesmen');
  if (!s) return REKAM_DENIED;
  const p = input.safeParse(raw);
  const r = z.int().min(0).safeParse(rev);
  if (!p.success || !r.success) return rekamFail('Isian asesmen tidak valid.');
  const view = await rmeChartById(p.data.encounterId);
  if (!view) return rekamFail('Kunjungan tidak dikenal.');
  const form = ASSESSMENT_PACKAGES[view.chart.setting].includes(p.data.formCode)
    ? assessmentForm(p.data.formCode)
    : undefined;
  if (!form) return rekamFail('Formulir tidak ada di paket asesmen kunjungan ini.');
  if (!canWriteForm(form, s.role?.code ?? null)) {
    return rekamFail(`Formulir ini diisi oleh ${writeRoleLabel(form)}.`);
  }
  const errors = Object.keys(validateAnswers(form.schema, p.data.answers)).length;
  if (errors > 0)
    return rekamFail(`${errors} isian belum lengkap atau belum valid; periksa tanda merah di formulir.`);
  const responses = assessmentsOf(view.chart, view.state);
  const last = latestResponse(responses, form.code);
  let correct: { prev: NonNullable<typeof last>; reason: string } | undefined;
  if (p.data.correctsId !== null) {
    if (!last || last.id !== p.data.correctsId)
      return rekamFail('Isian ini sudah dikoreksi; koreksi versi terbaru.');
    if (diffAnswers(form.schema, last.answers, p.data.answers).length === 0) {
      return rekamFail('Tidak ada perubahan untuk dikoreksi.');
    }
    if (!hasReason(p.data.reason)) return rekamFail('Alasan koreksi minimal 10 karakter.');
    correct = { prev: last, reason: p.data.reason ?? '' };
  }
  const at = wib(demoNow());
  const res = newResponse({
    id: `${p.data.encounterId}-asesmen-r${r.data}`,
    form,
    encounterId: p.data.encounterId,
    answers: p.data.answers,
    by: s.user.displayName,
    at,
    correct,
  });
  const { by: _by, ...response } = res;
  const c = await commitEvent(
    'rekam-medis',
    { type: 'asesmen.disimpan', encounterId: p.data.encounterId, response },
    { rev: r.data, session: s },
  );
  const score = formScore(form, p.data.answers);
  return committed(c, {
    ok: true,
    message: `${correct ? `Koreksi versi ${res.version}` : 'Final'} · ${formatJam(at)} · ${form.title}${
      score?.band ? ` · skor ${score.total} ${score.band.label}` : ''
    }`,
    at,
    version: res.version,
  });
}
