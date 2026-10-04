'use client';

import { Button, cx } from '@simrs/ui';
import { taskDone, taskEnabled } from '@/components/rawat-inap/use-scenario-task';
import type { ScenarioStepState } from '@/lib/rawat-inap-scenario';

/** Lompatan hari perawatan pasien skenario (naskah Simulasi; label sama dengan tugasnya). */
const DAYS: Record<string, { label: string; btn: string; done: string }> = {
  h1: {
    label: 'Hari 1: kalium turun ke 5,1, nyeri dada hilang',
    btn: 'Lompat ke hari 1 pagi',
    done: 'CPPT dokter dan perawat, co-sign DPJP',
  },
  echo: {
    label: 'Hari 2: ekokardiografi, rawat bersama Sp.JP',
    btn: 'Lompat ke hari 2',
    done: 'EF 48%, hipokinetik anterior',
  },
  pindah: {
    label: 'Hari 3: pindah ke bangsal kelas 1 (step-down)',
    btn: 'Lompat ke hari 3',
    done: 'Pindah ke Anggrek A-12',
  },
  akhir: {
    label: 'Hari 4: stabil, rencana pulang besok',
    btn: 'Lompat ke hari 4',
    done: 'Rencana pulang dan edukasi dimulai',
  },
  h2: {
    label: 'Hari berikutnya: mobilisasi, diet lunak, nyeri terkontrol',
    btn: 'Lompat ke esok hari',
    done: 'Layak pulang besok pagi',
  },
};

/** Kartu "Perjalanan rawat" pasien skenario: pemberian obat pertama lalu lompat antarhari. */
export function DayJumps({
  state,
  pending,
  runTask,
}: {
  state: ScenarioStepState;
  pending: boolean;
  runTask: (s: ScenarioStepState, task: string, value: true) => boolean;
}) {
  const days = Object.keys(DAYS).filter((k) => state.tasks[k]?.visible);
  const emarDone = taskDone(state, 'emar');
  return (
    <section
      aria-label="Perjalanan rawat (simulasi)"
      className="flex flex-col gap-2.5 rounded-card border border-[#9FCFC8] bg-[linear-gradient(100deg,rgba(15,118,110,0.06),#FFFFFF_60%)] px-4 py-3"
    >
      <span className="flex flex-wrap items-baseline justify-between gap-2">
        <span className="font-semibold text-brand-700">Perjalanan rawat · pasien simulasi</span>
        <span className="text-caption text-ink-700">
          {emarDone
            ? 'Obat jadwal pertama tercatat per dosis lewat pindai gelang dan label obat.'
            : 'Mulai di eMAR (tab CPPT & eMAR): pindai gelang, lalu beri tiap dosis jadwal pertama satu per satu.'}
        </span>
      </span>
      <ol className="m-0 grid list-none grid-cols-1 gap-2 p-0 md:grid-cols-2">
        {days.map((k) => {
          const d = DAYS[k];
          if (!d) return null;
          const done = taskDone(state, k);
          return (
            <li
              key={k}
              className={cx(
                'flex flex-wrap items-center justify-between gap-2 rounded-control border px-3 py-2',
                done ? 'border-success-border bg-white' : 'border-line bg-white',
              )}
            >
              <span className="flex min-w-0 flex-1 flex-col">
                <span className={cx('text-small font-semibold', done && 'text-success')}>
                  {done ? '✓ ' : ''}
                  {d.label}
                </span>
                {done && <span className="text-caption text-ink-700">{d.done}</span>}
              </span>
              {!done && (
                <Button
                  size="sm"
                  variant={taskEnabled(state, k) ? 'primary' : 'secondary'}
                  disabled={!taskEnabled(state, k) || pending}
                  onClick={() => runTask(state, k, true)}
                >
                  {d.btn}
                </Button>
              )}
            </li>
          );
        })}
      </ol>
    </section>
  );
}
