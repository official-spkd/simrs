'use client';

import { formatRupiah } from '@simrs/shared';
import { cx } from '@simrs/ui';
import { useState } from 'react';
import type { ContohPembagian } from '@/lib/demo/fixtures/piutang';
import { hitungPembagian, recognitionJournal } from '@/lib/keuangan-piutang';
import { JurnalPasangan } from './jurnal-pasangan';

/**
 * Pembagian porsi penjamin vs pasien per tagihan contoh: identitas total = penjamin + pasien + ditanggung RS
 * ditampilkan dalam teks, dasar perhitungan, dan jurnal pengakuan saat tagihan final.
 */
export function PiutangPembagian({ examples }: { examples: readonly ContohPembagian[] }) {
  const [sel, setSel] = useState(examples[0]?.id ?? '');
  const ex = examples.find((e) => e.id === sel) ?? examples[0];
  if (!ex) return <p className="m-0 text-small text-ink-500">Belum ada tagihan.</p>;
  const s = hitungPembagian(ex.input);
  const rows: Array<[string, bigint, string?]> = [
    ['Total tarif RS', s.total],
    [`Ditanggung penjamin · ${ex.payerLabel}`, s.payer, 'piutang penjamin'],
    [
      s.upgradeAmount > 0n ? 'Dibayar pasien (selisih naik kelas)' : 'Dibayar pasien',
      s.patient,
      'ditagih di Kasir',
    ],
  ];
  if (ex.input.scheme === 'bpjs') {
    rows.push([
      s.hospital >= 0n ? 'Ditanggung RS (selisih tarif RS − INA-CBG)' : 'Surplus INA-CBG',
      s.hospital,
    ]);
  }
  const ok = s.payer + s.patient + s.hospital === s.total;
  return (
    <div className="flex flex-wrap items-start gap-4">
      <nav
        aria-label="Tagihan contoh"
        className="flex min-w-0 flex-[1_1_240px] flex-col gap-2 xl:max-w-[320px]"
      >
        {examples.map((e) => (
          <button
            key={e.id}
            type="button"
            aria-current={e.id === ex.id ? 'true' : undefined}
            onClick={() => setSel(e.id)}
            className={cx(
              'flex min-h-11 cursor-pointer flex-col rounded-control border px-3 py-2 text-left font-[inherit]',
              e.id === ex.id
                ? 'border-brand-600 bg-[linear-gradient(90deg,var(--color-brand-100),rgba(255,255,255,0.4))]'
                : 'border-line bg-white hover:bg-brand-50/60',
            )}
          >
            <span className="font-semibold text-ink-900">{e.patient.name}</span>
            <span className="text-caption text-ink-500">
              {e.payerLabel} · {e.patient.place}
            </span>
          </button>
        ))}
      </nav>
      <section
        aria-label="Pembagian penjamin"
        className="flex min-w-0 flex-[999_1_420px] flex-col gap-3 rounded-card border border-white/95 bg-white/90 shadow-card p-4"
      >
        <span className="flex flex-col">
          <span className="font-semibold">
            {ex.patient.name} <span className="font-mono text-caption text-ink-500">{ex.patient.rm}</span>
          </span>
          <span className="text-small text-ink-700">{ex.service}</span>
        </span>
        <dl className="m-0 flex flex-col">
          {rows.map(([k, v, note], i) => (
            <div
              key={k}
              className={cx(
                'flex flex-wrap items-baseline justify-between gap-2 border-t border-line py-1.5',
                i === 0 && 'border-t-0',
              )}
            >
              <dt className="text-small text-ink-700">
                {k}
                {note && <span className="text-caption text-ink-500"> · {note}</span>}
              </dt>
              <dd className={cx('m-0 font-mono', i === 0 ? 'font-bold' : 'font-semibold')} data-split={k}>
                {formatRupiah(v)}
              </dd>
            </div>
          ))}
        </dl>
        <span className={cx('text-small font-semibold', ok ? 'text-success' : 'text-danger')}>
          {ok ? '✓ Total = penjamin + pasien + ditanggung RS' : '✗ Pembagian tidak sama dengan total'}
        </span>
        <ul className="m-0 flex flex-col gap-0.5 pl-5 text-small text-ink-700">
          {s.basis.map((b) => (
            <li key={b}>{b}</li>
          ))}
        </ul>
        <JurnalPasangan
          jurnal={recognitionJournal(ex.input.scheme, s)}
          status="dibentuk saat tagihan final"
        />
      </section>
    </div>
  );
}
