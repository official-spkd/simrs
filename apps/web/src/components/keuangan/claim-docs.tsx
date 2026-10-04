'use client';

import type { Claim } from '@simrs/shared';
import { Button, cx } from '@simrs/ui';
import { type ReactNode, useId } from 'react';
import { docCount } from '@/lib/keuangan-klaim';

export interface ClaimButton {
  label: string;
  enabled: boolean;
  reason: string;
  onClick: () => void;
}

/**
 * Kelengkapan berkas klaim (mockup Klaim): daftar periksa berkas; kirim/final hanya bila lengkap, alasan tombol
 * nonaktif menyebut berkas yang kurang. Setelah terkirim, berkas dikunci.
 */
export function ClaimDocs({
  docs,
  locked,
  onToggle,
  query,
  submit,
  sent,
}: {
  docs: Claim['documents'];
  locked: boolean;
  onToggle: (id: string) => void;
  query: ClaimButton | null;
  submit: ClaimButton | null;
  sent: { title: string; note: string; extra?: ReactNode } | null;
}) {
  const id = useId();
  const complete = docs.every((d) => d.ok);
  return (
    <section
      aria-label="Kelengkapan berkas"
      className="flex min-w-0 flex-col gap-2 rounded-card border border-line bg-white p-4"
    >
      <span className="flex items-baseline justify-between gap-2">
        <span className="font-semibold">Kelengkapan berkas</span>
        <span className={cx('text-caption font-semibold', complete ? 'text-success' : 'text-warning')}>
          {docCount(docs)}
        </span>
      </span>
      <ul className="m-0 flex list-none flex-col p-0">
        {docs.map((d) => (
          <li key={d.id}>
            <label
              className={cx(
                'flex min-h-11 items-center gap-2.5 text-[13px]',
                locked ? 'cursor-default' : 'cursor-pointer',
                d.ok ? 'text-ink-700' : 'text-warning',
              )}
            >
              <input
                type="checkbox"
                checked={d.ok}
                disabled={locked}
                onChange={() => onToggle(d.id)}
                className="size-4 flex-none accent-brand-600"
              />
              <span>
                {d.label}
                {d.ok ? '' : ' (belum ada)'}
              </span>
            </label>
          </li>
        ))}
      </ul>
      {(query || submit) && (
        <div className="mt-1 flex flex-wrap gap-2">
          {query && (
            <Button disabled={!query.enabled} onClick={query.onClick}>
              {query.label}
            </Button>
          )}
          {submit && (
            <Button
              variant="primary"
              disabled={!submit.enabled}
              aria-describedby={submit.reason ? id : undefined}
              onClick={submit.onClick}
            >
              {submit.label}
            </Button>
          )}
        </div>
      )}
      {submit?.reason && (
        <span id={id} className="text-caption font-medium text-warning">
          {submit.reason}
        </span>
      )}
      {sent && (
        <div
          role="status"
          className="mt-1 flex flex-col gap-2 rounded-control border border-[#B7DEC0] bg-[#EAF5EC] px-3 py-2.5 text-[12.5px]"
        >
          <span className="font-bold text-success">{sent.title}</span>
          <span className="text-ink-700">{sent.note}</span>
          {sent.extra}
        </div>
      )}
    </section>
  );
}
