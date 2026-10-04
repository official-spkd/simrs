'use client';

import type { Bed, BedRequest } from '@simrs/shared';
import { Button, Chip, cx } from '@simrs/ui';
import { StatusFlag } from '@/components/klinis/status-flag';
import { BOARDING_LATE_LABEL, formatWait } from '@/lib/rawat-inap';
import type { ScenarioStepState } from '@/lib/rawat-inap-scenario';
import { ScenarioRequestTasks } from './scenario-request';

type RunTask = (s: ScenarioStepState | undefined, task: string, value: true | string) => boolean;

/** Antrean permintaan bed (mockup BedManagement): alokasi ke bed Siap yang dipilih di peta. */
export function BedRequests({
  requests,
  selectedBed,
  message,
  steps,
  pending,
  runTask,
  onAllocate,
  onPickBed,
}: {
  requests: BedRequest[];
  selectedBed: Bed | null;
  message: { ok: boolean; text: string } | null;
  steps: Partial<Record<'igd-ranap' | 'elektif-btn', ScenarioStepState>>;
  pending: boolean;
  runTask: RunTask;
  onAllocate: (r: BedRequest) => void;
  onPickBed: (code: string) => void;
}) {
  const free = selectedBed?.status === 'siap' ? selectedBed : null;
  return (
    <section aria-label="Permintaan bed" className="overflow-hidden rounded-card border border-line bg-white">
      <div className="flex justify-between border-b border-line px-4 py-3.5">
        <h2 className="m-0 text-body font-semibold">Permintaan bed</h2>
        <span className="text-caption text-ink-500">{requests.length} menunggu</span>
      </div>
      {message && (
        <div
          role="status"
          className={cx(
            'border-b border-line-soft px-4 py-2.5 text-[12.5px] font-semibold',
            message.ok ? 'bg-success-bg text-success' : 'bg-warning-bg text-warning',
          )}
        >
          {message.text}
        </div>
      )}
      <ul className="m-0 list-none p-0">
        {requests.map((r) => {
          const short = r.patientName.split(' ').slice(0, 2).join(' ');
          const st = r.scenario ? steps[r.scenario] : undefined;
          return (
            <li
              key={r.id}
              className={cx(
                'flex flex-col gap-1.5 border-b border-line-soft px-4 py-3',
                r.late ? 'bg-[#FFFBFA]' : r.scenario ? 'bg-[#FBFDFC]' : 'bg-white',
              )}
            >
              <span className="flex flex-wrap items-start justify-between gap-x-2 gap-y-1">
                <span className="font-semibold">
                  {r.patientName} · {r.sex} {r.ageYears}
                </span>
                <span className="flex flex-wrap items-center justify-end gap-1.5">
                  <span
                    className={cx(
                      'font-mono text-caption font-semibold',
                      r.late ? 'text-danger' : 'text-ink-700',
                    )}
                  >
                    {formatWait(r.waitMinutes)}
                  </span>
                  {r.late && <StatusFlag icon="clock">{BOARDING_LATE_LABEL}</StatusFlag>}
                </span>
              </span>
              <span className="text-caption text-ink-700">
                {r.from} · {r.need}
              </span>
              {r.scenario && <Chip tone="brand">Pasien simulasi · RM {r.rm}</Chip>}
              {r.candidates.length > 0 && (
                <span className="flex flex-wrap items-center gap-1.5 text-caption font-semibold text-brand-700">
                  Cocok:
                  {r.candidates.map((c) => (
                    <button
                      key={c.bedCode}
                      type="button"
                      onClick={() => onPickBed(c.bedCode)}
                      aria-label={`Tampilkan bed ${c.bedCode} di peta (${c.note})`}
                      className="min-h-9 cursor-pointer rounded-full border border-brand-200 bg-white px-2.5 font-[inherit] text-caption font-semibold text-brand-700"
                    >
                      {c.bedCode}
                    </button>
                  ))}
                </span>
              )}
              {st && !st.active && (
                <span className="text-caption text-ink-500">
                  Langkah admisi belum aktif di Simulasi; tombol aktif saat gilirannya.
                </span>
              )}
              {st ? (
                <ScenarioRequestTasks state={st} pending={pending} runTask={runTask} />
              ) : r.scenario ? (
                <span className="text-caption text-ink-500">
                  Menunggu giliran langkah admisi di Simulasi.
                </span>
              ) : (
                <Button
                  size="sm"
                  variant={free ? 'primary' : 'secondary'}
                  className="h-11 self-end"
                  aria-label={
                    free
                      ? `Alokasikan ${short} ke bed ${free.code}`
                      : `Alokasikan ${short} (pilih bed Siap dulu)`
                  }
                  onClick={() => onAllocate(r)}
                >
                  {free ? `Alokasikan ke ${free.code}` : 'Alokasikan'}
                </Button>
              )}
            </li>
          );
        })}
      </ul>
      {requests.length === 0 && (
        <p className="m-0 px-4 py-3.5 text-small text-ink-500">Semua permintaan sudah dialokasikan.</p>
      )}
    </section>
  );
}
