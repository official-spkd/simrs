'use client';

import { type EncounterAssessment, type FormAnswers, type FormSchema, validateAnswers } from '@simrs/shared';
import { Button, Chip } from '@simrs/ui';
import { useRouter } from 'next/navigation';
import { useState, useTransition } from 'react';
import { FormRenderer } from '@/components/forms/form-renderer';
import { Feedback, type FeedbackMsg } from '@/components/rme/feedback';
import { formatTglJam } from '@/lib/rawat-inap';
import { saveAssessmentAction } from '@/lib/server/data/klinis/rekam-api-actions';

const CARD =
  'flex min-w-0 flex-col gap-3 rounded-card border border-white/95 bg-white/90 px-4 py-3.5 shadow-card';

/** Isi satu formulir P07 untuk kunjungan ini (hak tulis per profesi + validasi isian ditegakkan API). */
export function AssessmentForm({
  patientId,
  encounterId,
  form,
  allowed,
}: {
  patientId: string;
  encounterId: string;
  form: { code: string; title: string; version: number; schema: FormSchema; writeRoles: string[] };
  /** Peran sesi tercantum di hak tulis formulir. */
  allowed: boolean;
}) {
  const router = useRouter();
  const [busy, start] = useTransition();
  const [answers, setAnswers] = useState<FormAnswers>({});
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [msg, setMsg] = useState<FeedbackMsg | null>(null);
  return (
    <form
      aria-label={`Isi ${form.title}`}
      className={CARD}
      onSubmit={(e) => {
        e.preventDefault();
        const errs = validateAnswers(form.schema, answers);
        setErrors(errs);
        if (Object.keys(errs).length > 0) {
          setMsg({ ok: false, text: 'Lengkapi isian bertanda bintang.' });
          return;
        }
        start(async () => {
          const r = await saveAssessmentAction({ patientId, encounterId, formCode: form.code, answers });
          setMsg({ ok: r.ok, text: r.message });
          if (r.ok) {
            setAnswers({});
            router.refresh();
          }
        });
      }}
    >
      <h2 className="m-0 text-body font-semibold">
        {form.title} · versi {form.version}
      </h2>
      <Feedback msg={msg} />
      {!allowed ? (
        <p className="m-0 text-small text-warning">
          Formulir ini diisi oleh {form.writeRoles.join(', ')} (hak tulis per profesi). Peran Anda hanya
          membaca.
        </p>
      ) : (
        <>
          <FormRenderer
            schema={form.schema}
            answers={answers}
            onChange={setAnswers}
            errors={errors}
            disabled={busy}
          />
          <Button type="submit" variant="primary" className="self-start" disabled={busy}>
            Simpan asesmen (final)
          </Button>
        </>
      )}
    </form>
  );
}

/** Daftar isian asesmen kunjungan (versi terkini; salah entri bertanda). */
export function AssessmentList({ items }: { items: readonly EncounterAssessment[] }) {
  return (
    <section aria-label="Asesmen kunjungan ini" className={CARD}>
      <h2 className="m-0 text-body font-semibold">Asesmen kunjungan ini ({items.length})</h2>
      {items.length === 0 ? (
        <p className="m-0 text-small text-ink-500">Belum ada asesmen pada kunjungan ini.</p>
      ) : (
        <ul className="m-0 flex list-none flex-col gap-2 p-0">
          {items.map((a) => (
            <li
              key={a.id}
              className="flex flex-wrap items-center gap-2 rounded-control border border-line px-3 py-2 text-small"
            >
              <span className="font-semibold">{a.formTitle}</span>
              {a.score !== null && (
                <Chip tone="info">
                  Skor {a.score}
                  {a.scoreBand ? ` · ${a.scoreBand}` : ''}
                </Chip>
              )}
              {a.status === 'entered_in_error' && <Chip tone="danger">Salah entri</Chip>}
              {a.version > 1 && <Chip tone="neutral">Versi {a.version}</Chip>}
              <span className="text-caption text-ink-500">
                {a.author ?? 'Petugas'} · {formatTglJam(a.createdAt)}
              </span>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}
