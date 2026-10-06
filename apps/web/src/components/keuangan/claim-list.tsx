import type { Claim, ClaimBoard, ClaimStatus } from '@simrs/shared';
import { cx } from '@simrs/ui';
import Link from 'next/link';
import { CLAIM_FILTERS, CLAIM_STATUS_LABEL } from '@/lib/keuangan-klaim';
import { ClaimListTag } from './claim-local';

const num = new Intl.NumberFormat('id-ID');

/**
 * Daftar klaim (mockup Klaim, kolom kiri): chip filter per status (teks + jumlah periode), contoh berkas per
 * status, pilihan lewat `?status=…&pilih=…` sehingga tautan bisa dibagikan.
 */
export function ClaimList({
  claims,
  totals,
  filter,
  selectedId,
}: {
  claims: readonly Claim[];
  totals: ClaimBoard['totals'];
  filter: ClaimStatus;
  selectedId: string | null;
}) {
  const shown = claims.filter((c) => c.status === filter);
  return (
    <section
      aria-label="Daftar klaim"
      className="flex min-w-0 flex-[1_1_320px] flex-col overflow-hidden rounded-card border border-line bg-white xl:max-w-[380px]"
    >
      <div
        role="group"
        aria-label="Filter status klaim"
        className="flex flex-wrap gap-1.5 border-b border-line p-3"
      >
        {CLAIM_FILTERS.map((s) => {
          const on = s === filter;
          return (
            <Link
              key={s}
              href={`/keuangan/klaim?status=${s}`}
              aria-current={on ? 'true' : undefined}
              className={cx(
                'inline-flex min-h-11 items-center gap-1.5 rounded-full border px-3 text-small no-underline',
                on
                  ? 'border-brand-600 bg-brand-50 font-semibold text-brand-700'
                  : 'border-line-strong bg-white text-ink-700',
              )}
            >
              {CLAIM_STATUS_LABEL[s]}
              <span className="font-mono text-caption">{num.format(totals[s])}</span>
            </Link>
          );
        })}
      </div>
      <ul className="m-0 list-none p-0">
        {shown.map((c) => {
          const sel = c.id === selectedId;
          return (
            <li key={c.id}>
              <Link
                href={`/keuangan/klaim?status=${filter}&pilih=${c.id}`}
                aria-current={sel ? 'page' : undefined}
                className={cx(
                  'grid min-h-14 grid-cols-[4px_minmax(0,1fr)_auto] gap-3 border-b border-line-soft py-2.5 pr-3 text-ink-900 no-underline',
                  sel ? 'bg-brand-50' : 'bg-white hover:bg-subtle',
                )}
              >
                <span aria-hidden="true" className={sel ? 'bg-brand-600' : ''} />
                <span className="flex min-w-0 flex-col gap-0.5">
                  <span className="truncate font-semibold">{c.patient.name}</span>
                  <span className="text-caption text-ink-500">{c.encounter.summary}</span>
                  {c.scenario && (
                    <span className="text-caption font-semibold text-info">Pasien simulasi</span>
                  )}
                </span>
                <span className="flex flex-col items-end gap-1">
                  <ClaimListTag claim={c} />
                  <span className="text-caption text-ink-500">{c.ageLabel}</span>
                </span>
              </Link>
            </li>
          );
        })}
        {shown.length === 0 && (
          <li className="px-4 py-6 text-small text-ink-500">Tidak ada contoh berkas berstatus ini.</li>
        )}
      </ul>
      <span className="px-4 py-2 text-caption text-ink-500">
        Menampilkan {shown.length} dari {num.format(totals[filter])} · urut menurut tanggal pulang
      </span>
    </section>
  );
}
