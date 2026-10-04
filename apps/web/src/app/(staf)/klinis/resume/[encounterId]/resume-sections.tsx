'use client';

import { type DischargeSummary, formatJam } from '@simrs/shared';
import { Chip, cx } from '@simrs/ui';
import type { ReactNode } from 'react';
import { formatTglJam, RESUME_SOURCE_LABEL } from '@/lib/rawat-inap';

const CHANGE: Record<DischargeSummary['medications'][number]['change'], { label: string; tone: string }> = {
  baru: { label: 'Baru', tone: 'bg-info-bg text-info' },
  lanjut: { label: 'Lanjut', tone: 'bg-brand-50 text-brand-700' },
  'ubah-dosis': { label: 'Ubah dosis', tone: 'bg-warning-bg text-warning' },
  dihentikan: { label: 'Dihentikan', tone: 'bg-danger-bg text-danger' },
};

/** Isi resume (mockup Resume): fakta kunjungan, bagian berlabel sumber, rekonsiliasi obat, kode diagnosis. */
export function ResumeSections({
  summary,
  los,
  reconAt,
  reconControls,
}: {
  summary: DischargeSummary;
  los: number;
  /** Waktu konfirmasi rekonsiliasi (null = belum). */
  reconAt: string | null;
  /** Tombol konfirmasi DPJP (atau pilihan skenario) di bagian obat pulang. */
  reconControls: ReactNode;
}) {
  const facts = [
    ['Masuk', `${formatTglJam(summary.admittedAt)} · via ${summary.admissionVia}`],
    ['Pulang', `${formatTglJam(summary.dischargeAt)} · LOS ${los} hari`],
    ['Cara pulang', summary.dischargeMethod],
    ['Kondisi', summary.condition],
  ];
  return (
    <section aria-label="Isi resume" className="flex min-w-0 flex-[999_1_560px] flex-col gap-3">
      <dl className="m-0 grid grid-cols-2 gap-2.5 md:grid-cols-4">
        {facts.map(([k, v]) => (
          <div key={k} className="flex flex-col rounded-control border border-line bg-white px-3 py-2">
            <dt className="text-caption text-ink-500">{k}</dt>
            <dd className="m-0 text-small font-semibold">{v}</dd>
          </div>
        ))}
      </dl>
      {summary.sections.map((s) => {
        const empty = !s.body;
        const isRecon = s.id === 'obat-pulang';
        const srcText = isRecon
          ? reconAt
            ? `dikonfirmasi DPJP · ${formatJam(reconAt)}`
            : 'perlu konfirmasi DPJP'
          : RESUME_SOURCE_LABEL[s.source];
        return (
          <article
            key={s.id}
            aria-label={s.title}
            className={cx(
              'flex flex-col gap-2 rounded-card border bg-white px-4 py-3',
              isRecon && !reconAt && !empty ? 'border-warning-border' : 'border-line',
            )}
          >
            <div className="flex flex-wrap items-baseline justify-between gap-2">
              <h2 className="m-0 text-body font-semibold">{s.title}</h2>
              <span
                className={cx(
                  'text-caption font-semibold',
                  empty
                    ? 'text-ink-500'
                    : isRecon
                      ? reconAt
                        ? 'text-success'
                        : 'text-warning'
                      : 'text-brand-700',
                )}
              >
                Sumber: {srcText}
              </span>
            </div>
            {empty ? (
              <p className="m-0 rounded-control border border-dashed border-line-strong bg-subtle px-3 py-2 text-small text-ink-500">
                Belum terhimpun · terisi otomatis {RESUME_SOURCE_LABEL[s.source]} saat datanya tersedia.
              </p>
            ) : isRecon ? (
              <>
                <ul className="m-0 flex list-none flex-col gap-1 p-0 text-small">
                  {summary.medications.map((m) => (
                    <li key={`${m.name}-${m.change}`} className="flex flex-wrap items-center gap-2">
                      <span
                        className={cx(
                          'rounded-full px-2 py-[2px] text-caption font-semibold',
                          CHANGE[m.change].tone,
                        )}
                      >
                        {CHANGE[m.change].label}
                      </span>
                      <span className={cx('font-semibold', m.change === 'dihentikan' && 'line-through')}>
                        {m.name}
                      </span>
                      <span className="text-ink-700">{m.sig}</span>
                    </li>
                  ))}
                </ul>
                {reconControls}
              </>
            ) : (
              <p className="m-0 text-small whitespace-pre-line text-ink-900">{s.body}</p>
            )}
          </article>
        );
      })}
      <section
        aria-label="Diagnosis dan prosedur"
        className="flex flex-col gap-2 rounded-card border border-line bg-white px-4 py-3"
      >
        <h2 className="m-0 text-body font-semibold">Diagnosis dan prosedur (dikode)</h2>
        {summary.codes.length === 0 ? (
          <span className="text-small text-ink-500">Belum ada diagnosis berkode.</span>
        ) : (
          <ul className="m-0 flex list-none flex-wrap gap-2 p-0">
            {summary.codes.map((c) => (
              <li key={`${c.system}-${c.code}`}>
                <Chip tone={c.system === 'ICD-10' ? 'brand' : 'info'}>
                  <span className="font-mono">{c.code}</span> {c.label}
                  {c.primary ? ' · utama' : ''}
                  <span className="sr-only"> ({c.system})</span>
                </Chip>
              </li>
            ))}
          </ul>
        )}
      </section>
    </section>
  );
}
