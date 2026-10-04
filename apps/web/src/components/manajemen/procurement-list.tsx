import { formatRupiah, type PurchaseOrder } from '@simrs/shared';
import { Button, cx } from '@simrs/ui';
import { formatRupiahShort } from '@/lib/manajemen';

export const PO_STAGES = ['usulan', 'persetujuan', 'PO / e-katalog', 'kirim', 'terima dan cek mutu'] as const;

export interface ProcurementRow extends PurchaseOrder {
  /** Teks persetujuan lokal ("Disetujui direktur 10.47 · …"), bila ada. */
  approvedText?: string;
}

/** "Pengadaan berjalan" (mockup Logistik): 5 tahap per PO, tombol Setujui untuk tahap usulan. */
export function ProcurementList({
  orders,
  canApprove,
  onApprove,
}: {
  orders: ProcurementRow[];
  /** Hanya posisi Manajemen (direktur) yang menyetujui; posisi lain melihat alasannya. */
  canApprove: boolean;
  onApprove: (id: string) => void;
}) {
  return (
    <section
      aria-labelledby="pengadaan-judul"
      className="flex flex-col gap-3 rounded-card border border-line bg-white p-4"
    >
      <h2 id="pengadaan-judul" className="m-0 text-base font-semibold">
        Pengadaan berjalan
      </h2>
      <ul className="m-0 flex list-none flex-col gap-3 p-0">
        {orders.map((p) => {
          const stage = p.approvedText ? 2 : p.stage;
          return (
            <li
              key={p.id}
              className="flex flex-col gap-1.5 border-b border-[#EEF1F4] pb-3 last:border-0 last:pb-0"
            >
              <span className="flex flex-wrap items-baseline justify-between gap-x-3 text-small">
                <span className="font-medium text-ink-900">
                  {p.id} · {p.title}
                </span>
                <span className="font-mono text-ink-700" title={formatRupiah(BigInt(p.total))}>
                  {formatRupiahShort(BigInt(p.total))}
                </span>
              </span>
              <span
                className="flex gap-1"
                role="img"
                aria-label={`Tahap ${stage} dari 5: ${PO_STAGES[stage - 1]}`}
              >
                {PO_STAGES.map((s, i) => (
                  <span
                    key={s}
                    className={cx('h-1.5 flex-1 rounded-full', i < stage ? 'bg-brand-600' : 'bg-line')}
                  />
                ))}
              </span>
              <span className="flex flex-wrap items-center justify-between gap-2 text-[12.5px]">
                <span className={cx(p.approvedText ? 'font-semibold text-success' : 'text-ink-700')}>
                  {p.approvedText ?? p.statusText}
                </span>
                {stage === 1 &&
                  (canApprove ? (
                    <Button onClick={() => onApprove(p.id)}>Setujui</Button>
                  ) : (
                    <span className="text-caption text-ink-500">Menunggu persetujuan posisi Manajemen</span>
                  ))}
              </span>
            </li>
          );
        })}
      </ul>
      <span className="text-caption text-ink-500">Tahap: {PO_STAGES.join(' · ')}</span>
    </section>
  );
}
