'use client';

import type { OrCase, OrCaseStatus, OrRoom } from '@simrs/shared';
import { cx } from '@simrs/ui';
import { CASE_STATUS_LABEL, ganttBox, minutesLabel } from '@/lib/btn-ok';

const BLOCK: Record<OrCaseStatus, string> = {
  berjalan: 'border-brand-800 bg-brand-600 text-white',
  terjadwal: 'border-[#BFDDD8] bg-[#E6F4F1] text-brand-800',
  selesai: 'border-line bg-[#EEF1F4] text-ink-700',
  cito: 'border-[#F0C2BD] bg-danger-bg text-danger',
};

const SWATCH: Record<OrCaseStatus, string> = {
  berjalan: 'bg-brand-600',
  terjadwal: 'border border-[#BFDDD8] bg-[#E6F4F1]',
  selesai: 'bg-[#E3E8EE]',
  cito: 'border border-[#F0C2BD] bg-danger-bg',
};

function blockSub(c: OrCase): string {
  return c.status === 'terjadwal' ? `terjadwal ${minutesLabel(c.startMin)} · ${c.statusNote}` : c.statusNote;
}

/** S06 · Gantt 4 kamar × jam (mockup OK): blok kasus bisa dipilih, garis merah = jam demo sekarang. */
export function OkGantt({
  rooms,
  dayStart,
  dayEnd,
  nowMin,
  selectedId,
  onSelect,
}: {
  rooms: readonly OrRoom[];
  dayStart: number;
  dayEnd: number;
  nowMin: number;
  selectedId: string;
  onSelect: (id: string) => void;
}) {
  const hours: number[] = [];
  for (let m = dayStart; m < dayEnd; m += 60) hours.push(m);
  const nowLeft = ganttBox(nowMin, 0, dayStart, dayEnd).left;
  return (
    <section
      aria-label="Jadwal kamar"
      className="flex flex-col gap-3 rounded-card border border-line bg-white p-4"
    >
      <div className="overflow-x-auto">
        <div className="min-w-[680px]">
          <div className="grid grid-cols-[112px_1fr] pb-1.5 text-caption text-ink-500">
            <span>Kamar</span>
            <span className="relative h-4" aria-hidden="true">
              {hours.map((h) => (
                <span
                  key={h}
                  className="absolute top-0 font-mono"
                  style={{ left: `${ganttBox(h, 0, dayStart, dayEnd).left}%` }}
                >
                  {minutesLabel(h).slice(0, 2)}
                </span>
              ))}
            </span>
          </div>
          {rooms.map((room) => (
            <div key={room.id} className="grid grid-cols-[112px_1fr] border-t border-line">
              <span className="flex flex-col justify-center py-2 pr-2">
                <span className="font-semibold">{room.name}</span>
                <span className="text-caption text-ink-500">{room.kind}</span>
              </span>
              <div className="relative h-16">
                {hours.map((h) => (
                  <span
                    key={h}
                    aria-hidden="true"
                    className="absolute inset-y-0 border-l border-dashed border-line"
                    style={{ left: `${ganttBox(h, 0, dayStart, dayEnd).left}%` }}
                  />
                ))}
                {room.cases.map((c) => {
                  const box = ganttBox(c.startMin, c.durationMin, dayStart, dayEnd);
                  const selected = c.id === selectedId;
                  return (
                    <button
                      key={c.id}
                      type="button"
                      aria-pressed={selected}
                      onClick={() => onSelect(c.id)}
                      title={`Pilih kasus ${room.name}: ${c.procedure}`}
                      className={cx(
                        'absolute inset-y-1.5 flex min-h-11 cursor-pointer flex-col justify-center overflow-hidden rounded-[9px] border px-2 text-left font-[inherit]',
                        BLOCK[c.status],
                        selected && 'shadow-[0_0_0_2px_#FFFFFF,0_0_0_4px_#0B5D56]',
                      )}
                      style={{ left: `${box.left}%`, width: `calc(${box.width}% - 4px)` }}
                    >
                      <span className="truncate text-[12.5px] font-semibold">{c.procedure}</span>
                      <span className="truncate text-[11.5px] opacity-90">{blockSub(c)}</span>
                      <span className="sr-only">
                        , {CASE_STATUS_LABEL[c.status]}, {c.patient.name}, {minutesLabel(c.startMin)}–
                        {minutesLabel(c.startMin + c.durationMin)}
                      </span>
                    </button>
                  );
                })}
                <span
                  aria-hidden="true"
                  className="pointer-events-none absolute inset-y-0 w-0.5 bg-danger"
                  style={{ left: `${nowLeft}%` }}
                />
              </div>
            </div>
          ))}
        </div>
      </div>
      <div className="flex flex-wrap items-center gap-x-4 gap-y-1.5 text-caption text-ink-700">
        {(['berjalan', 'terjadwal', 'selesai', 'cito'] as const).map((s) => (
          <span key={s} className="inline-flex items-center gap-1.5">
            <span aria-hidden="true" className={cx('inline-block size-3 rounded-[3px]', SWATCH[s])} />
            {CASE_STATUS_LABEL[s]}
          </span>
        ))}
        <span className="inline-flex items-center gap-1.5">
          <span aria-hidden="true" className="inline-block h-3 w-0.5 bg-danger" />
          Garis merah = sekarang {minutesLabel(nowMin)}
        </span>
      </div>
    </section>
  );
}
