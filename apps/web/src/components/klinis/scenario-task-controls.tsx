'use client';

import { Button, cx } from '@simrs/ui';
import type { SimTaskView } from '@/lib/demo/simulasi-view';
import type { ScenarioTasks } from './use-scenario-tasks';

/** Status tugas skenario dalam teks (tidak hanya warna). */
function TaskStatus({ t }: { t: SimTaskView }) {
  return (
    <span
      className={cx(
        'text-caption',
        t.status === 'selesai' ? 'font-semibold text-success' : t.enabled ? 'text-brand-700' : 'text-ink-500',
      )}
    >
      {t.status === 'selesai' ? `✓ ${t.doneText || t.statusText}` : t.statusText}
    </span>
  );
}

/** Tugas pilihan skenario sebagai tombol pilihan asli layar (aria-pressed = pilihan tersimpan). */
export function TaskChoice({ tasks, t }: { tasks: ScenarioTasks; t: SimTaskView }) {
  const error = tasks.errorFor(t.id);
  return (
    <fieldset className="m-0 flex min-w-0 flex-col gap-1.5 border-0 p-0">
      <legend className="mb-1 flex w-full flex-wrap items-baseline justify-between gap-2 p-0">
        <span className="text-small font-semibold text-ink-900">{t.label}</span>
        <TaskStatus t={t} />
      </legend>
      {t.hint && <span className="text-caption text-ink-500">{t.hint}</span>}
      <span className="flex flex-wrap gap-2">
        {t.options.map((o) => (
          <button
            key={o.id}
            type="button"
            aria-pressed={o.selected}
            disabled={!tasks.enabled(t.id)}
            onClick={() => tasks.run(t.id, o.id)}
            className={cx(
              'flex min-h-11 max-w-full cursor-pointer flex-col items-start rounded-control border px-3 py-1.5 text-left font-[inherit] disabled:cursor-not-allowed',
              o.selected
                ? 'border-brand-600 bg-brand-50 font-semibold text-brand-700'
                : 'border-line-strong bg-white text-ink-900',
              !o.selected && !t.enabled && 'opacity-60',
            )}
          >
            <span>
              {o.selected ? '✓ ' : ''}
              {o.label}
            </span>
            {o.sub && <span className="text-caption font-normal text-ink-500">{o.sub}</span>}
          </button>
        ))}
      </span>
      {error && (
        <span role="alert" className="text-caption text-danger">
          {error}
        </span>
      )}
    </fieldset>
  );
}

/** Tugas aksi skenario sebagai tombol asli layar. */
export function TaskAct({ tasks, t }: { tasks: ScenarioTasks; t: SimTaskView }) {
  const error = tasks.errorFor(t.id);
  return (
    <div className="flex min-w-0 flex-col gap-1.5">
      <span className="flex flex-wrap items-baseline justify-between gap-2">
        <span className="text-small font-semibold text-ink-900">{t.label}</span>
        <TaskStatus t={t} />
      </span>
      {t.hint && <span className="text-caption text-ink-500">{t.hint}</span>}
      {t.status !== 'selesai' && (
        <span>
          <Button
            type="button"
            variant="primary"
            disabled={!tasks.enabled(t.id)}
            onClick={() => tasks.run(t.id, true)}
          >
            {t.btn}
          </Button>
        </span>
      )}
      {error && (
        <span role="alert" className="text-caption text-danger">
          {error}
        </span>
      )}
    </div>
  );
}
