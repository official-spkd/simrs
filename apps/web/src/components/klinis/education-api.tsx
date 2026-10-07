'use client';

import {
  allFields,
  CONSENT_EDUCATION_TOPIC,
  displayAnswer,
  type EncounterEducation,
  type FormAnswers,
  validateAnswers,
} from '@simrs/shared';
import { Button, Chip } from '@simrs/ui';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useState, useTransition } from 'react';
import { FormRenderer } from '@/components/forms/form-renderer';
import { Feedback, type FeedbackMsg } from '@/components/rme/feedback';
import { formatTglJam } from '@/lib/rawat-inap';
import { saveEducationAction } from '@/lib/server/data/klinis/edukasi-actions';

const CARD =
  'flex min-w-0 flex-col gap-3 rounded-card border border-white/95 bg-white/90 shadow-card px-4 py-3.5';

/**
 * K11 · Edukasi terintegrasi mode api (fase 3 · 3.7, ADR-0058): mengisi formulir P07 `edukasi_terintegrasi` untuk
 * kunjungan ini lewat penyaji formulir P07, lalu riwayat edukasi (catatan final immutable). Status "Edukasi tindakan"
 * mengikuti aturan yang sama dengan syarat final persetujuan tindakan (`consentEducationReady`): isian terkini yang
 * memuat topik tindakan harus berevaluasi paham. Bila datang dari tablet persetujuan, tautan kembali ke draf.
 */
export function EducationApi({
  data,
  canWrite,
  backHref,
}: {
  data: EncounterEducation;
  /** Izin `forms.response.write` sesi (hak tulis per profesi tetap diperiksa API). */
  canWrite: boolean;
  /** Tautan kembali ke tablet persetujuan (draf yang menunggu edukasi), bila ada. */
  backHref: string | null;
}) {
  const router = useRouter();
  const [busy, start] = useTransition();
  const [answers, setAnswers] = useState<FormAnswers>({});
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [msg, setMsg] = useState<FeedbackMsg | null>(null);
  const form = data.form;
  const fields = form ? allFields(form.schema) : [];

  const submit = () => {
    if (!form) return;
    const errs = validateAnswers(form.schema, answers);
    setErrors(errs);
    if (Object.keys(errs).length > 0) {
      setMsg({ ok: false, text: 'Lengkapi isian bertanda bintang.' });
      return;
    }
    start(async () => {
      const res = await saveEducationAction({
        patientId: data.patientId,
        encounterId: data.encounterId,
        answers,
      });
      setMsg({ ok: res.ok, text: res.message });
      if (res.ok) {
        setAnswers({});
        router.refresh();
      }
    });
  };

  return (
    <div className="flex flex-col gap-4">
      <section aria-label="Status edukasi tindakan" className={CARD}>
        <div className="flex flex-wrap items-center gap-2">
          <h2 className="m-0 text-body font-semibold">Edukasi tindakan</h2>
          <Chip tone={data.ready ? 'success' : 'warning'}>
            {data.ready ? 'Terverifikasi paham' : 'Belum dinyatakan paham'}
          </Chip>
        </div>
        <p className="m-0 text-small text-ink-700">
          Persetujuan tindakan baru bisa ditandatangani dokter setelah edukasi terkini bertopik
          &ldquo;Tindakan yang direncanakan&rdquo; berevaluasi paham. Edukasi ulang yang lebih baru
          menggantikan evaluasi sebelumnya.
        </p>
        {backHref && (
          <Link
            href={backHref}
            className="inline-flex min-h-11 items-center self-start rounded-control border border-line-strong bg-white/90 px-3.5 text-small font-semibold text-ink-900 no-underline hover:bg-brand-50/60"
          >
            Kembali ke tablet persetujuan
          </Link>
        )}
      </section>

      <Feedback msg={msg} />

      {!form ? (
        <section className={CARD}>
          <p className="m-0 text-small text-ink-700">
            Formulir edukasi terintegrasi belum terbit di RS ini. Minta pengelola formulir menerbitkannya di
            layar Formulir klinis.
          </p>
        </section>
      ) : canWrite ? (
        <form
          aria-label="Catat edukasi"
          className={CARD}
          onSubmit={(e) => {
            e.preventDefault();
            submit();
          }}
        >
          <h2 className="m-0 text-body font-semibold">
            Catat edukasi · {form.title} (versi {form.version})
          </h2>
          {!data.supportsConsent && (
            <p className="m-0 text-small text-warning">
              Versi formulir ini belum memuat topik tindakan, sehingga belum bisa memenuhi syarat persetujuan.
            </p>
          )}
          <FormRenderer
            schema={form.schema}
            answers={answers}
            onChange={setAnswers}
            errors={errors}
            disabled={busy}
          />
          <Button type="submit" variant="primary" className="self-start" disabled={busy}>
            Simpan edukasi
          </Button>
        </form>
      ) : (
        <p className="m-0 text-small text-ink-500">Peran Anda hanya membaca riwayat edukasi.</p>
      )}

      <section aria-label="Riwayat edukasi" className={CARD}>
        <h2 className="m-0 text-body font-semibold">Riwayat edukasi kunjungan ini ({data.records.length})</h2>
        {data.records.length === 0 ? (
          <p className="m-0 text-small text-ink-500">Belum ada edukasi tercatat.</p>
        ) : (
          <ol className="m-0 flex list-none flex-col gap-2 p-0">
            {[...data.records].reverse().map((r) => {
              const topik = r.answers.topik;
              const procedure = Array.isArray(topik) && topik.includes(CONSENT_EDUCATION_TOPIC);
              return (
                <li
                  key={r.id}
                  className="flex flex-col gap-1 rounded-control border border-line px-3 py-2 text-small"
                >
                  <span className="flex flex-wrap items-center gap-2">
                    <span className="font-semibold">{formatTglJam(r.createdAt)}</span>
                    <span className="text-ink-700">{r.author ?? 'Petugas'}</span>
                    {procedure && <Chip tone="info">Topik tindakan</Chip>}
                  </span>
                  <dl className="m-0 grid grid-cols-[auto_1fr] gap-x-3 gap-y-0.5">
                    {fields
                      .filter((f) => f.type !== 'score' && r.answers[f.key] !== undefined)
                      .map((f) => (
                        <div key={f.key} className="contents">
                          <dt className="text-ink-500">{f.label}</dt>
                          <dd className="m-0">{displayAnswer(f, r.answers[f.key])}</dd>
                        </div>
                      ))}
                  </dl>
                </li>
              );
            })}
          </ol>
        )}
      </section>
    </div>
  );
}
