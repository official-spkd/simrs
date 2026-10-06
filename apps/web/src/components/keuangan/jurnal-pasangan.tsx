import { cx } from '@simrs/ui';
import { type DrafJurnal, jurnalSeimbang, totalJurnal } from '@/lib/keuangan-jurnal';

const num = (v: bigint) => v.toString().replace(/\B(?=(\d{3})+(?!\d))/g, '.');

/**
 * Jurnal berpasangan ringkas (mutasi uang di layar keuangan lanjutan): akun, debit, kredit, total, dan status
 * seimbang dalam teks (bukan hanya warna). `status` = keterangan posting, mis. "Terposting 10.52" atau "Draf".
 */
export function JurnalPasangan({
  jurnal,
  status,
  className,
}: {
  jurnal: DrafJurnal;
  status?: string;
  className?: string;
}) {
  const t = totalJurnal(jurnal.lines);
  const ok = jurnalSeimbang(jurnal.lines);
  return (
    <figure
      className={cx(
        'm-0 flex flex-col gap-1.5 rounded-control border border-line bg-subtle p-3',
        className,
      )}
    >
      <figcaption className="flex flex-wrap items-baseline justify-between gap-2 text-small">
        <span className="font-semibold text-ink-900">Jurnal · {jurnal.memo}</span>
        {status && <span className="text-caption text-ink-500">{status}</span>}
      </figcaption>
      <div className="overflow-x-auto">
        <table className="w-full border-collapse text-[12.5px] [&_td+td]:pl-2 [&_td+td]:whitespace-nowrap">
          <caption className="sr-only">Debit dan kredit dalam rupiah</caption>
          <thead>
            <tr className="text-left text-caption text-ink-500">
              <th scope="col" className="py-1 font-semibold">
                Akun
              </th>
              <th scope="col" className="py-1 text-right font-semibold">
                Debit (Rp)
              </th>
              <th scope="col" className="py-1 text-right font-semibold">
                Kredit (Rp)
              </th>
            </tr>
          </thead>
          <tbody>
            {jurnal.lines.map((l, i) => (
              <tr key={`${l.account.code}-${i}`} className="border-t border-line">
                <td className={cx('py-1 pr-2', l.credit > 0n && 'pl-5')}>
                  <span className="font-mono text-caption text-ink-500">{l.account.code}</span>{' '}
                  {l.account.name}
                </td>
                <td className="py-1 text-right font-mono">{l.debit > 0n ? num(l.debit) : ''}</td>
                <td className="py-1 text-right font-mono">{l.credit > 0n ? num(l.credit) : ''}</td>
              </tr>
            ))}
          </tbody>
          <tfoot>
            <tr className="border-t border-line-strong">
              <td className={cx('py-1 font-semibold', ok ? 'text-success' : 'text-danger')}>
                {ok ? '✓ Seimbang (debit = kredit)' : '✗ Tidak seimbang'}
              </td>
              <td className="py-1 text-right font-mono font-semibold" data-total-debit={t.debit.toString()}>
                {num(t.debit)}
              </td>
              <td className="py-1 text-right font-mono font-semibold" data-total-credit={t.credit.toString()}>
                {num(t.credit)}
              </td>
            </tr>
          </tfoot>
        </table>
      </div>
    </figure>
  );
}
