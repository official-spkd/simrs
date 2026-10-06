'use client';

import type { LabSample } from '@simrs/shared';
import { formatJam } from '@simrs/shared';
import { Button, cx } from '@simrs/ui';
import { useEffect, useState } from 'react';
import { reportCriticalAction } from '@/app/(staf)/penunjang/lab/actions';
import type { ScenarioId } from '@/lib/demo/engine/types';
import { STAF } from '@/lib/demo/fixtures/staf';
import { useStoreAction } from '@/lib/demo/store/client';
import {
  criticalReportSeconds,
  criticalStage,
  criticalTimer,
  formatLabNumber,
  formatMmSs,
} from '@/lib/penunjang';
import { CriticalReportForm } from './lab-critical-form';
import { NOT_YOUR_TURN, type ScenarioTasks } from './use-scenario-tasks';
import { useElapsed } from './use-elapsed';
import { ReadBackConfirm } from './lab-readback-confirm';
import { CRIT_DOT } from './pelangi';

/**
 * S09 · Banner nilai kritis (mockup Lab): alarm + timer 30 menit berjalan sampai laporan sah (read-back). Pasien
 * skenario IGD memajukan tugas `nilai-kritis.lapor` lalu `readback`; laporan pasien lain tersimpan di toko demo
 * bersama (domain `hasil-kritis`, ADR-0085) atas nama pengguna sesi dan tampil juga di Pusat hasil kritis.
 */
export function CriticalBanner({
  sample,
  scenario,
  tasks,
  rev,
}: {
  sample: LabSample;
  scenario: ScenarioId | null;
  tasks: ScenarioTasks;
  /** Revisi domain toko `hasil-kritis` yang dilihat halaman. */
  rev: number;
}) {
  const c = sample.critical;
  const stage = c ? criticalStage(c) : 'selesai';
  const elapsed = useElapsed(c?.elapsedSeconds ?? 0, stage !== 'selesai');
  const [formOpen, setFormOpen] = useState(false);
  const [chain, setChain] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [feedback, setFeedback] = useState<string | null>(null);
  const { run, pending } = useStoreAction(rev);
  const readbackTurn = tasks.enabled(scenario, 'readback');

  // Formulir tunggal (nama + read-back) di skenario: setelah `lapor` tersimpan, read-back dikonfirmasi otomatis.
  useEffect(() => {
    if (chain && scenario && stage === 'menunggu-read-back' && readbackTurn && !tasks.pending) {
      setChain(false);
      tasks.runTask(scenario, 'readback');
    }
  }, [chain, scenario, stage, readbackTurn, tasks]);

  if (!c) return null;
  const valueText = `${c.analyte} ${formatLabNumber(c.value, c.decimals)} ${c.unit}`;
  const where = `${sample.patient.name} (${sample.location})`;
  const timer = criticalTimer(elapsed, c.limitMinutes);
  const busy = pending || tasks.pending;

  const submit = (recipient: string) => {
    setError(null);
    if (scenario) {
      if (!tasks.enabled(scenario, 'lapor')) return setError(NOT_YOUR_TURN);
      tasks.runTask(scenario, 'lapor', recipient, (ok) => ok && setChain(true));
      return;
    }
    run(
      (current) =>
        reportCriticalAction({
          sampleId: sample.id,
          recipient,
          readBack: true,
          rev: current,
          elapsedSeconds: elapsed,
        }),
      (r) => {
        if (!r.ok) return setError(r.message);
        setFeedback(r.message);
        setFormOpen(false);
      },
    );
  };

  if (stage === 'selesai') {
    const took = formatMmSs(criticalReportSeconds(c));
    return (
      <section
        aria-label={`Nilai kritis dilaporkan · ${sample.patient.name}`}
        className="flex gap-3 rounded-card border border-zamrud-200 bg-alert-success px-4 py-3.5 shadow-card"
      >
        <span
          aria-hidden="true"
          className="flex size-7 flex-none animate-pop items-center justify-center rounded-full bg-zamrud-600 font-bold text-white"
        >
          ✓
        </span>
        <span role="status" className="flex flex-col gap-1">
          <span className="font-semibold text-zamrud-700">
            Nilai kritis dilaporkan: {valueText} · {where}
          </span>
          <span className="text-small text-ink-700">
            Diterima {c.recipient} pukul {c.reportedAt ? formatJam(c.reportedAt) : '—'} · read-back
            terkonfirmasi · waktu lapor {took} (target ≤ {c.limitMinutes} menit, timer berhenti).
          </span>
          {feedback && <span className="text-caption font-semibold text-zamrud-700">{feedback}</span>}
        </span>
      </section>
    );
  }

  return (
    <section
      aria-label={`Nilai kritis terbuka · ${sample.patient.name}`}
      className="flex flex-wrap gap-3 rounded-card border border-koral-200 bg-alert-critical px-4 py-3.5 text-koral-900 shadow-card"
    >
      <span
        aria-hidden="true"
        className="flex size-7 flex-none items-center justify-center rounded-full bg-koral-600 font-bold text-white animate-crit"
      >
        !
      </span>
      <div className="flex min-w-0 flex-[1_1_260px] flex-col gap-1">
        <span role="alert" className="inline-flex flex-wrap items-center gap-2 font-bold text-koral-800">
          <span aria-hidden="true" className={CRIT_DOT} />
          Nilai kritis: {valueText} · {where}
        </span>
        <span className="text-small text-ink-700">
          {timer.over
            ? `Melewati batas ${c.limitMinutes} menit, segera laporkan dengan read-back. `
            : `Wajib dilaporkan ke DPJP/dokter jaga ≤ ${c.limitMinutes} menit dengan read-back. `}
          Timer berjalan:{' '}
          <span
            role="timer"
            aria-live="off"
            className={cx('font-mono font-bold', timer.over && 'text-koral-800')}
          >
            {formatMmSs(elapsed)}
          </span>
          .
        </span>
        {stage === 'menunggu-read-back' && scenario && (
          <ReadBackConfirm
            recipient={c.recipient ?? ''}
            reportedAt={c.reportedAt}
            valueText={valueText}
            busy={busy || chain}
            disabledReason={readbackTurn ? null : NOT_YOUR_TURN}
            onConfirm={() => tasks.runTask(scenario, 'readback')}
          />
        )}
        {stage === 'terbuka' && formOpen && (
          <CriticalReportForm
            valueText={valueText}
            placeholder={`mis. ${scenario ? `${STAF.dokterJagaIgd} (dokter jaga IGD)` : `${sample.sender} (DPJP)`}`}
            busy={busy}
            serverError={error ?? (scenario ? (tasks.error?.message ?? null) : null)}
            onCancel={() => setFormOpen(false)}
            onSubmit={submit}
          />
        )}
      </div>
      {stage === 'terbuka' && !formOpen && (
        <Button variant="danger" className="self-center" onClick={() => setFormOpen(true)}>
          Catat pelaporan
        </Button>
      )}
    </section>
  );
}
