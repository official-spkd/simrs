'use client';

import { Button, Field } from '@simrs/ui';
import { type ChangeEvent, useState } from 'react';
import { taskDone, taskEnabled } from '@/components/rawat-inap/use-scenario-task';
import type { ScenarioStepState } from '@/lib/rawat-inap-scenario';

type RunTask = (s: ScenarioStepState | undefined, task: string, value: true | string) => boolean;

/** Kedatangan pasien skenario: identifikasi MPI lalu gelang identitas (langkah `kedatangan`). */
export function IdentifyBlock({
  kd,
  rm,
  history,
  pending,
  runTask,
}: {
  kd: ScenarioStepState | undefined;
  rm: string | null;
  history: string;
  pending: boolean;
  runTask: RunTask;
}) {
  const idDone = taskDone(kd, 'id');
  const options = kd?.tasks.id?.options ?? [];
  return (
    <div className="flex flex-col gap-2 rounded-control border border-samudra-200 bg-alert-info p-3">
      <span className="text-small font-semibold text-info">Identifikasi pasien sebelum triase</span>
      {idDone ? (
        <span role="status" className="text-small text-ink-700">
          ✓ Ditemukan di MPI · RM <span className="font-mono">{rm}</span> · {history}
        </span>
      ) : (
        <div className="grid grid-cols-2 gap-2">
          {options.map((o) => (
            <Button
              key={o.id}
              variant="secondary"
              disabled={!taskEnabled(kd, 'id') || pending}
              onClick={() => runTask(kd, 'id', o.id)}
              className="h-auto min-h-11 flex-col gap-0 py-1.5 text-small"
            >
              <span className="font-semibold">{o.label}</span>
              {o.sub && <span className="text-caption font-normal text-ink-500">{o.sub}</span>}
            </Button>
          ))}
        </div>
      )}
      <Button
        variant="primary"
        disabled={!taskEnabled(kd, 'gelang') || pending}
        onClick={() => runTask(kd, 'gelang', true)}
      >
        Pasang gelang dan buka kunjungan IGD
      </Button>
      {!idDone && (
        <span className="text-caption text-ink-700">Gelang dicetak setelah identitas cocok di MPI.</span>
      )}
    </div>
  );
}

/** Tanda vital triase pasien skenario (tugas `triase.ttv`). */
export function VitalsEntry({
  tr,
  pending,
  runTask,
}: {
  tr: ScenarioStepState | undefined;
  pending: boolean;
  runTask: RunTask;
}) {
  const [v, setV] = useState({ td: '158/94', hr: '112', rr: '24', spo2: '94%' });
  const enabled = taskEnabled(tr, 'ttv');
  const set = (k: keyof typeof v) => (e: ChangeEvent<HTMLInputElement>) =>
    setV((cur) => ({ ...cur, [k]: e.target.value }));
  const complete = Object.values(v).every((x) => x.trim().length > 0);
  return (
    <form
      aria-label="Tanda vital triase"
      className="flex flex-col gap-2 rounded-control border border-line bg-subtle p-3"
      onSubmit={(e) => {
        e.preventDefault();
        if (complete)
          runTask(tr, 'ttv', `${v.td.trim()} · ${v.hr.trim()} · ${v.rr.trim()} · ${v.spo2.trim()}`);
      }}
    >
      <span className="text-small font-semibold">Tanda vital triase</span>
      <div className="grid grid-cols-2 gap-2">
        <Field label="TD (mmHg)" value={v.td} onChange={set('td')} inputMode="numeric" />
        <Field label="Nadi (x/mnt)" value={v.hr} onChange={set('hr')} inputMode="numeric" />
        <Field label="Napas (x/mnt)" value={v.rr} onChange={set('rr')} inputMode="numeric" />
        <Field label="SpO2" value={v.spo2} onChange={set('spo2')} />
      </div>
      <Button type="submit" variant="primary" disabled={!enabled || !complete || pending}>
        Simpan tanda vital
      </Button>
      {!enabled && (
        <span className="text-caption text-ink-700">
          Pasang gelang identitas dulu; tanda vital dicatat setelah itu.
        </span>
      )}
    </form>
  );
}
