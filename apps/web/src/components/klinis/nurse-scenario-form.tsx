'use client';

import { Button, cx } from '@simrs/ui';
import { useId, useState } from 'react';
import type { ScenarioTasks } from './use-scenario-tasks';

/** Satu tugas isian skenario (TD, GDS): nilai divalidasi mesin skenario, pesan galat tampil di bawah isian. */
function TaskInput({ tasks, id, unit }: { tasks: ScenarioTasks; id: string; unit: string }) {
  const t = tasks.task(id);
  const fieldId = useId();
  const [value, setValue] = useState(t?.inputDefault ?? '');
  if (!t) return null;
  const done = t.status === 'selesai';
  const error = tasks.errorFor(id);
  return (
    <form
      className="flex flex-col gap-1.5"
      onSubmit={(e) => {
        e.preventDefault();
        tasks.run(id, value);
      }}
    >
      <label htmlFor={fieldId} className="text-small font-semibold text-ink-700">
        {t.label}
      </label>
      {done ? (
        <span className="text-small font-semibold text-success">✓ {t.doneText}</span>
      ) : (
        <span className="flex flex-wrap items-center gap-2">
          <input
            id={fieldId}
            value={value}
            onChange={(e) => setValue(e.target.value)}
            placeholder={t.placeholder}
            disabled={!t.enabled}
            aria-invalid={Boolean(error)}
            aria-describedby={`${fieldId}-msg`}
            inputMode={id === 'gds' ? 'numeric' : 'text'}
            className={cx(
              'h-11 w-40 rounded-control border px-3 font-[inherit] disabled:bg-muted',
              error ? 'border-danger bg-[#FFFBFA]' : 'border-line-strong bg-white',
            )}
          />
          <span className="text-small text-ink-500">{unit}</span>
          <Button type="submit" disabled={!tasks.enabled(id)}>
            Simpan
          </Button>
        </span>
      )}
      <span id={`${fieldId}-msg`} className={cx('text-caption', error ? 'text-danger' : 'text-ink-500')}>
        {error ?? (done ? '' : t.enabled ? t.hint || 'Giliran sekarang.' : 'Menunggu isian sebelumnya.')}
      </span>
    </form>
  );
}

/**
 * Asesmen awal keperawatan Tn. Suryo (langkah Simulasi `asesmen-perawat`): TD, GDS glukometer, skrining risiko
 * jatuh. Isian dikirim sebagai tugas skenario sehingga tanda vital langsung tampil di layar dokter.
 */
export function NurseScenarioForm({ tasks }: { tasks: ScenarioTasks }) {
  const jatuh = tasks.task('jatuh');
  return (
    <div className="flex flex-col gap-3 rounded-control border border-brand-100 bg-[linear-gradient(100deg,rgba(15,118,110,0.06),#FFFFFF_60%)] p-3.5">
      <span className="text-small font-semibold text-brand-700">
        Asesmen awal keperawatan · isian skenario
      </span>
      <div className="grid gap-3 md:grid-cols-2">
        <TaskInput tasks={tasks} id="td" unit="mmHg" />
        <TaskInput tasks={tasks} id="gds" unit="mg/dL" />
      </div>
      {jatuh && (
        <fieldset className="m-0 flex flex-col gap-1.5 border-0 p-0">
          <legend className="mb-1.5 p-0 text-small font-semibold text-ink-700">{jatuh.label}</legend>
          <span className="flex flex-wrap gap-2">
            {jatuh.options.map((o) => (
              <button
                key={o.id}
                type="button"
                aria-pressed={o.selected}
                disabled={!tasks.enabled('jatuh')}
                onClick={() => tasks.run('jatuh', o.id)}
                className={cx(
                  'flex min-h-11 cursor-pointer flex-col items-start rounded-control border px-3 py-1.5 text-left font-[inherit] disabled:cursor-not-allowed',
                  o.selected
                    ? 'border-brand-600 bg-brand-50 font-semibold text-brand-700'
                    : 'border-line-strong bg-white text-ink-900',
                  !o.selected && !jatuh.enabled && 'opacity-60',
                )}
              >
                <span>
                  {o.selected ? '✓ ' : ''}
                  {o.label}
                </span>
                {o.sub && <span className="text-caption text-ink-500">{o.sub}</span>}
              </button>
            ))}
          </span>
          {tasks.errorFor('jatuh') && (
            <span className="text-caption text-danger">{tasks.errorFor('jatuh')}</span>
          )}
        </fieldset>
      )}
    </div>
  );
}
