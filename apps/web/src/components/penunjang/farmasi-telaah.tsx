import { formatJam, type PharmacyCdsAlert } from '@simrs/shared';
import { Button, cx } from '@simrs/ui';
import { telaahChecklist } from '@/lib/penunjang-farmasi';

/** Telaah resep (administratif, farmasetik, klinis) dan keputusan apoteker (mockup Farmasi). */
export function FarmasiTelaah({
  rxId,
  blocking,
  hold,
  partial,
  busy,
  approveReason,
  onApprove,
  onHoldToggle,
  onPartial,
}: {
  rxId: string;
  blocking: readonly PharmacyCdsAlert[];
  hold: string | null;
  partial: string | null;
  busy: boolean;
  /** Alasan tombol "Setujui dan siapkan" nonaktif (CDS terbuka, ditahan, atau belum giliran simulasi). */
  approveReason: string | null;
  onApprove: () => void;
  onHoldToggle: () => void;
  onPartial: () => void;
}) {
  const issues = blocking.length;
  let text = hold
    ? `Resep ditahan sejak ${formatJam(hold)}. Lepas tahanan untuk melanjutkan.`
    : issues
      ? 'Resep tertahan sampai peringatan CDS ditindaklanjuti. Obat lain dapat disiapkan sebagian.'
      : 'Telaah lengkap, tidak ada masalah terbuka. Resep dapat disiapkan.';
  if (partial) text += ` Disiapkan sebagian ${formatJam(partial)} (obat tanpa peringatan).`;
  return (
    <div className="grid grid-cols-1 gap-4 @2xl:grid-cols-[1.3fr_1fr]">
      <section
        aria-label="Telaah resep"
        className="flex flex-col gap-2.5 rounded-card border border-line bg-white px-4 py-3.5"
      >
        <h3 className="m-0 text-body font-semibold">Telaah resep (administratif, farmasetik, klinis)</h3>
        <ul className="m-0 grid list-none grid-cols-1 gap-x-3.5 gap-y-2 p-0 @lg:grid-cols-2">
          {telaahChecklist(blocking).map((t) => (
            <li key={t.text} className="flex gap-2 text-small">
              <span aria-hidden="true" className={cx('font-bold', t.ok ? 'text-success' : 'text-danger')}>
                {t.ok ? '✓' : '!'}
              </span>
              <span className="text-ink-700">
                {t.text}
                <span className="sr-only">{t.ok ? ': sesuai' : ': perlu tindak lanjut'}</span>
              </span>
            </li>
          ))}
        </ul>
      </section>
      <section
        aria-label="Keputusan apoteker"
        className="flex flex-col gap-2.5 rounded-card border border-line bg-white px-4 py-3.5"
      >
        <h3 className="m-0 text-body font-semibold">Keputusan apoteker</h3>
        <p role="status" className="m-0 text-small text-ink-700">
          {text}
        </p>
        <div className="mt-auto flex flex-wrap gap-2">
          {issues > 0 && !hold ? (
            <Button disabled={busy || !!partial} onClick={onPartial}>
              {partial ? 'Sebagian disiapkan' : 'Siapkan sebagian'}
            </Button>
          ) : (
            <Button disabled={busy} onClick={onHoldToggle}>
              {hold ? 'Lepas tahanan' : 'Tahan resep'}
            </Button>
          )}
          <Button
            variant="primary"
            disabled={busy || !!approveReason}
            aria-describedby={approveReason ? `telaah-alasan-${rxId}` : undefined}
            onClick={onApprove}
          >
            Setujui dan siapkan
          </Button>
        </div>
        {approveReason && (
          <span id={`telaah-alasan-${rxId}`} className="text-[12.5px] font-semibold text-warning">
            {approveReason}
          </span>
        )}
      </section>
    </div>
  );
}
