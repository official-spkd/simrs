'use client';

import { TaskAct, TaskChoice } from './scenario-task-controls';
import type { ScenarioTasks } from './use-scenario-tasks';

/**
 * Rencana tata laksana pasien skenario di CPOE: tugas langkah Simulasi yang dibawakan layar ini tampil sebagai
 * kontrol asli (pilihan terapi, order set, disposisi, persetujuan). Gerbang CDS dirender di baris order yang
 * diblokir dan tugas kirim (TTE) di tombol kirim, jadi keduanya tidak diulang di sini.
 */
export function CpoeScenarioPanel({
  tasks,
  skip,
}: {
  tasks: ScenarioTasks;
  /** Id tugas yang dirender di tempat lain (gerbang CDS, kirim TTE). */
  skip: readonly string[];
}) {
  const step = tasks.step;
  if (!step) return null;
  const shown = step.tasks.filter((t) => !skip.includes(t.id));
  if (shown.length === 0) return null;
  return (
    <section
      aria-label="Rencana tata laksana"
      className="flex flex-col gap-3.5 rounded-card border border-brand-100 bg-[linear-gradient(100deg,rgba(15,118,110,0.07),#FFFFFF_55%)] px-4 py-3.5 shadow-card"
    >
      <span className="flex flex-col gap-0.5">
        <span className="text-caption font-semibold tracking-[0.04em] text-brand-700">
          RENCANA TATA LAKSANA · {step.actor}
        </span>
        <h2 className="m-0 text-[15px] font-semibold">{step.title}</h2>
        <span className="text-small text-ink-700">{step.desc}</span>
      </span>
      {shown.map((t) =>
        t.kind === 'choice' ? (
          <TaskChoice key={t.id} tasks={tasks} t={t} />
        ) : t.kind === 'act' ? (
          <TaskAct key={t.id} tasks={tasks} t={t} />
        ) : null,
      )}
    </section>
  );
}
