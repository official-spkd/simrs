import { formatRupiah } from '@simrs/shared';
import { Button, cx } from '@simrs/ui';
import type { PoView } from '@/lib/logistik-toko';
import { formatRupiahShort } from '@/lib/manajemen';

export const PO_STAGES = ['usulan', 'persetujuan', 'PO / e-katalog', 'kirim', 'terima dan cek mutu'] as const;

export type PoStep = 'po.disetujui' | 'po.diterbitkan' | 'po.dikirim';

/**
 * "Pengadaan berjalan" (mockup Logistik): 5 tahap per PO dari toko demo. Tahap 1 Setujui (posisi Manajemen,
 * pengusul ≠ penyetuju), 2 Terbitkan PO, 3 Konfirmasi dikirim pemasok, 4 Terima barang.
 */
export function ProcurementList({
  orders,
  canApprove,
  viewerId,
  pending,
  onStep,
  onReceive,
}: {
  orders: readonly PoView[];
  /** Hanya posisi Manajemen (direktur) yang menyetujui; posisi lain melihat alasannya. */
  canApprove: boolean;
  /** Pengguna sesi: pengusul PO tidak bisa menyetujui usulannya sendiri. */
  viewerId: string;
  pending: boolean;
  onStep: (id: string, step: PoStep) => void;
  /** Tahap "kirim": buka penerimaan barang (PO yang punya baris penerimaan). */
  onReceive: (id: string) => void;
}) {
  return (
    <section
      aria-labelledby="pengadaan-judul"
      className="flex flex-col gap-3 rounded-card border border-white/95 bg-white/90 shadow-card p-4"
    >
      <h2 id="pengadaan-judul" className="m-0 text-[15px] font-semibold">
        Pengadaan berjalan
      </h2>
      <ul className="m-0 flex list-none flex-col gap-3 p-0">
        {orders.map((p) => {
          const stage = p.stage;
          const own = p.by?.userId === viewerId;
          return (
            <li
              key={p.id}
              aria-label={`${p.id} · ${p.title}`}
              className="flex flex-col gap-1.5 border-b border-line-soft pb-3 last:border-0 last:pb-0"
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
                <span
                  aria-live="polite"
                  className={cx(p.doneText ? 'font-semibold text-success' : 'text-ink-700')}
                >
                  {p.doneText ?? p.statusText}
                </span>
                {stage === 1 &&
                  (!canApprove ? (
                    <span className="text-caption text-ink-500">Menunggu persetujuan posisi Manajemen</span>
                  ) : own ? (
                    <span className="text-caption text-warning">
                      Usulan Anda sendiri: penyetuju harus pengguna lain
                    </span>
                  ) : (
                    <Button disabled={pending} onClick={() => onStep(p.id, 'po.disetujui')}>
                      Setujui<span className="sr-only"> {p.id}</span>
                    </Button>
                  ))}
                {stage === 2 && (
                  <Button disabled={pending} onClick={() => onStep(p.id, 'po.diterbitkan')}>
                    Terbitkan PO<span className="sr-only"> {p.id}</span>
                  </Button>
                )}
                {stage === 3 && (
                  <Button disabled={pending} onClick={() => onStep(p.id, 'po.dikirim')}>
                    Konfirmasi dikirim pemasok<span className="sr-only"> {p.id}</span>
                  </Button>
                )}
                {stage === 4 && p.receivable && (
                  <Button disabled={pending} onClick={() => onReceive(p.id)}>
                    Terima barang<span className="sr-only"> {p.id}</span>
                  </Button>
                )}
              </span>
            </li>
          );
        })}
      </ul>
      <span className="text-caption text-ink-500">Tahap: {PO_STAGES.join(' · ')}</span>
    </section>
  );
}
