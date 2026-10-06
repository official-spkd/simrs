import type { SlotQuota } from '@simrs/shared';
import { Chip, type ChipTone, cx, Icon } from '@simrs/ui';
import { type QuotaPool, quotaFloor, type SlotCellKind, slotUsage } from '@/lib/front-office';

const STATUS_TONE: Record<SlotCellKind, ChipTone> = {
  ok: 'brand',
  full: 'warning',
  off: 'danger',
  sub: 'info',
  none: 'neutral',
};

export interface SlotDetailView {
  slotId: string;
  doctorName: string;
  poliName: string;
  day: string;
  time: string;
  kind: SlotCellKind;
  status: string;
  quota: SlotQuota | null;
  /** Teks untuk slot tanpa kuota (cuti, pengganti, tidak praktik). */
  text: string;
  dirty: boolean;
}

function Stepper({
  label,
  sub,
  value,
  floor,
  busy,
  onChange,
}: {
  label: string;
  sub: string;
  value: number;
  floor: number;
  busy: boolean;
  onChange: (delta: number) => void;
}) {
  const atFloor = value <= floor;
  const name = label.replace('Kuota', 'kuota');
  return (
    <div className="flex items-center justify-between gap-3">
      <span className="flex flex-col">
        <span className="text-small font-semibold">{label}</span>
        <span className="text-caption text-ink-500">{sub}</span>
      </span>
      <span className="flex items-center gap-1.5">
        <button
          type="button"
          aria-label={`Kurangi ${name}`}
          disabled={atFloor || busy}
          onClick={() => onChange(-1)}
          className="size-11 cursor-pointer rounded-control border border-line-strong bg-white font-[inherit] text-h2 font-semibold text-ink-900 disabled:cursor-not-allowed disabled:bg-muted disabled:text-ink-400"
        >
          −
        </button>
        <span aria-live="polite" className="w-9 text-center font-mono text-h2 font-semibold">
          {value}
        </span>
        <button
          type="button"
          aria-label={`Tambah ${name}`}
          disabled={busy}
          onClick={() => onChange(1)}
          className="size-11 cursor-pointer rounded-control border border-line-strong bg-white font-[inherit] text-h2 font-semibold text-ink-900 disabled:cursor-not-allowed disabled:bg-muted disabled:text-ink-400"
        >
          +
        </button>
      </span>
    </div>
  );
}

/** F01 · Panel detail slot: status, kuota JKN/non-JKN (tidak bisa di bawah booking), tanda belum dikirim ke HFIS. */
export function SlotDetail({
  view,
  onClose,
  onAdjust,
  busy = false,
}: {
  view: SlotDetailView;
  onClose: () => void;
  onAdjust: (pool: QuotaPool, delta: number) => void;
  /** Perubahan kuota sebelumnya masih disimpan (mode presentasi: toko demo). */
  busy?: boolean;
}) {
  const q = view.quota;
  const u = q ? slotUsage(q) : null;
  return (
    <section
      aria-label="Detail slot jadwal"
      className="flex flex-col gap-3 rounded-card border-2 border-brand-600 bg-white p-4"
    >
      <div className="flex items-start justify-between gap-2">
        <span className="flex min-w-0 flex-col">
          <span className="text-caption font-semibold text-ink-500">Slot dipilih</span>
          <span className="font-semibold">{view.doctorName}</span>
          <span className="text-small text-ink-700">
            {view.poliName} · {view.day} · {view.time}
          </span>
        </span>
        <button
          type="button"
          aria-label="Tutup detail slot"
          onClick={onClose}
          className="flex size-11 flex-none cursor-pointer items-center justify-center rounded-control border border-line bg-white text-ink-700"
        >
          <Icon name="x" size={16} />
        </button>
      </div>
      <span>
        <Chip tone={STATUS_TONE[view.kind]}>{view.status}</Chip>
      </span>
      {q && u ? (
        <>
          <Stepper
            label="Kuota JKN"
            sub="Mobile JKN dan loket"
            value={q.jkn}
            floor={quotaFloor(q, 'jkn')}
            busy={busy}
            onChange={(d) => onAdjust('jkn', d)}
          />
          <Stepper
            label="Kuota non-JKN"
            sub="Umum dan asuransi"
            value={q.nonJkn}
            floor={quotaFloor(q, 'nonJkn')}
            busy={busy}
            onChange={(d) => onAdjust('nonJkn', d)}
          />
          <span className="h-2 overflow-hidden rounded-full bg-muted" aria-hidden="true">
            <span
              className={cx(
                'block h-2',
                u.level === 'penuh'
                  ? 'bg-danger'
                  : u.level === 'hampir-penuh'
                    ? 'bg-[#D97706]'
                    : 'bg-brand-600',
              )}
              style={{ width: `${u.percent}%` }}
            />
          </span>
          <span className="text-small text-ink-700">
            {u.used} pasien booking dari {u.total} kuota · {u.percent}% terisi
          </span>
          {q.jkn <= q.bookedJkn && (
            <span className="text-caption text-warning">
              Kuota JKN tidak bisa di bawah jumlah pasien JKN yang sudah booking ({q.bookedJkn}).
            </span>
          )}
          {q.nonJkn <= q.bookedNonJkn && (
            <span className="text-caption text-warning">
              Kuota non-JKN tidak bisa di bawah jumlah pasien non-JKN yang sudah booking ({q.bookedNonJkn}).
            </span>
          )}
          {view.dirty && (
            <span role="status" className="text-caption font-semibold text-warning">
              Perubahan kuota belum dikirim ke HFIS.
            </span>
          )}
        </>
      ) : (
        <span className="text-small text-ink-700">{view.text}</span>
      )}
    </section>
  );
}
