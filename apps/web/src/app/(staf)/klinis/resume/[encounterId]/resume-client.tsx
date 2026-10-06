'use client';

import { type DischargeSummary, formatJam, type ResumeCheckId } from '@simrs/shared';
import { Button, cx } from '@simrs/ui';
import Link from 'next/link';
import { useEffect, useState } from 'react';
import { taskDone, taskEnabled, useScenarioTask } from '@/components/rawat-inap/use-scenario-task';
import { useStoreAction } from '@/lib/demo/store/client';
import { resumeCompleteness, resumeSignBlocker } from '@/lib/rawat-inap';
import type { ScenarioStepState } from '@/lib/rawat-inap-scenario';
import { confirmReconciliationAction, signResumeAction, toggleResumeItemAction } from './actions-demo';
import { ResumeSections } from './resume-sections';

/**
 * K13 · Resume medis (mockup Resume). Pasien biasa: butir, konfirmasi rekonsiliasi, dan TTE tersimpan di toko demo
 * (`resume-medis`) lewat Server Action; centang tampil segera lalu dikonfirmasi server. Pasien skenario: butir terisi
 * dari rekam medis Simulasi; tombol asli menjalankan tugas resume/rekon/tte.
 */
export function ResumeClient({
  summary,
  los,
  scenario,
  canSign,
  klaimHref,
  rev,
}: {
  summary: DischargeSummary;
  los: number;
  scenario: ScenarioStepState | null;
  canSign: boolean;
  klaimHref: string | null;
  /** Revisi toko `resume-medis`. */
  rev: number;
}) {
  const { runTask, pending, error } = useScenarioTask(scenario?.rev ?? 0);
  const { run, pending: busy } = useStoreAction(rev);
  /** Centang yang sudah diklik tetapi belum dikonfirmasi server (tampil segera). */
  const [optimistic, setOptimistic] = useState<Record<string, boolean>>({});
  const [msg, setMsg] = useState<string | null>(null);
  useEffect(() => setOptimistic({}), [rev]);

  const scn = !!scenario;
  const sc = scenario ?? undefined;
  const reconAt = summary.reconciliationConfirmedAt;
  const checklist = summary.checklist.map((c) => ({
    ...c,
    done: scn || c.id === 'rekonsiliasi' ? c.done : (optimistic[c.id] ?? c.done),
  }));
  const comp = resumeCompleteness(checklist);
  const final = summary.signedAt;
  const finalBy = summary.signedBy;
  const tteOpen = scn ? taskEnabled(sc, 'tte') : true;
  const blocker =
    resumeSignBlocker(comp, canSign, !!final) ??
    (scn && !tteOpen ? 'Menunggu giliran tanda tangan di Simulasi.' : null);

  const recon = (confirmed: boolean) =>
    run(
      (r) => confirmReconciliationAction({ encounterId: summary.encounterId, confirmed }, r),
      (res) => setMsg(res.ok ? null : res.message),
    );

  const toggle = (id: ResumeCheckId) => {
    if (final || scn) return;
    if (id === 'rekonsiliasi') return recon(!reconAt);
    const done = !checklist.find((c) => c.id === id)?.done;
    setOptimistic((cur) => ({ ...cur, [id]: done }));
    run(
      (r) => toggleResumeItemAction({ encounterId: summary.encounterId, itemId: id, done }, r),
      (res) => {
        if (res.ok) return setMsg(null);
        setOptimistic((cur) => {
          const { [id]: _drop, ...rest } = cur;
          return rest;
        });
        setMsg(res.message);
      },
    );
  };

  const sign = () => {
    if (blocker) return;
    if (scn) {
      runTask(sc, 'tte', true);
      return;
    }
    run(
      (r) => signResumeAction({ encounterId: summary.encounterId }, r),
      (res) => setMsg(res.ok ? null : res.message || 'Resume belum ditandatangani.'),
    );
  };

  const reconControls = final ? null : scenario ? (
    <ScenarioRecon scenario={scenario} pending={pending} runTask={runTask} />
  ) : (
    <span className="flex flex-wrap items-center gap-2.5">
      <Button
        variant={reconAt ? 'secondary' : 'primary'}
        aria-pressed={!!reconAt}
        disabled={busy || !canSign}
        onClick={() => recon(!reconAt)}
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
          <div className="flex flex-wrap items-center justify-between gap-2.5 rounded-card border border-brand-200 bg-[linear-gradient(135deg,var(--color-brand-50),var(--color-brand-100))] px-4 py-3 shadow-card">
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
        className="flex flex-[1_1_300px] flex-col gap-3 rounded-card border border-white/95 bg-white/90 shadow-card px-4 py-3.5 lg:max-w-[360px]"
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
          className="h-2 overflow-hidden rounded-full bg-[rgba(23,32,46,0.08)]"
        >
          <span
            className={cx(
              'block h-2 origin-left animate-grow rounded-full',
              comp.complete ? 'bg-success' : 'bg-domain-bar',
            )}
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
                  disabled={!!final || scn || busy || !canSign}
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
          <span>• Kirim Composition dan Condition ke SATUSEHAT</span>
          <span>• Masuk antrean koder untuk klaim INA-CBG</span>
          <span>• Surat kontrol BPJS dan jadwal kontrol</span>
          <span>• Resume tampil di aplikasi pasien</span>
        </div>
        {final ? (
          <div
            role="status"
            className="flex flex-col gap-1.5 rounded-control border border-zamrud-200 bg-alert-success px-3 py-2.5"
          >
            <span className="font-semibold text-success">Resume final · TTE {formatJam(final)}</span>
            <span className="text-small text-ink-700">
              Ditandatangani {finalBy} pukul {formatJam(final)}. Masuk antrean koder untuk klaim INA-CBG dan
              kelengkapan rekam medis; kiriman SATUSEHAT lewat outbox saat backend tersambung.
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
