'use client';

import { formatRupiah } from '@simrs/shared';
import { Button, cx } from '@simrs/ui';
import Link from 'next/link';
import { useId } from 'react';
import type { PreSendCheck } from '@/lib/klinis-cds';

const MARK = { ok: '✓', warn: '!', block: '✕' } as const;
const TONE = { ok: 'text-success', warn: 'text-warning', block: 'text-danger' } as const;
const SR = { ok: 'Lolos: ', warn: 'Perhatian: ', block: 'Tertahan: ' } as const;

export interface SentInfo {
  title: string;
  message: string;
}

/** Kolom kanan CPOE: pemeriksaan sebelum kirim, estimasi biaya pasien, tombol kirim bertanda tangan (TTE). */
export function CpoeSummary({
  checks,
  cost,
  costNote,
  sendLabel,
  sendReason,
  canSend,
  pending,
  onSend,
  sent,
  error,
  links,
}: {
  checks: readonly PreSendCheck[];
  cost: bigint;
  costNote: string;
  sendLabel: string;
  /** Alasan tertulis bila tombol kirim nonaktif. */
  sendReason: string | null;
  canSend: boolean;
  pending: boolean;
  onSend: () => void;
  sent: SentInfo | null;
  error: string | null;
  links: ReadonlyArray<{ href: string; label: string }>;
}) {
  const id = useId();
  return (
    <aside aria-label="Ringkasan order" className="flex min-w-0 flex-col gap-3.5">
      <section
        aria-labelledby={`${id}-cek`}
        className="flex flex-col gap-2.5 rounded-card border border-white/95 bg-white/90 shadow-card px-4 py-3.5"
      >
        <h2 id={`${id}-cek`} className="m-0 text-body font-semibold">
          Pemeriksaan sebelum kirim
        </h2>
        <ul className="m-0 flex list-none flex-col gap-2 p-0">
          {checks.map((c) => (
            <li key={c.text} className="flex items-start gap-2 text-small">
              <span aria-hidden="true" className={cx('font-bold', TONE[c.tone])}>
                {MARK[c.tone]}
              </span>
              <span className="text-ink-700">
                <span className="sr-only">{SR[c.tone]}</span>
                {c.text}
              </span>
            </li>
          ))}
        </ul>
      </section>
      <section
        aria-label="Estimasi biaya pasien"
        className="flex flex-col gap-1.5 rounded-card border border-brand-200 bg-[linear-gradient(135deg,var(--color-brand-50),var(--color-brand-100))] px-4 py-3.5 shadow-card"
      >
        <span className="text-caption font-semibold tracking-[0.06em] text-brand-700">
          ESTIMASI BIAYA PASIEN
        </span>
        <span className={cx('text-[26px] font-bold', cost > 0n ? 'text-warning' : 'text-ink-900')}>
          {formatRupiah(cost)}
        </span>
        <span className="text-caption text-ink-700">{costNote}</span>
      </section>
      <Button
        type="button"
        variant="primary"
        onClick={onSend}
        disabled={!canSend || pending}
        aria-describedby={`${id}-alasan`}
      >
        {pending ? 'Mengirim…' : sendLabel}
      </Button>
      <span
        id={`${id}-alasan`}
        className={cx(
          'text-center text-caption',
          sendReason && !sent ? 'font-semibold text-danger' : 'text-ink-500',
        )}
      >
        {sent
          ? 'Order sudah di antrean unit penerima.'
          : (sendReason ??
            'Lab dan farmasi menerima order langsung; biaya tercatat otomatis (charge capture).')}
      </span>
      {error && (
        <p
          role="alert"
          className="m-0 rounded-control border border-koral-200 bg-alert-critical px-3 py-2 text-small text-danger"
        >
          {error}
        </p>
      )}
      {sent && (
        <div
          role="status"
          className="flex flex-col gap-2 rounded-card border border-zamrud-200 bg-alert-success px-4 py-3.5"
        >
          <span className="font-bold text-success">{sent.title}</span>
          <span className="text-small text-ink-700">{sent.message}</span>
          {links.length > 0 && (
            <span className="flex flex-wrap gap-2">
              {links.map((l) => (
                <Link
                  key={l.href}
                  href={l.href}
                  className="inline-flex min-h-11 items-center rounded-control border border-brand-600 bg-white/90 px-3.5 text-small font-semibold text-brand-800 hover:bg-brand-50/60 no-underline"
                >
                  {l.label}
                </Link>
              ))}
            </span>
          )}
        </div>
      )}
    </aside>
  );
}
