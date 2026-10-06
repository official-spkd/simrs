'use client';

import { TaskAct, TaskChoice, TaskHandoff } from './scenario-task-controls';
import type { ScenarioTasks } from './use-scenario-tasks';

/** Tugas skenario yang hanya bisa diselesaikan di layar lain (persetujuan tindakan di tablet). */
export interface ScenarioHandoff {
  task: string;
  /** Tautan ke layar penyelesai; null bila layar itu belum tersedia. */
  href: string | null;
  linkLabel: string;
  note: string;
}

/**
 * Rencana tata laksana pasien skenario di CPOE: tugas langkah Simulasi yang dibawakan layar ini tampil sebagai
 * kontrol asli (pilihan terapi, order set, disposisi). Gerbang CDS dirender di baris order yang diblokir dan tugas
 * kirim (TTE) di tombol kirim, jadi keduanya tidak diulang di sini. Persetujuan tindakan TIDAK bisa diselesaikan dari
 * CPOE: hanya status + tautan ke tablet persetujuan (tanda tangan pasien, saksi, lalu TTE dokter).
 */
export function CpoeScenarioPanel({
  tasks,
  skip,
  handoff,
}: {
  tasks: ScenarioTasks;
  /** Id tugas yang dirender di tempat lain (gerbang CDS, kirim TTE). */
  skip: readonly string[];
  handoff: ScenarioHandoff | null;
}) {
  const step = tasks.step;
  if (!step) return null;
  const shown = step.tasks.filter((t) => !skip.includes(t.id));
  if (shown.length === 0) return null;
  return (
    <section
      aria-label="Rencana tata laksana"
      className="flex flex-col gap-3.5 rounded-card border border-brand-200 bg-[linear-gradient(135deg,var(--color-brand-50),var(--color-brand-100))] px-4 py-3.5 shadow-card"
    >
      <span className="flex flex-col gap-0.5">
        <span className="text-caption font-semibold tracking-[0.04em] text-brand-700">
          RENCANA TATA LAKSANA · {step.actor}
        </span>
        <h2 className="m-0 text-[15px] font-semibold">{step.title}</h2>
        <span className="text-small text-ink-700">{step.desc}</span>
      </span>
      {shown.map((t) =>
        handoff && t.id === handoff.task ? (
          <TaskHandoff
            key={t.id}
            t={t}
            href={handoff.href}
            linkLabel={handoff.linkLabel}
            note={handoff.note}
          />
        ) : t.kind === 'choice' ? (
          <TaskChoice key={t.id} tasks={tasks} t={t} />
        ) : t.kind === 'act' ? (
          <TaskAct key={t.id} tasks={tasks} t={t} />
        ) : null,
      )}
    </section>
  );
}
