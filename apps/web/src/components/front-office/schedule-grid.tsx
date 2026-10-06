import { cx, Icon } from '@simrs/ui';
import type { SlotCellKind, SlotCellView } from '@/lib/front-office';

/** Warna sel jadwal (mockup Jadwal); status juga tertulis di teks/ikon, tidak hanya warna. */
export const SLOT_TONE: Record<SlotCellKind, string> = {
  ok: 'border-brand-200 bg-brand-50 text-brand-700',
  full: 'border-kunyit-200 bg-kunyit-50 text-warning',
  off: 'border-koral-200 bg-koral-50 text-danger',
  sub: 'border-samudra-200 bg-samudra-50 text-info',
  none: 'border-transparent bg-white text-ink-500',
};

export interface ScheduleGridCell extends SlotCellView {
  slotId: string;
  /** Label lengkap untuk pembaca layar: dokter, hari, jam, kuota, status. */
  aria: string;
}

export interface ScheduleGridRow {
  doctorId: string;
  doctorName: string;
  poliName: string;
  cells: ScheduleGridCell[];
}

/** F01 · Grid jadwal mingguan: baris dokter, kolom hari, sel bisa dipilih untuk melihat/mengubah kuota. */
export function ScheduleGrid({
  days,
  rows,
  selected,
  onSelect,
}: {
  days: string[];
  rows: ScheduleGridRow[];
  selected: string | null;
  onSelect: (slotId: string) => void;
}) {
  const cols = { gridTemplateColumns: `minmax(168px, 1.6fr) repeat(${days.length}, minmax(96px, 1fr))` };
  return (
    <section
      aria-label="Grid jadwal"
      className="min-w-0 flex-[999_1_640px] overflow-x-auto rounded-card border border-line bg-white"
    >
      <div className="min-w-fit">
        <div className="grid border-b border-line bg-subtle" style={cols}>
          <span className="px-3.5 py-2.5 text-caption font-semibold text-ink-500">Dokter · poli</span>
          {days.map((d) => (
            <span key={d} className="px-2 py-2.5 text-center text-caption font-semibold text-ink-700">
              {d}
            </span>
          ))}
        </div>
        {rows.map((r) => (
          <div key={r.doctorId} className="grid border-b border-line-soft last:border-b-0" style={cols}>
            <span className="flex flex-col justify-center gap-0.5 px-3.5 py-2">
              <span className="text-small font-semibold text-ink-900">{r.doctorName}</span>
              <span className="text-caption text-ink-500">{r.poliName}</span>
            </span>
            {r.cells.map((c) => {
              const on = selected === c.slotId;
              return (
                <button
                  key={c.slotId}
                  type="button"
                  aria-pressed={on}
                  aria-label={c.aria}
                  onClick={() => onSelect(c.slotId)}
                  className={cx(
                    'm-1.5 flex min-h-12 cursor-pointer flex-col items-start justify-start gap-0.5 rounded-control border p-2 text-left font-[inherit] text-caption',
                    SLOT_TONE[c.kind],
                    on && 'shadow-[0_0_0_2px_var(--color-brand-600)]',
                  )}
                >
                  <span className="font-mono font-semibold">{c.time}</span>
                  <span className="flex items-center gap-1">
                    {c.kind === 'full' && <Icon name="alert" size={12} strokeWidth={2.2} />}
                    {c.note}
                  </span>
                </button>
              );
            })}
          </div>
        ))}
        {rows.length === 0 && (
          <p className="m-0 px-4 py-6 text-small text-ink-700">
            Tidak ada dokter praktik untuk filter ini. Ubah pilihan poli atau hari.
          </p>
        )}
      </div>
    </section>
  );
}

/** Legenda warna sel jadwal (dengan ikon/teks yang sama seperti di sel). */
export function ScheduleLegend() {
  const items: Array<{ kind: SlotCellKind; label: string }> = [
    { kind: 'ok', label: 'Praktik · kuota tersedia' },
    { kind: 'full', label: 'Kuota hampir penuh (≥ 80%) atau penuh' },
    { kind: 'off', label: 'Cuti · pasien perlu dijadwal ulang' },
    { kind: 'sub', label: 'Dokter pengganti' },
  ];
  return (
    <section
      aria-label="Legenda"
      className="flex flex-col gap-2 rounded-card border border-line bg-white p-4"
    >
      <span className="font-semibold">Legenda</span>
      {items.map((i) => (
        <span key={i.kind} className="flex items-center gap-2 text-small text-ink-700">
          <span
            aria-hidden="true"
            className={cx('flex size-5 items-center justify-center rounded-[6px] border', SLOT_TONE[i.kind])}
          >
            {i.kind === 'full' && <Icon name="alert" size={11} strokeWidth={2.4} />}
          </span>
          {i.label}
        </span>
      ))}
    </section>
  );
}
