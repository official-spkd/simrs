'use client';

import { diffAnswers, type FormAnswers, formatJam, formatTanggal, validateAnswers } from '@simrs/shared';
import { Alert, Button, Chip, cx } from '@simrs/ui';
import { useState } from 'react';
import { saveAssessmentAction } from '@/app/(staf)/klinis/asesmen/actions';
import { FormRenderer } from '@/components/forms/form-renderer';
import { useStoreAction } from '@/lib/demo/store/client';
import { hasReason } from '@/lib/rme';
import {
  type AssessmentForm,
  type AssessmentResponse,
  assessmentStatus,
  canWriteForm,
  formScore,
  latestResponse,
  packageProgress,
  responseVersions,
  scoreFollowUp,
  statusLabel,
  writeRoleLabel,
} from '@/lib/rme-asesmen';
import { Feedback, type FeedbackMsg, ReasonField } from './feedback';

const TONE_TEXT = { success: 'text-success', warning: 'text-warning', danger: 'text-danger' } as const;
const TONE_BOX = {
  success: 'border-zamrud-200 bg-alert-success text-success',
  warning: 'border-kunyit-200 bg-alert-warning text-warning',
  danger: 'border-koral-200 bg-alert-critical text-danger',
} as const;

type Mode = { kind: 'lihat' } | { kind: 'isi' } | { kind: 'koreksi'; prev: AssessmentResponse };

/**
 * K06 · Paket asesmen satu kunjungan: status per formulir (belum diisi / final / reasesmen jatuh tempo), isi lewat
 * penyaji formulir P07 dengan skor otomatis dan saran tindak lanjut, hak tulis per profesi, koreksi = versi baru
 * beralasan (isian lama tetap). Isian diperiksa dan disimpan server (toko demo `rekam-medis`) atas nama pengguna sesi;
 * daftar isian datang dari server.
 */
export function AsesmenWorkspace({
  encounterId,
  settingLabel,
  forms,
  responses,
  startedAt,
  now,
  role,
  rev,
}: {
  encounterId: string;
  settingLabel: string;
  forms: readonly AssessmentForm[];
  responses: readonly AssessmentResponse[];
  startedAt: string;
  now: string;
  role: string | null;
  /** Revisi toko `rekam-medis`. */
  rev: number;
}) {
  const { run, pending } = useStoreAction(rev);
  const statuses = forms.map((f) => assessmentStatus(f, responses, startedAt, now));
  const firstOpen = forms.find((_, i) => statuses[i]?.kind !== 'final') ?? forms[0];
  const [code, setCode] = useState(firstOpen?.code ?? '');
  const [mode, setMode] = useState<Mode>({ kind: 'lihat' });
  const [draft, setDraft] = useState<FormAnswers>({});
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [reason, setReason] = useState('');
  const [tried, setTried] = useState(false);
  const [msg, setMsg] = useState<FeedbackMsg | null>(null);
  const progress = packageProgress(statuses);
  const form = forms.find((f) => f.code === code);
  if (!form) return null;
  const last = latestResponse(responses, form.code);
  const curStatus = statuses[forms.indexOf(form)];
  const writable = canWriteForm(form, role);
  const editing = mode.kind !== 'lihat';
  const shownAnswers = editing ? draft : (last?.answers ?? {});
  const score = formScore(form, shownAnswers);
  const follow = score ? scoreFollowUp(form.code, score) : null;
  const versions = last ? responseVersions(responses, last.id) : [];
  const diff = mode.kind === 'koreksi' ? diffAnswers(form.schema, mode.prev.answers, draft) : [];

  const pick = (c: string) => {
    setCode(c);
    setMode({ kind: 'lihat' });
    setErrors({});
    setMsg(null);
  };
  const start = (m: Mode) => {
    setMode(m);
    setDraft(m.kind === 'koreksi' ? { ...m.prev.answers } : {});
    setErrors({});
    setReason('');
    setTried(false);
    setMsg(null);
  };
  const save = () => {
    setTried(true);
    const errs = validateAnswers(form.schema, draft);
    setErrors(errs);
    const n = Object.keys(errs).length;
    if (n > 0) {
      setMsg({
        ok: false,
        text: `${n} isian belum lengkap atau belum valid; periksa tanda merah di formulir.`,
      });
      return;
    }
    if (mode.kind === 'koreksi' && diff.length === 0) {
      setMsg({ ok: false, text: 'Tidak ada perubahan untuk dikoreksi.' });
      return;
    }
    if (mode.kind === 'koreksi' && !hasReason(reason)) return;
    run(
      (r) =>
        saveAssessmentAction(
          {
            encounterId,
            formCode: form.code,
            answers: draft,
            correctsId: mode.kind === 'koreksi' ? mode.prev.id : null,
            reason: mode.kind === 'koreksi' ? reason.trim() : null,
          },
          r,
        ),
      (res) => {
        setMsg({ ok: res.ok, text: res.message });
        if (res.ok) setMode({ kind: 'lihat' });
      },
    );
  };

  return (
    <div className="flex flex-wrap items-start gap-4">
      <section
        aria-label="Paket asesmen"
        className="flex min-w-0 flex-[1_1_280px] flex-col overflow-hidden rounded-card border border-white/95 bg-white/90 shadow-card"
      >
        <div className="flex flex-col border-b border-line px-4 py-3">
          <h2 className="m-0 text-body font-semibold">Paket asesmen · {settingLabel}</h2>
          <span className="text-caption text-ink-500">
            {progress.done} dari {progress.total} final
          </span>
        </div>
        <ul className="m-0 list-none p-0">
          {forms.map((f, i) => {
            const st = statuses[i];
            const lbl = st ? statusLabel(st, now) : null;
            const s = st && st.kind !== 'belum' ? formScore(f, st.last.answers) : null;
            return (
              <li key={f.code} className="border-b border-line-soft">
                <button
                  type="button"
                  aria-pressed={f.code === code}
                  onClick={() => pick(f.code)}
                  className={cx(
                    'flex min-h-11 w-full cursor-pointer flex-col items-start gap-0.5 border-0 px-4 py-2.5 text-left font-[inherit]',
                    f.code === code
                      ? 'bg-[linear-gradient(90deg,var(--color-brand-100),rgba(255,255,255,0.4))]'
                      : 'bg-transparent hover:bg-brand-50/60',
                  )}
                >
                  <span className="font-semibold text-ink-900">{f.title}</span>
                  {lbl && (
                    <span className={cx('text-caption font-semibold', TONE_TEXT[lbl.tone])}>{lbl.text}</span>
                  )}
                  {s?.band && (
                    <span className="text-caption text-ink-700">
                      Skor {s.total} · {s.band.label}
                    </span>
                  )}
                </button>
              </li>
            );
          })}
        </ul>
      </section>

      <section
        aria-label={form.title}
        className="flex min-w-0 flex-[2_1_520px] flex-col gap-3 rounded-card border border-white/95 bg-white/90 shadow-card px-4 py-3.5"
      >
        <div className="flex flex-wrap items-start justify-between gap-2">
          <div className="flex flex-col">
            <h2 className="m-0 text-h2 font-semibold">{form.title}</h2>
            <span className="text-caption text-ink-500">
              Diisi oleh {writeRoleLabel(form)} ·{' '}
              {form.kind === 'awal'
                ? 'asesmen awal ≤ 24 jam sejak kunjungan dimulai'
                : `reasesmen tiap ${form.reassessHours} jam`}
            </span>
          </div>
          {last && !editing && (
            <Chip tone="success">
              Versi {last.version} · {formatJam(last.at)}
            </Chip>
          )}
        </div>
        {!writable && (
          <Alert level="info" title="Hak tulis per profesi">
            Formulir ini diisi oleh {writeRoleLabel(form)}. Posisi Anda dapat membaca isian.
          </Alert>
        )}
        <Feedback msg={msg} />

        {!editing && last && (
          <>
            <p className="m-0 text-small font-semibold text-success">
              Final · {formatTanggal(last.at)} · {formatJam(last.at)} · {last.by}
              {last.reason ? ` · koreksi: ${last.reason}` : ''}
            </p>
            <FormRenderer schema={form.schema} answers={last.answers} />
          </>
        )}
        {!editing && !last && (
          <p className="m-0 rounded-control bg-subtle px-3.5 py-3 text-small text-ink-700">
            Belum diisi pada kunjungan ini.{curStatus ? ` ${statusLabel(curStatus, now).text}.` : ''}
          </p>
        )}
        {editing && (
          <>
            <FormRenderer
              schema={form.schema}
              answers={draft}
              onChange={(a) => {
                setDraft(a);
                if (tried) setErrors(validateAnswers(form.schema, a));
              }}
              errors={errors}
            />
            {mode.kind === 'koreksi' && (
              <div className="flex flex-col gap-2 rounded-control border border-line bg-subtle px-3.5 py-3">
                <span className="text-small font-semibold">
                  Perubahan dari versi {mode.prev.version} ({diff.length})
                </span>
                {diff.length === 0 ? (
                  <span className="text-small text-ink-500">Belum ada perubahan.</span>
                ) : (
                  <ul className="m-0 pl-5 text-small">
                    {diff.map((d) => (
                      <li key={d.key}>
                        {d.label}: <span className="line-through">{d.before}</span> → {d.after}
                      </li>
                    ))}
                  </ul>
                )}
                <ReasonField
                  label="Alasan koreksi"
                  value={reason}
                  onChange={setReason}
                  showError={tried}
                  hint="Isian lama tetap tersimpan; koreksi menjadi versi baru dan tercatat di jejak audit."
                />
              </div>
            )}
          </>
        )}

        {follow && (
          <p
            role="status"
            className={cx(
              'm-0 rounded-control border px-3.5 py-2.5 text-small font-semibold',
              TONE_BOX[follow.tone],
            )}
          >
            Tindak lanjut: {follow.text}
          </p>
        )}

        <div className="flex flex-wrap items-center gap-2">
          {editing ? (
            <>
              <Button variant="primary" disabled={pending} onClick={save}>
                {mode.kind === 'koreksi' ? `Simpan koreksi (versi ${mode.prev.version + 1})` : 'Simpan final'}
              </Button>
              <Button onClick={() => setMode({ kind: 'lihat' })}>Batal</Button>
            </>
          ) : (
            <>
              {(!last || form.kind === 'skrining') && (
                <Button
                  variant="primary"
                  disabled={!writable}
                  aria-describedby={writable ? undefined : 'asesmen-why'}
                  onClick={() => start({ kind: 'isi' })}
                >
                  {last ? 'Isi reasesmen' : 'Isi sekarang'}
                </Button>
              )}
              {last && (
                <Button
                  disabled={!writable}
                  aria-describedby={writable ? undefined : 'asesmen-why'}
                  onClick={() => start({ kind: 'koreksi', prev: last })}
                >
                  Koreksi isian
                </Button>
              )}
              {!writable && (
                <span id="asesmen-why" className="text-caption text-ink-500">
                  Hanya {writeRoleLabel(form)} yang mengisi formulir ini.
                </span>
              )}
            </>
          )}
        </div>
        {versions.length > 1 && !editing && (
          <details className="text-small">
            <summary className="cursor-pointer font-semibold text-brand-700">
              Riwayat versi ({versions.length})
            </summary>
            <ol className="m-0 mt-1.5 flex flex-col gap-1 pl-5">
              {versions.map((v) => (
                <li key={v.id}>
                  Versi {v.version} · {formatTanggal(v.at)} · {formatJam(v.at)} · {v.by}
                  {v.reason ? ` · alasan: ${v.reason}` : ''}
                </li>
              ))}
            </ol>
          </details>
        )}
      </section>
    </div>
  );
}
