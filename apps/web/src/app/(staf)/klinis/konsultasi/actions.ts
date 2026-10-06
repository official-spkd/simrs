'use server';

import { formatJam } from '@simrs/shared';
import { z } from 'zod';
import { CONSULTANTS, CONSULTS } from '@/lib/demo/fixtures/rme-konsul';
import { wib } from '@/lib/demo/fixtures/rawat-inap';
import { demoNow } from '@/lib/demo/fixtures/waktu';
import { shortWhen } from '@/lib/rme';
import { answerBlocker, answerDueAt, FOLLOW_UP_LABEL, sendBlocker } from '@/lib/rme-konsul';
import { consultsOf } from '@/lib/rme-konsul-toko';
import {
  attestingDoctor,
  committed,
  klinisSession,
  readRekam,
  REKAM_DENIED,
  rekamFail,
  type RekamActionResult,
} from '@/lib/server/data/klinis/rekam';
import { rmeChartById } from '@/lib/server/data/klinis/rme';
import { commitEvent } from '@/lib/server/demo/state';

/**
 * K10 · Server Action konsultasi (mode presentasi, ADR-0023/0085): kirim konsul (dokter/residen, bukan ke diri
 * sendiri, pertanyaan klinis jelas) dan jawaban terstruktur hanya oleh dokter konsultan yang dituju (posisi dokter
 * dari sesi). Tindak lanjut jawaban (rawat bersama/alih rawat) mengubah tim perawatan. Tersimpan di toko
 * `rekam-medis`; Worklist membaca konsul yang sudah dijawab.
 */

const revSchema = z.int().min(0);

const sendInput = z.strictObject({
  encounterId: z.string().min(1).max(60),
  to: z.string().max(80),
  kind: z.enum(['sekali', 'rawat-bersama', 'alih-rawat']),
  urgency: z.enum(['cito', 'biasa']),
  question: z.string().max(1000),
});

export async function sendConsultAction(
  raw: unknown,
  rev: unknown,
): Promise<RekamActionResult & { at?: string }> {
  const s = await klinisSession('konsul');
  if (!s) return REKAM_DENIED;
  const p = sendInput.safeParse(raw);
  const r = revSchema.safeParse(rev);
  if (!p.success || !r.success) return rekamFail('Konsul tidak valid.');
  const actor = attestingDoctor(s);
  const blocked = sendBlocker(p.data, s.role?.code ?? null, actor);
  if (blocked) return rekamFail(blocked);
  const target = CONSULTANTS.find((c) => c.name === p.data.to);
  if (!target) return rekamFail('Pilih dokter konsultan dari daftar.');
  const view = await rmeChartById(p.data.encounterId);
  if (!view) return rekamFail('Kunjungan tidak dikenal.');
  const at = wib(demoNow());
  const consult = {
    id: `${p.data.encounterId}-konsul-r${r.data}`,
    encounterId: p.data.encounterId,
    patientId: view.chart.patientId,
    from: s.user.displayName,
    to: target.name,
    toSpecialty: target.specialty,
    kind: p.data.kind,
    urgency: p.data.urgency,
    question: p.data.question.trim(),
    sentAt: at,
    answer: null,
  };
  const c = await commitEvent(
    'rekam-medis',
    { type: 'konsul.dikirim', encounterId: p.data.encounterId, consult },
    { rev: r.data, session: s },
  );
  return committed(c, {
    ok: true,
    message: `Konsul terkirim ke ${target.name} · ${formatJam(at)} · jawab sebelum ${shortWhen(answerDueAt(consult), at)}.`,
    at,
  });
}

const answerInput = z.strictObject({
  consultId: z.string().min(1).max(120),
  findings: z.string().max(1000),
  conclusion: z.string().max(1000),
  recommendation: z.string().max(1000),
  followUp: z.enum(['selesai', 'rawat-bersama', 'alih-rawat']),
});

export async function answerConsultAction(
  raw: unknown,
  rev: unknown,
): Promise<RekamActionResult & { at?: string }> {
  const s = await klinisSession('konsul');
  if (!s) return REKAM_DENIED;
  const p = answerInput.safeParse(raw);
  const r = revSchema.safeParse(rev);
  if (!p.success || !r.success) return rekamFail('Jawaban konsul tidak valid.');
  const { state } = await readRekam();
  const consult = consultsOf(CONSULTS, state).find((c) => c.id === p.data.consultId);
  if (!consult) return rekamFail('Konsul tidak ditemukan.');
  const blocked = answerBlocker(consult, p.data, s.role?.code ?? null, attestingDoctor(s));
  if (blocked) return rekamFail(blocked);
  const at = wib(demoNow());
  const c = await commitEvent(
    'rekam-medis',
    {
      type: 'konsul.dijawab',
      encounterId: consult.encounterId,
      consultId: consult.id,
      findings: p.data.findings.trim(),
      conclusion: p.data.conclusion.trim(),
      recommendation: p.data.recommendation.trim(),
      followUp: p.data.followUp,
      at,
    },
    { rev: r.data, session: s },
  );
  return committed(c, {
    ok: true,
    message: `Konsul dijawab · ${formatJam(at)} · ${FOLLOW_UP_LABEL[p.data.followUp]}.`,
    at,
  });
}
