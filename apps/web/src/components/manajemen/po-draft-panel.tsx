import { formatRupiah, type PurchaseOrderDraft } from '@simrs/shared';
import { Button, Chip } from '@simrs/ui';
import { CHANNEL_LABEL, formatNumber } from '@/lib/manajemen';

/** Draf usulan PO dari item terpilih (B01): baris, subtotal, total bigint, lalu ajukan ke direktur. */
export function PoDraftPanel({
  draft,
  pending,
  onCancel,
  onSubmit,
}: {
  draft: PurchaseOrderDraft;
  pending: boolean;
  onCancel: () => void;
  onSubmit: () => void;
}) {
  return (
    <section
      aria-labelledby="po-draf-judul"
      className="flex flex-col gap-3 rounded-card border border-brand-600 bg-white/90 p-4 shadow-[0_0_0_1px_var(--color-brand-600),0_10px_30px_rgba(23,32,46,0.07)]"
    >
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h2 id="po-draf-judul" className="m-0 text-[15px] font-semibold">
          Draf usulan {draft.number}
        </h2>
        {draft.urgent ? (
          <Chip tone="danger">Mendesak · ada stok kritis</Chip>
        ) : (
          <Chip tone="neutral">Rutin</Chip>
        )}
      </div>
      <ul className="m-0 flex list-none flex-col p-0">
        {draft.lines.map((l) => (
          <li
            key={l.itemId}
            className="flex flex-wrap items-baseline justify-between gap-x-4 gap-y-0.5 border-b border-line-soft py-2 text-small"
          >
            <span className="flex min-w-0 flex-[1_1_220px] flex-col">
              <span className="font-medium text-ink-900">{l.name}</span>
              <span className="text-caption text-ink-500">
                {formatNumber(l.qty)} {l.unit} × {formatRupiah(BigInt(l.unitPrice))} ·{' '}
                {CHANNEL_LABEL[l.channel]} · {l.supplier}
              </span>
            </span>
            <span className="font-mono font-semibold text-ink-900">{formatRupiah(BigInt(l.subtotal))}</span>
          </li>
        ))}
      </ul>
      <div className="flex flex-wrap items-center justify-between gap-3">
        <span className="text-small text-ink-700">
          Total {draft.lines.length} item:{' '}
          <span className="font-mono text-base font-semibold text-ink-900">
            {formatRupiah(BigInt(draft.total))}
          </span>
        </span>
        <span className="flex flex-wrap gap-2">
          <Button onClick={onCancel} disabled={pending}>
            Batal
          </Button>
          <Button variant="primary" onClick={onSubmit} disabled={pending}>
            {pending ? 'Mengajukan…' : 'Ajukan ke direktur'}
          </Button>
        </span>
      </div>
      <span className="text-caption text-ink-500">
        Tahap berikutnya: persetujuan direktur → PO / e-katalog → kirim → terima dan cek mutu.
      </span>
    </section>
  );
}
