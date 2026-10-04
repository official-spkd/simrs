import type { InventoryItem } from '@simrs/shared';
import { Chip, cx } from '@simrs/ui';
import { CHANNEL_LABEL, coverLevel, formatDays, formatNumber } from '@/lib/manajemen';

const DRUG_KINDS = new Set<InventoryItem['kind']>(['obat', 'cairan', 'vaksin']);

/** "High alert · Fornas · KFA 93002210", "BHP kamar operasi · non-obat". */
export function itemMeta(i: InventoryItem): string {
  const code = DRUG_KINDS.has(i.kind) ? (i.kfa ? `KFA ${i.kfa}` : 'KFA belum dipetakan') : 'non-obat';
  return `${i.note} · ${code}`;
}

export function suggestionText(i: InventoryItem): string {
  return `${CHANNEL_LABEL[i.channel]} ${formatNumber(i.suggestedQty)} ${i.unit} · ${i.supplier}`;
}

function Cover({ days }: { days: number }) {
  return coverLevel(days) === 'kritis' ? (
    <Chip tone="danger">Kritis · {formatDays(days)}</Chip>
  ) : (
    <span className="font-mono font-semibold text-warning">{formatDays(days)}</span>
  );
}

/**
 * Satu baris "item di bawah titik pesan ulang" (mockup Logistik). Seluruh baris adalah label kotak centang
 * (target sentuh besar); di layar sempit kolom dirangkum di bawah nama item.
 */
export function ReorderRow({
  item,
  checked,
  inPo,
  onToggle,
}: {
  item: InventoryItem;
  checked: boolean;
  /** Nomor PO bila item sudah masuk usulan (baris terkunci). */
  inPo: string | null;
  onToggle: () => void;
}) {
  const critical = coverLevel(item.daysOfCover) === 'kritis';
  return (
    <label
      className={cx(
        'grid grid-cols-[44px_minmax(0,1fr)] items-center gap-x-2 border-b border-[#EEF1F4] pr-4 text-small xl:grid-cols-[44px_minmax(0,2.2fr)_64px_minmax(0,1fr)_72px_120px_minmax(0,1.7fr)]',
        inPo ? 'cursor-default bg-[#F8FAFB]' : 'cursor-pointer',
        !inPo && critical && 'bg-[#FFF8F7]',
      )}
    >
      <span className="flex h-11 items-center justify-center self-start xl:self-center">
        <input
          type="checkbox"
          checked={checked}
          disabled={inPo !== null}
          onChange={onToggle}
          aria-label={`Masukkan ${item.name} ke usulan PO`}
          className="h-4 w-4 accent-brand-600"
        />
      </span>
      <span className="flex min-w-0 flex-col gap-0.5 py-2">
        <span className="font-medium text-ink-900">{item.name}</span>
        <span className="text-caption text-ink-500">{itemMeta(item)}</span>
        <span className="flex flex-wrap items-center gap-x-3 gap-y-1 text-[12.5px] text-ink-700 xl:hidden">
          <span>
            Kelas {item.abc} · {item.ven}
          </span>
          <span>
            Stok {formatNumber(item.stock)} {item.unit} · ROP {formatNumber(item.reorderPoint)}
          </span>
          <Cover days={item.daysOfCover} />
          <span className={cx(inPo && 'font-semibold text-success')}>
            {inPo ? `Masuk ${inPo}` : `Usulan: ${suggestionText(item)}`}
          </span>
        </span>
      </span>
      <span className="hidden font-mono xl:block">
        {item.abc} · {item.ven}
      </span>
      <span className="hidden font-mono xl:block">
        {formatNumber(item.stock)} <span className="font-sans text-caption text-ink-500">{item.unit}</span>
      </span>
      <span className="hidden font-mono xl:block">{formatNumber(item.reorderPoint)}</span>
      <span className="hidden xl:block">
        <Cover days={item.daysOfCover} />
      </span>
      <span className={cx('hidden xl:block', inPo ? 'font-semibold text-success' : 'text-ink-700')}>
        {inPo ? `Masuk ${inPo}` : suggestionText(item)}
      </span>
    </label>
  );
}
