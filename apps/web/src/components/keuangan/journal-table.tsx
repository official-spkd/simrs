'use client';

import {
  formatTanggalWaktu,
  JOURNAL_SOURCES,
  type JournalEntry,
  type JournalSource,
  journalBalanced,
} from '@simrs/shared';
import { Chip, cx, FilterChip } from '@simrs/ui';
import { type ReactNode, useState } from 'react';
import { JOURNAL_SOURCE_LABEL, JOURNAL_STATUS_VIEW, journalTotals } from '@/lib/keuangan-akuntansi';

const num = (v: bigint) => v.toString().replace(/\B(?=(\d{3})+(?!\d))/g, '.');
const TD = 'py-1.5 align-top';

/**
 * Jurnal otomatis (mockup Akuntansi): dibentuk dari event transaksi, difilter per sumber. Setiap jurnal
 * menampilkan jumlah debit dan kredit serta status seimbang dalam teks.
 */
export function JournalTable({
  journals,
  journalCount,
  footer,
}: {
  journals: readonly JournalEntry[];
  journalCount: number;
  /** Panel di bawah tabel (pemetaan akun). */
  footer?: ReactNode;
}) {
  const [src, setSrc] = useState<JournalSource | 'semua'>('semua');
  const shown = src === 'semua' ? journals : journals.filter((j) => j.source === src);
  const review = journals.filter((j) => j.status !== 'terposting').length;
  return (
    <section
      aria-label="Jurnal otomatis"
      className="@container flex min-w-0 flex-[999_1_600px] flex-col overflow-hidden rounded-card border border-line bg-white"
    >
      <div className="flex flex-wrap items-center justify-between gap-2.5 border-b border-line px-4 py-3">
        <span className="flex flex-col">
          <span className="font-semibold">Jurnal otomatis periode berjalan</span>
          <span className="text-[12.5px] text-ink-500">
            Dibentuk dari event transaksi: kasir, klaim, TPDI/BTN, logistik
          </span>
        </span>
        <span aria-live="polite" className="text-[12.5px] text-ink-700">
          {src === 'semua'
            ? `${journalCount.toLocaleString('id-ID')} jurnal · ${review} perlu tinjauan`
            : `menampilkan ${shown.length} jurnal ${JOURNAL_SOURCE_LABEL[src]} · ${review} perlu tinjauan`}
        </span>
      </div>
      <div
        role="group"
        aria-label="Filter sumber jurnal"
        className="flex flex-wrap items-center gap-1.5 border-b border-line px-4 py-2"
      >
        <span className="mr-1 text-caption text-ink-500">Sumber</span>
        <FilterChip selected={src === 'semua'} onClick={() => setSrc('semua')}>
          Semua
        </FilterChip>
        {JOURNAL_SOURCES.map((s) => (
          <FilterChip key={s} selected={src === s} onClick={() => setSrc(s)}>
            {JOURNAL_SOURCE_LABEL[s]} ({journals.filter((j) => j.source === s).length})
          </FilterChip>
        ))}
      </div>
      <div className="overflow-x-auto">
        <table className="w-full border-collapse text-[13px] @2xl:min-w-[620px]">
          <thead>
            <tr className="bg-subtle text-left text-caption text-ink-500">
              <th scope="col" className="hidden px-4 py-2 font-semibold @2xl:table-cell">
                No. · sumber
              </th>
              <th scope="col" className="py-2 pl-4 font-semibold @2xl:pl-0">
                Akun
              </th>
              <th scope="col" className="py-2 text-right font-semibold">
                Debit
              </th>
              <th scope="col" className="py-2 pr-4 text-right font-semibold">
                Kredit
              </th>
            </tr>
          </thead>
          {shown.map((j) => {
            const t = journalTotals(j.lines);
            const st = JOURNAL_STATUS_VIEW[j.status];
            const ok = journalBalanced(j.lines);
            const meta = (
              <span className="flex flex-col gap-0.5">
                <span className="font-mono text-ink-500">{j.number}</span>
                <span className="text-ink-700">
                  {JOURNAL_SOURCE_LABEL[j.source]} · {j.reference}
                </span>
                <span className="text-caption text-ink-500">{formatTanggalWaktu(j.date)}</span>
                <span className="text-caption text-ink-500">{j.description}</span>
                <span className="flex flex-wrap gap-1 pt-0.5">
                  <Chip tone={st.tone}>{st.label}</Chip>
                  {j.scenario && <Chip tone="info">Simulasi</Chip>}
                </span>
              </span>
            );
            return (
              <tbody key={j.id} data-journal={j.number} className="border-t border-line">
                {/* Wadah sempit (tablet): identitas jurnal di baris sendiri di atas baris akun. */}
                <tr className="@2xl:hidden">
                  <td colSpan={3} className="px-4 pt-2 pb-1 align-top">
                    {meta}
                  </td>
                </tr>
                {j.lines.map((l, i) => {
                  const d = BigInt(l.debit);
                  const c = BigInt(l.credit);
                  return (
                    <tr key={`${j.id}-${i}`} className={cx(!l.account && 'bg-kunyit-50')}>
                      {i === 0 && (
                        <td
                          rowSpan={j.lines.length + 1}
                          className="hidden w-[36%] px-4 py-2 align-top @2xl:table-cell"
                        >
                          {meta}
                        </td>
                      )}
                      <td className={cx(TD, 'pr-2', c > 0n ? 'pl-8 @2xl:pl-5' : 'pl-4 @2xl:pl-0')}>
                        {l.account ? (
                          <>
                            <span className="font-mono text-caption text-ink-500">{l.account.code}</span>{' '}
                            {l.account.name}
                          </>
                        ) : (
                          <span className="font-semibold text-warning">(akun lawan belum dipetakan)</span>
                        )}
                      </td>
                      <td className={cx(TD, 'text-right font-mono')}>{d > 0n ? num(d) : ''}</td>
                      <td className={cx(TD, 'pr-4 text-right font-mono')}>{c > 0n ? num(c) : ''}</td>
                    </tr>
                  );
                })}
                <tr className="text-caption">
                  <td className={cx(TD, 'pl-4 font-semibold @2xl:pl-0', ok ? 'text-success' : 'text-danger')}>
                    {ok ? '✓ Seimbang (debit = kredit)' : '✗ Tidak seimbang'}
                  </td>
                  <td
                    className={cx(TD, 'text-right font-mono font-semibold')}
                    data-total-debit={t.debit.toString()}
                  >
                    {num(t.debit)}
                  </td>
                  <td
                    className={cx(TD, 'pr-4 text-right font-mono font-semibold')}
                    data-total-credit={t.credit.toString()}
                  >
                    {num(t.credit)}
                  </td>
                </tr>
              </tbody>
            );
          })}
        </table>
      </div>
      {footer}
    </section>
  );
}
