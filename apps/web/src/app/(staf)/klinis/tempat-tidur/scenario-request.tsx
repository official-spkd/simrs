'use client';

import { Button, cx } from '@simrs/ui';
import { taskDone, taskEnabled } from '@/components/rawat-inap/use-scenario-task';
import type { ScenarioStepState } from '@/lib/rawat-inap-scenario';

type RunTask = (s: ScenarioStepState | undefined, task: string, value: true | string) => boolean;

interface ActStep {
  task: string;
  label: string;
  btn: string;
  done: string;
}

/** Alur admisi per skenario (urutan = urutan tugas di naskah Simulasi). */
const FLOW: Record<'igd-ranap' | 'elektif-btn', ActStep[]> = {
  'igd-ranap': [
    {
      task: 'bpjs',
      label: 'Cek kepesertaan BPJS',
      btn: 'Cek ke VClaim',
      done: 'Peserta aktif · PPU kelas 1',
    },
    { task: 'alok', label: 'Alokasikan tempat tidur', btn: '', done: '' },
    {
      task: 'sep',
      label: 'Terbitkan SPRI dan SEP rawat inap',
      btn: 'Terbitkan SEP',
      done: 'SEP 0301R0011026V004988',
    },
    {
      task: 'transfer',
      label: 'Transfer dan serah terima SBAR',
      btn: 'Serah terima',
      done: 'Pasien tiba di ruang rawat',
    },
  ],
  'elektif-btn': [
    { task: 'cek', label: 'Cek kepesertaan BPJS', btn: 'Cek ke VClaim', done: 'Aktif · PPU kelas 2' },
    { task: 'kelas', label: 'Kelas perawatan yang diminta pasien', btn: '', done: '' },
    {
      task: 'setuju',
      label: 'Persetujuan selisih biaya naik kelas (estimasi Rp 9.400.000, angka simulasi)',
      btn: 'Tanda tangani persetujuan',
      done: 'Ditandatangani pasien dan petugas (TTE)',
    },
    {
      task: 'sep',
      label: 'Terbitkan SPRI dan SEP rawat inap',
      btn: 'Terbitkan SEP',
      done: 'SEP 0301R0011026V005377',
    },
  ],
};

const CHOICE_DONE: Record<string, (v: string) => string> = {
  alok: (v) => `Bed ${v} dipesan`,
  kelas: (v) => (v === 'vip' ? 'Naik kelas VIP · Paviliun VIP 3' : 'Sesuai hak kelas 2 · Melati M-210'),
};

/** Tugas admisi pasien skenario di kartu permintaan bed (tombol asli layar memajukan Simulasi). */
export function ScenarioRequestTasks({
  state,
  pending,
  runTask,
}: {
  state: ScenarioStepState;
  pending: boolean;
  runTask: RunTask;
}) {
  const flow = FLOW[state.scenario as keyof typeof FLOW] ?? [];
  return (
    <ol className="m-0 flex list-none flex-col gap-2 p-0" aria-label="Tugas admisi">
      {flow
        .filter((f) => state.tasks[f.task]?.visible)
        .map((f, i) => {
          const t = state.tasks[f.task];
          const done = taskDone(state, f.task);
          const enabled = taskEnabled(state, f.task) && !pending;
          return (
            <li key={f.task} className="flex flex-col gap-1.5">
              <span className={cx('text-caption font-semibold', done ? 'text-success' : 'text-ink-700')}>
                {done ? '✓' : `${i + 1}.`} {f.label}
              </span>
              {done ? (
                <span className="text-caption text-ink-700">
                  {CHOICE_DONE[f.task]?.(t?.value ?? '') ?? f.done}
                </span>
              ) : t?.options.length ? (
                <span className="grid grid-cols-1 gap-1.5 sm:grid-cols-2">
                  {t.options.map((o) => (
                    <Button
                      key={o.id}
                      size="sm"
                      variant={enabled ? 'primary' : 'secondary'}
                      disabled={!enabled}
                      onClick={() => runTask(state, f.task, o.id)}
                      className="h-auto min-h-11 flex-col gap-0 py-1.5 text-caption"
                    >
                      <span className="font-semibold">{o.label}</span>
                      {o.sub && <span className="font-normal opacity-90">{o.sub}</span>}
                    </Button>
                  ))}
                </span>
              ) : (
                <Button
                  size="sm"
                  className="h-11 self-start"
                  variant={enabled ? 'primary' : 'secondary'}
                  disabled={!enabled}
                  onClick={() => runTask(state, f.task, true)}
                >
                  {f.btn}
                </Button>
              )}
            </li>
          );
        })}
    </ol>
  );
}
