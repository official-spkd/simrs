'use client';

import type { LabSample } from '@simrs/shared';
import { formatJam } from '@simrs/shared';
import { Button, cx } from '@simrs/ui';
import { useEffect, useState, useTransition } from 'react';
import { reportCriticalAction } from '@/app/(staf)/penunjang/lab/actions';
import type { ScenarioId } from '@/lib/demo/engine/types';
import { STAF } from '@/lib/demo/fixtures/staf';
import { demoNow } from '@/lib/demo/fixtures/waktu';
import { criticalStage, criticalTimer, formatLabNumber, formatMmSs, type LabLocal } from '@/lib/penunjang';
import { CriticalReportForm } from './lab-critical-form';
import { NOT_YOUR_TURN, type ScenarioTasks } from './use-scenario-tasks';
import { useElapsed } from './use-elapsed';
import { ReadBackConfirm } from './lab-readback-confirm';

/**
 * S09 · Banner nilai kritis (mockup Lab): alarm + timer 30 menit berjalan sampai laporan sah (read-back). Pasien
 * skenario IGD memajukan tugas `nilai-kritis.lapor` lalu `readback`; pasien lain disimulasikan lewat Server Action.
 */
export function CriticalBanner({
  sample,
  scenario,
  tasks,
  onLocalReport,
}: {
  sample: LabSample;
  scenario: ScenarioId | null;
  tasks: ScenarioTasks;
  onLocalReport: (sampleId: string, report: NonNullable<LabLocal['critical']>) => void;
}) {
  const c = sample.critical;
  const stage = c ? criticalStage(c) : 'selesai';
  const elapsed = useElapsed(c?.elapsedSeconds ?? 0, stage !== 'selesai');
  const [formOpen, setFormOpen] = useState(false);
  const [chain, setChain] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [feedback, setFeedback] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();
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
    startTransition(async () => {
      const r = await reportCriticalAction({ sampleId: sample.id, recipient, readBack: true });
      if (!r.ok) return setError(r.message);
      const now = demoNow().toISOString();
      setFeedback(r.message);
      setFormOpen(false);
      onLocalReport(sample.id, { recipient, reportedAt: now, readBackAt: now, tookSeconds: elapsed });
    });
  };

  if (stage === 'selesai') {
    const took = c.minutesToReport ?? 0;
    return (
      <section
        aria-label={`Nilai kritis dilaporkan · ${sample.patient.name}`}
        className="flex gap-3 rounded-card border border-success-border bg-[linear-gradient(100deg,rgba(30,107,52,0.10),#F3FAF5_60%)] px-4 py-3.5"
      >
        <span
          aria-hidden="true"
          className="flex size-7 flex-none items-center justify-center rounded-full bg-success font-bold text-white"
        >
          ✓
        </span>
        <span role="status" className="flex flex-col gap-1">
          <span className="font-semibold text-success">
            Nilai kritis dilaporkan: {valueText} · {where}
          </span>
          <span className="text-small text-ink-700">
            Diterima {c.recipient} pukul {c.reportedAt ? formatJam(c.reportedAt) : '—'} · read-back
            terkonfirmasi · waktu lapor {took} menit (target ≤ {c.limitMinutes} menit, timer berhenti).
          </span>
          {feedback && <span className="text-caption font-semibold text-success">{feedback}</span>}
        </span>
      </section>
    );
  }

  return (
    <section
      aria-label={`Nilai kritis terbuka · ${sample.patient.name}`}
      className="flex flex-wrap gap-3 rounded-card border border-danger-border bg-[linear-gradient(100deg,rgba(180,35,24,0.10),#FFF5F4_60%)] px-4 py-3.5"
    >
      <span
        aria-hidden="true"
        className="flex size-7 flex-none items-center justify-center rounded-full bg-danger font-bold text-white"
      >
        !
      </span>
      <div className="flex min-w-0 flex-[1_1_260px] flex-col gap-1">
        <span role="alert" className="font-semibold text-danger-strong">
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
            className={cx('font-mono font-semibold', timer.over && 'text-danger')}
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
