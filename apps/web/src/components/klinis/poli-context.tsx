import type { PoliEncounter } from '@simrs/shared';
import { cx } from '@simrs/ui';
import type { ReactNode } from 'react';
import { labValueFlag } from '@/lib/klinis';
import { ValueFlagBadge } from './status-flag';

function Box({
  title,
  aside,
  children,
  id,
}: {
  title: string;
  aside?: ReactNode;
  children: ReactNode;
  id?: string;
}) {
  return (
    <section
      id={id}
      aria-label={title}
      className="flex flex-col gap-3 rounded-card border border-line bg-white p-4 shadow-card"
    >
      <span className="flex items-baseline justify-between gap-2">
        <h3 className="m-0 text-[14px] font-semibold">{title}</h3>
        {aside && <span className="text-caption text-ink-500">{aside}</span>}
      </span>
      {children}
    </section>
  );
}

/** Kolom kanan pemeriksaan poli: hasil lab terakhir, obat aktif, riwayat kunjungan, dokumen kunjungan. */
export function PoliContext({ encounter }: { encounter: PoliEncounter }) {
  const e = encounter;
  return (
    <aside aria-label="Konteks pasien" className="flex min-w-0 flex-col gap-4">
      <Box title="Hasil lab terakhir" aside={e.labDate ?? '—'}>
        {e.labs.length === 0 ? (
          <span className="text-small text-ink-500">Belum ada hasil lab di rumah sakit ini.</span>
        ) : (
          <ul className="m-0 flex list-none flex-col gap-2.5 p-0">
            {e.labs.map((l) => {
              const flag = labValueFlag(l.flag);
              return (
                <li key={`${l.name}-${l.value}`} className="flex flex-col gap-0.5">
                  <span className="flex items-baseline justify-between gap-2">
                    <span>{l.name}</span>
                    <span
                      className={cx(
                        'inline-flex flex-wrap items-center justify-end gap-1 text-right font-bold',
                        flag ? 'text-danger' : 'text-ink-900',
                      )}
                    >
                      {l.value}
                      {flag && <ValueFlagBadge flag={flag} />}
                    </span>
                  </span>
                  <span className="text-caption text-ink-500">
                    {l.reference ? `Rujukan ${l.reference}` : 'Tanpa nilai rujukan'}
                    {l.loinc && <span className="font-mono"> · LOINC {l.loinc}</span>}
                  </span>
                </li>
              );
            })}
          </ul>
        )}
      </Box>
      <Box title="Obat aktif">
        {e.meds.length === 0 ? (
          <span className="text-small text-ink-500">Tidak ada obat rutin tercatat.</span>
        ) : (
          <ul className="m-0 flex list-none flex-col gap-2 p-0">
            {e.meds.map((m) => (
              <li key={m.name} className="flex flex-col">
                <span className="font-medium">{m.name}</span>
                <span className="text-caption text-ink-500">{m.since}</span>
              </li>
            ))}
          </ul>
        )}
      </Box>
      <Box title="Riwayat kunjungan" id="riwayat-kunjungan">
        <ol className="m-0 ml-1.5 flex list-none flex-col border-l-2 border-line p-0">
          {e.history.map((h, i) => (
            <li
              key={`${h.when}-${h.what}`}
              className={cx('relative flex flex-col gap-0.5 pl-3.5', i < e.history.length - 1 && 'pb-3')}
            >
              <span
                aria-hidden="true"
                className={cx(
                  'absolute top-1 -left-[7px] size-3 rounded-full border-2 bg-white',
                  i === 0 ? 'border-brand-600' : 'border-line-strong',
                )}
              />
              <span className="font-medium">{h.when}</span>
              <span className="text-caption text-ink-500">{h.what}</span>
            </li>
          ))}
        </ol>
      </Box>
      <Box title="Dokumen kunjungan">
        <ul className="m-0 flex list-none flex-col gap-2 p-0 text-small">
          {e.documents.map((d) => (
            <li key={d.name} className="flex justify-between gap-2">
              <span>{d.name}</span>
              <span className={cx(d.done ? 'font-semibold text-success' : 'text-ink-500')}>
                {d.done ? '✓ ' : ''}
                {d.value}
              </span>
            </li>
          ))}
        </ul>
      </Box>
    </aside>
  );
}
