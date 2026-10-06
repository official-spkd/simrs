'use client';

import type { OrCase, OrCaseStatus, OrRoom } from '@simrs/shared';
import { cx } from '@simrs/ui';
import { formatTanggalPendek } from '@/lib/btn';
import { CASE_STATUS_LABEL, ganttBox, minutesLabel, scenarioCaseNote } from '@/lib/btn-ok';

const BLOCK: Record<OrCaseStatus, string> = {
  berjalan: 'border-transparent bg-nav-active text-white shadow-[0_6px_16px_rgba(23,32,46,0.18)]',
  terjadwal:
    'border-brand-200 bg-[linear-gradient(135deg,var(--color-brand-100),var(--color-brand-50))] text-brand-800',
  selesai: 'border-zamrud-200 bg-zamrud-100 text-zamrud-700',
  cito: 'border-koral-200 bg-koral-100 text-koral-800',
};

const SWATCH: Record<OrCaseStatus, string> = {
  berjalan: 'bg-nav-active',
  terjadwal: 'border border-brand-200 bg-brand-100',
  selesai: 'border border-zamrud-200 bg-zamrud-100',
  cito: 'border border-koral-200 bg-koral-100',
};

function blockSub(c: OrCase): string {
  const sub =
    c.status === 'terjadwal' ? `terjadwal ${minutesLabel(c.startMin)} · ${c.statusNote}` : c.statusNote;
  // Pasien skenario berjalan di garis waktu Simulasi: tanggalnya ditampilkan agar jam konfirmasi tidak membingungkan.
  return c.scenarioDate ? `skenario ${formatTanggalPendek(c.scenarioDate)} · ${sub}` : sub;
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
      className="flex flex-col gap-3 rounded-card border border-white/95 bg-white/90 shadow-card p-4"
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
            <div key={room.id} className="grid grid-cols-[112px_1fr] border-t border-line-soft">
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
                        'absolute inset-y-1.5 flex min-h-11 cursor-pointer flex-col justify-center overflow-hidden rounded-[10px] border px-2 text-left font-[inherit] hover:brightness-[1.04]',
                        BLOCK[c.status],
                        selected && 'shadow-[0_0_0_2px_white,0_0_0_4px_var(--color-brand-700)]',
                      )}
                      style={{ left: `${box.left}%`, width: `calc(${box.width}% - 4px)` }}
                    >
                      <span className="truncate text-[12.5px] font-semibold">{c.procedure}</span>
                      <span className="truncate text-[11.5px] opacity-90">{blockSub(c)}</span>
                      <span className="sr-only">
                        , {CASE_STATUS_LABEL[c.status]}, {c.patient.name}, {minutesLabel(c.startMin)}–
                        {minutesLabel(c.startMin + c.durationMin)}
                        {c.scenario ? `, ${scenarioCaseNote(c)}` : ''}
                      </span>
                    </button>
                  );
                })}
                <span
                  aria-hidden="true"
                  className="pointer-events-none absolute inset-y-0 w-0.5 rounded-full bg-koral-600"
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
          <span aria-hidden="true" className="inline-block h-3 w-0.5 bg-koral-600" />
          Garis merah = sekarang {minutesLabel(nowMin)}
        </span>
      </div>
    </section>
  );
}
