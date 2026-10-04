'use client';

import { cx } from '@simrs/ui';
import Link from 'next/link';
import { useState } from 'react';
import { useDemoRunner } from '@/components/demo-sync';
import { OpenScreenButton } from '@/components/open-screen-button';
import type { ScenarioId } from '@/lib/demo/engine/types';
import type { SimStepView, SimTaskView } from '@/lib/demo/simulasi-view';

const toneBox: Record<'danger' | 'warn' | 'giliran' | 'netral' | 'selesai', string> = {
  danger: 'border-danger-border bg-[linear-gradient(100deg,rgba(180,35,24,0.09),#FFF8F7_60%)]',
  warn: 'border-warning-border bg-[linear-gradient(100deg,rgba(138,75,0,0.09),#FFFAF2_60%)]',
  giliran: 'border-[#9FCFC8] bg-[linear-gradient(100deg,rgba(15,118,110,0.06),#FFFFFF_60%)]',
  netral: 'border-line bg-white',
  selesai: 'border-brand-100 bg-white',
};

function TaskCard({
  task,
  index,
  step,
  rev,
}: {
  task: SimTaskView;
  index: number;
  step: number;
  rev: number;
}) {
  const { run, pending, error } = useDemoRunner(rev);
  const [draft, setDraft] = useState(task.inputDefault);
  const done = task.status === 'selesai';
  const box = done
    ? toneBox.selesai
    : task.tone === 'danger'
      ? toneBox.danger
      : task.tone === 'warn'
        ? toneBox.warn
        : task.enabled
          ? toneBox.giliran
          : toneBox.netral;
  const accentNum =
    task.tone === 'danger' ? 'bg-danger text-white' : task.tone === 'warn' ? 'bg-warning text-white' : '';
  const chip = done
    ? 'bg-success-bg text-success'
    : task.enabled
      ? task.tone === 'danger'
        ? 'bg-danger-bg text-danger'
        : task.tone === 'warn'
          ? 'bg-warning-bg text-warning'
          : 'bg-brand-50 text-brand-700'
      : 'bg-muted text-ink-500';
  const disabled = !task.enabled || pending;
  const errorText = error && (error.task === task.id || !error.task) ? error.message : null;
  const send = (value: true | string) => run({ type: 'task', step, task: task.id, value });

  return (
    <div
      className={cx(
        'flex flex-col gap-2.5 rounded-[12px] border px-3.5 py-3',
        box,
        !done && !task.enabled && 'opacity-60',
      )}
    >
      <div className="flex items-start gap-3">
        <span
          aria-hidden="true"
          className={cx(
            'flex size-7 flex-none items-center justify-center rounded-full text-small font-bold',
            done
              ? 'bg-brand-600 text-white'
              : accentNum || (task.enabled ? 'bg-brand-50 text-brand-700' : 'bg-muted text-ink-500'),
          )}
        >
          {done ? '✓' : index + 1}
        </span>
        <span className="flex min-w-0 flex-1 flex-col gap-0.5">
          <span
            className={cx(
              'font-semibold',
              !done && task.tone === 'danger'
                ? 'text-danger-strong'
                : !done && task.tone === 'warn'
                  ? 'text-warning-strong'
                  : 'text-ink-900',
            )}
          >
            {task.label}
          </span>
          {task.hint && <span className="text-[12.5px] text-ink-500">{task.hint}</span>}
        </span>
        <span
          className={cx('rounded-full px-2.5 py-0.5 text-[11.5px] font-semibold whitespace-nowrap', chip)}
        >
          {task.statusText}
        </span>
      </div>

      {task.kind === 'act' && !done && (
        <div className="pl-10">
          <button
            type="button"
            disabled={disabled}
            onClick={() => send(true)}
            className={cx(
              'min-h-[42px] rounded-control border px-4 font-[inherit] font-semibold',
              task.enabled
                ? task.tone === 'danger'
                  ? 'cursor-pointer border-danger-strong bg-danger text-white'
                  : 'cursor-pointer border-brand-800 bg-brand-600 text-white'
                : 'cursor-not-allowed border-line-strong bg-[#E9EDF1] text-ink-500',
            )}
          >
            {task.btn}
          </button>
        </div>
      )}

      {task.kind === 'choice' && (
        <div className="grid grid-cols-[repeat(auto-fit,minmax(230px,1fr))] gap-2 pl-10">
          {task.options.map((o) => (
            <button
              key={o.id}
              type="button"
              disabled={disabled}
              aria-pressed={o.selected}
              onClick={() => send(o.id)}
              className={cx(
                'flex min-h-11 flex-col gap-0.5 rounded-control border-[1.5px] px-3 py-2.5 text-left font-[inherit] text-ink-900',
                o.selected
                  ? task.tone === 'danger'
                    ? 'border-danger bg-danger-bg'
                    : 'border-brand-600 bg-brand-50'
                  : task.enabled
                    ? 'cursor-pointer border-[#9FB7B3] bg-white'
                    : 'cursor-default border-line bg-white',
                done && !o.selected && 'opacity-45',
              )}
            >
              <span className="text-[13.5px] font-semibold">{o.label}</span>
              {o.sub && <span className="text-caption text-ink-500">{o.sub}</span>}
            </button>
          ))}
        </div>
      )}

      {task.kind === 'input' && !done && (
        <form
          className="flex flex-wrap gap-2 pl-10"
          onSubmit={(e) => {
            e.preventDefault();
            send(draft);
          }}
        >
          <input
            type="text"
            aria-label={task.label}
            value={draft}
            placeholder={task.placeholder}
            disabled={disabled}
            maxLength={120}
            onChange={(e) => setDraft(e.target.value)}
            aria-invalid={errorText ? true : undefined}
            className={cx(
              'h-[42px] min-w-0 flex-[1_1_260px] rounded-control border bg-white px-3 font-[inherit]',
              errorText ? 'border-danger' : 'border-line-strong',
            )}
          />
          <button
            type="submit"
            disabled={disabled}
            className={cx(
              'h-[42px] rounded-control border px-4 font-[inherit] font-semibold',
              task.enabled
                ? 'cursor-pointer border-brand-800 bg-brand-600 text-white'
                : 'cursor-not-allowed border-line-strong bg-[#E9EDF1] text-ink-500',
            )}
          >
            Simpan
          </button>
        </form>
      )}

      {errorText && (
        <span role="alert" className="pl-10 text-[12.5px] text-danger">
          {errorText}
        </span>
      )}
      {done && task.kind !== 'choice' && (
        <span className="pl-10 text-small font-medium text-success">✓ {task.doneText}</span>
      )}
    </div>
  );
}

/** Kartu langkah aktif/ditinjau: tugas berurutan, gerbang keselamatan merah, tombol lanjut ke tahap berikutnya. */
export function StepCard({ step, rev, activeHref }: { step: SimStepView; rev: number; activeHref: string }) {
  const { run, pending, error } = useDemoRunner(rev);
  return (
    <div className="overflow-hidden rounded-card border border-line bg-white">
      <div className="flex flex-col gap-1.5 border-b border-line bg-[linear-gradient(100deg,rgba(15,118,110,0.07),#FFFFFF_60%)] px-[18px] py-4">
        <span className="flex flex-wrap items-center justify-between gap-2">
          <span className="text-[12.5px] text-ink-500">
            Langkah {step.no} · {step.stage}
          </span>
          <span className="rounded-full bg-brand-50 px-2.5 py-0.5 text-caption font-semibold text-brand-700">
            Peran: {step.actor}
            {step.roleName ? ` (posisi ${step.roleName})` : ''}
          </span>
        </span>
        <h2 className="m-0 text-[19px] font-semibold">{step.title}</h2>
        <p className="m-0 max-w-[760px] text-[13.5px] text-ink-700">{step.desc}</p>
        {step.screen && <OpenScreenButton screen={step.screen} role={step.role} roleName={step.roleName} />}
      </div>

      {step.past && (
        <div className="flex flex-wrap items-center justify-between gap-2.5 border-b border-info-border bg-info-bg px-[18px] py-2.5 text-small text-info">
          <span>Langkah ini sudah selesai. Anda sedang meninjau hasilnya.</span>
          <Link
            href={activeHref}
            className="flex min-h-9 items-center rounded-[9px] border border-info bg-white px-3 font-semibold text-info no-underline"
          >
            Kembali ke langkah aktif
          </Link>
        </div>
      )}

      <div className="flex flex-col gap-2.5 px-[18px] py-4">
        {step.tasks.map((t, i) => (
          <TaskCard key={`${step.index}.${t.id}`} task={t} index={i} step={step.index} rev={rev} />
        ))}
      </div>

      <div className="flex flex-wrap items-center justify-between gap-3 border-t border-line bg-subtle px-[18px] py-3.5">
        <span className="text-small text-ink-700">{step.footNote}</span>
        {!step.past && (
          <span className="flex flex-col items-end gap-1">
            <button
              type="button"
              disabled={!step.canNext || pending}
              onClick={() => run({ type: 'next' })}
              className={cx(
                'min-h-11 rounded-control border px-[18px] font-[inherit] font-semibold',
                step.canNext
                  ? 'cursor-pointer border-brand-800 bg-brand-600 text-white'
                  : 'cursor-not-allowed border-line-strong bg-[#E9EDF1] text-ink-500',
              )}
            >
              {step.nextLabel}
            </button>
            {error && (
              <span role="alert" className="text-caption text-danger">
                {error.message}
              </span>
            )}
          </span>
        )}
      </div>
    </div>
  );
}

/** Tombol di kartu ringkasan: ulangi skenario ini, atau coba skenario berikutnya dari awal. */
export function SummaryActions({
  rev,
  scenario,
  nextScenario,
}: {
  rev: number;
  scenario: ScenarioId;
  nextScenario: { id: ScenarioId; label: string };
}) {
  const { run, pending } = useDemoRunner(rev);
  return (
    <div className="flex flex-wrap gap-2.5 border-t border-line px-[18px] py-3.5">
      <button
        type="button"
        disabled={pending}
        onClick={() => run({ type: 'reset', scenario })}
        className="min-h-[42px] cursor-pointer rounded-control border border-brand-800 bg-brand-600 px-4 font-[inherit] font-semibold text-white"
      >
        Ulangi skenario
      </button>
      <button
        type="button"
        disabled={pending}
        onClick={() => run({ type: 'reset', scenario: nextScenario.id })}
        className="min-h-[42px] cursor-pointer rounded-control border border-line-strong bg-white px-4 font-[inherit] font-medium text-ink-900"
      >
        Coba skenario {nextScenario.label}
      </button>
    </div>
  );
}
