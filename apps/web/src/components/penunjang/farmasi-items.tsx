import type { PharmacyCdsAlert, PharmacyPrescription } from '@simrs/shared';
import { cx } from '@simrs/ui';
import { formatQty, itemCds, itemSource, stockAfter, stockLow } from '@/lib/penunjang-farmasi';
import { TONE_CHIP } from './lab-worklist';

/**
 * Tabel item resep (mockup Farmasi): obat dengan KFA/Fornas, dosis/rute, frekuensi, jumlah, stok depo, dan level
 * CDS. Pada tahap serah terima, stok menampilkan pengurangan saat obat diserahkan.
 */
export function FarmasiItems({
  rx,
  blocking,
  showDispense,
}: {
  rx: PharmacyPrescription;
  blocking: readonly PharmacyCdsAlert[];
  showDispense: boolean;
}) {
  return (
    <section
      aria-label="Item resep"
      className="overflow-hidden rounded-card border border-white/95 bg-white/90 shadow-card"
    >
      <table className="w-full border-collapse text-small">
        <caption className="sr-only">
          Item resep {rx.no} · {rx.patient.name}
        </caption>
        <thead>
          <tr className="border-b border-line text-left text-caption font-semibold text-ink-500">
            <th scope="col" className="px-4 py-2 font-semibold">
              Obat
            </th>
            <th scope="col" className="hidden px-2 py-2 font-semibold @lg:table-cell">
              Dosis / rute
            </th>
            <th scope="col" className="hidden px-2 py-2 font-semibold @2xl:table-cell">
              Frekuensi
            </th>
            <th scope="col" className="px-2 py-2 font-semibold">
              {showDispense ? 'Stok depo (sesudah)' : 'Stok depo'}
            </th>
            <th scope="col" className="px-2 py-2 pr-4 font-semibold">
              CDS
            </th>
          </tr>
        </thead>
        <tbody>
          {rx.items.map((i) => {
            const cds = itemCds(i, rx.alerts, blocking);
            const after = stockAfter(i);
            const low = stockLow(i, showDispense ? after : i.stock);
            return (
              <tr
                key={i.id}
                className={cx(
                  'border-b border-line-soft align-middle transition-colors',
                  cds.tone === 'danger'
                    ? 'bg-koral-50'
                    : cds.tone === 'warning'
                      ? 'bg-kunyit-50/60'
                      : 'bg-transparent hover:bg-brand-50/60',
                )}
              >
                <th scope="row" className="px-4 py-2.5 text-left font-normal">
                  <span className="flex flex-col">
                    <span className="font-semibold text-ink-900">{i.name}</span>
                    <span className="text-caption text-ink-500">{itemSource(i)}</span>
                    {i.note && <span className="text-caption text-ink-700">{i.note}</span>}
                    <span className="text-caption text-ink-700 @lg:hidden">
                      {i.dose} {i.route} · {i.frequency}
                    </span>
                    <span className="hidden text-caption text-ink-700 @lg:inline @2xl:hidden">
                      {i.frequency}
                    </span>
                    <span className="text-caption text-ink-500">
                      Jumlah {formatQty(i.quantity)} {i.unit}
                    </span>
                  </span>
                </th>
                <td className="hidden px-2 py-2.5 @lg:table-cell">
                  {i.dose} {i.route}
                </td>
                <td className="hidden px-2 py-2.5 @2xl:table-cell">{i.frequency}</td>
                <td className={cx('px-2 py-2.5 font-mono', low ? 'text-kunyit-800' : 'text-ink-900')}>
                  {showDispense ? `${formatQty(i.stock)} → ${formatQty(after)}` : formatQty(i.stock)}
                  {low && (
                    <span className="block font-sans text-[11.5px] font-semibold">di bawah minimum</span>
                  )}
                </td>
                <td className="px-2 py-2.5 pr-4">
                  <span
                    className={cx(
                      'rounded-full px-2 py-0.5 text-[11.5px] font-semibold',
                      TONE_CHIP[cds.tone],
                    )}
                  >
                    {cds.label}
                  </span>
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </section>
  );
}
