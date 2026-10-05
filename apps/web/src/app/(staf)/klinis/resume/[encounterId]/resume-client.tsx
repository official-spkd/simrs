'use client';

import { type DischargeSummary, formatJam, type ResumeCheckId } from '@simrs/shared';
import { Button, cx } from '@simrs/ui';
import Link from 'next/link';
import { useState, useTransition } from 'react';
import { taskDone, taskEnabled, useScenarioTask } from '@/components/rawat-inap/use-scenario-task';
import { resumeCompleteness, resumeSignBlocker } from '@/lib/rawat-inap';
import type { ScenarioStepState } from '@/lib/rawat-inap-scenario';
import { signResumeAction } from './actions-demo';
import { ResumeSections } from './resume-sections';

/**
 * K13 · Resume medis (mockup Resume). Pasien biasa: centang dan konfirmasi rekonsiliasi lokal, TTE lewat Server
 * Action. Pasien skenario: butir terisi dari rekam medis Simulasi; tombol asli menjalankan tugas resume/rekon/tte.
 */
export function ResumeClient({
  summary,
  los,
  scenario,
  canSign,
  klaimHref,
}: {
  summary: DischargeSummary;
  los: number;
  scenario: ScenarioStepState | null;
  canSign: boolean;
  klaimHref: string | null;
}) {
  const { runTask, pending, error } = useScenarioTask(scenario?.rev ?? 0);
  const [checks, setChecks] = useState<Record<string, boolean>>(() =>
    Object.fromEntries(summary.checklist.map((c) => [c.id, c.done])),
  );
  const [reconAtLocal, setReconAt] = useState<string | null>(summary.reconciliationConfirmedAt);
  const [signed, setSigned] = useState<{ at: string; by: string } | null>(null);
  const [msg, setMsg] = useState<string | null>(null);
  const [busy, start] = useTransition();

  const scn = !!scenario;
  const sc = scenario ?? undefined;
  const reconAt = scn ? summary.reconciliationConfirmedAt : reconAtLocal;
  const checklist = summary.checklist.map((c) => ({
    ...c,
    done: scn ? c.done : c.id === 'rekonsiliasi' ? !!reconAt : !!checks[c.id],
  }));
  const comp = resumeCompleteness(checklist);
  const final = scn ? summary.signedAt : (signed?.at ?? summary.signedAt);
  const finalBy = scn ? summary.signedBy : (signed?.by ?? summary.signedBy);
  const tteOpen = scn ? taskEnabled(sc, 'tte') : true;
  const blocker =
    resumeSignBlocker(comp, canSign, !!final) ??
    (scn && !tteOpen ? 'Menunggu giliran tanda tangan di Simulasi.' : null);

  const toggle = (id: ResumeCheckId) => {
    if (final || scn) return;
    if (id === 'rekonsiliasi') setReconAt(reconAt ? null : new Date().toISOString());
    else setChecks((cur) => ({ ...cur, [id]: !cur[id] }));
  };

  const sign = () => {
    if (blocker) return;
    if (scn) {
      runTask(sc, 'tte', true);
      return;
    }
    start(async () => {
      const r = await signResumeAction({
        encounterId: summary.encounterId,
        done: checklist.filter((c) => c.done).map((c) => c.id),
        reconciliationConfirmed: !!reconAt,
      });
      if (!r.ok) return setMsg(r.error ?? 'Resume belum ditandatangani.');
      setSigned(r.ok);
      setMsg(null);
    });
  };

  const reconControls = final ? null : scenario ? (
    <ScenarioRecon scenario={scenario} pending={pending} runTask={runTask} />
  ) : (
    <span className="flex flex-wrap items-center gap-2.5">
      <Button
        variant={reconAt ? 'secondary' : 'primary'}
        aria-pressed={!!reconAt}
        onClick={() => setReconAt(reconAt ? null : new Date().toISOString())}
      >
        {reconAt ? 'Batalkan konfirmasi' : 'Konfirmasi DPJP'}
      </Button>
      <span className="text-caption text-ink-700">
        {reconAt
          ? 'Daftar obat pulang dikunci untuk resep pulang.'
          : 'Periksa ulang dosis dan obat yang dihentikan sebelum konfirmasi.'}
      </span>
    </span>
  );

  return (
    <div className="flex flex-wrap items-start gap-4">
      <div className="flex min-w-0 flex-[999_1_560px] flex-col gap-3">
        {scn && !taskDone(sc, 'resume') && (
          <div className="flex flex-wrap items-center justify-between gap-2.5 rounded-card border border-[#9FCFC8] bg-white px-4 py-3">
            <span className="text-small text-ink-700">
              Draf terisi otomatis dari CPPT, hasil, dan eMAR. Himpun ringkasan untuk mengisi diagnosis
              berkode dan obat pulang.
            </span>
            <Button
              variant="primary"
              disabled={!taskEnabled(sc, 'resume') || pending}
              onClick={() => runTask(sc, 'resume', true)}
            >
              Himpun resume
            </Button>
          </div>
        )}
        <ResumeSections summary={summary} los={los} reconAt={reconAt} reconControls={reconControls} />
      </div>
      <aside
        aria-label="Kelengkapan dan tanda tangan"
        className="flex flex-[1_1_300px] flex-col gap-3 rounded-card border border-line bg-white px-4 py-3.5 lg:max-w-[360px]"
      >
        <div className="flex items-baseline justify-between">
          <h2 className="m-0 text-body font-semibold">Kelengkapan</h2>
          <span className="font-mono font-bold">
            {comp.done}/{comp.total}
          </span>
        </div>
        <span
          role="progressbar"
          aria-label="Kelengkapan resume"
          aria-valuemin={0}
          aria-valuemax={comp.total}
          aria-valuenow={comp.done}
          className="h-2 overflow-hidden rounded-full bg-muted"
        >
          <span
            className={cx('block h-2', comp.complete ? 'bg-success' : 'bg-brand-600')}
            style={{ width: `${Math.round((comp.done / comp.total) * 100)}%` }}
          />
        </span>
        <ul className="m-0 flex list-none flex-col p-0">
          {checklist.map((c) => (
            <li key={c.id}>
              <label className="flex min-h-11 cursor-pointer items-center gap-2.5 text-small">
                <input
                  type="checkbox"
                  checked={c.done}
                  disabled={!!final || scn}
                  onChange={() => toggle(c.id)}
                  className="size-[18px] flex-none accent-brand-600"
                />
                <span className={cx(c.done ? 'text-ink-700' : 'font-semibold text-warning')}>
                  {c.id === 'rekonsiliasi' && !c.done
                    ? 'Rekonsiliasi obat pulang belum dikonfirmasi'
                    : c.label}
                </span>
              </label>
            </li>
          ))}
        </ul>
        {scn && (
          <span className="text-caption text-ink-500">Butir terisi otomatis dari rekam medis simulasi.</span>
        )}
        <div className="flex flex-col gap-1 border-t border-line-soft pt-2.5 text-caption text-ink-700">
          <span className="font-semibold">Setelah ditandatangani, otomatis:</span>
          <span>• Kirim ringkasan pulang dan diagnosis ke SATUSEHAT</span>
          <span>• Masuk antrean koder untuk klaim INA-CBG</span>
          <span>• Surat kontrol BPJS dan jadwal kontrol</span>
          <span>• Resume tampil di aplikasi pasien</span>
        </div>
        {final ? (
          <div
            role="status"
            className="flex flex-col gap-1.5 rounded-control border border-success-border bg-success-bg px-3 py-2.5"
          >
            <span className="font-semibold text-success">Resume final · TTE {formatJam(final)}</span>
            <span className="text-small text-ink-700">
              Ditandatangani {finalBy} pukul {formatJam(final)}. Terkirim ke SATUSEHAT dan masuk antrean koder
              (simulasi).
            </span>
            {klaimHref && (
              <Link href={klaimHref} className="text-small font-semibold">
                Lanjut ke klaim INA-CBG
              </Link>
            )}
          </div>
        ) : (
          <Button
            variant="primary"
            className="h-12 font-bold"
            disabled={!!blocker || busy || pending}
            aria-describedby="alasan-tte"
            onClick={sign}
          >
            Tanda tangani resume (TTE)
          </Button>
        )}
        <span
          id="alasan-tte"
          className={cx('text-caption', blocker && !final ? 'font-semibold text-warning' : 'text-ink-500')}
        >
          {final
            ? 'Setelah final, perubahan hanya lewat addendum berversi.'
            : (blocker ?? 'Setelah final, perubahan hanya lewat addendum berversi.')}
        </span>
        {(msg || error) && (
          <span role="alert" className="text-caption font-semibold text-danger">
            {msg ?? error?.message}
          </span>
        )}
      </aside>
    </div>
  );
}

/** Rekonsiliasi obat pulang pasien skenario: pilihan DPJP (tugas `resume.rekon`). */
function ScenarioRecon({
  scenario,
  pending,
  runTask,
}: {
  scenario: ScenarioStepState;
  pending: boolean;
  runTask: (s: ScenarioStepState, task: string, value: string) => boolean;
}) {
  const t = scenario.tasks.rekon;
  if (!t || t.done) return null;
  return (
    <span className="flex flex-col gap-1.5">
      <span className="text-caption font-semibold text-warning">
        Keputusan DPJP: amlodipin (obat rutin sebelum masuk)
      </span>
      <span className="grid grid-cols-1 gap-2 sm:grid-cols-2">
        {t.options.map((o) => (
          <Button
            key={o.id}
            variant={t.enabled ? 'primary' : 'secondary'}
            disabled={!t.enabled || pending}
            onClick={() => runTask(scenario, 'rekon', o.id)}
            className="h-auto min-h-11 flex-col gap-0 py-1.5"
          >
            <span className="font-semibold">{o.label}</span>
            {o.sub && <span className="text-caption font-normal opacity-90">{o.sub}</span>}
          </Button>
        ))}
      </span>
    </span>
  );
}
