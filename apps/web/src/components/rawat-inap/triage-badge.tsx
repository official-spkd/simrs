import type { TriageLevel } from '@simrs/shared';
import { cx } from '@simrs/ui';
import { TRIAGE_META } from '@/lib/rawat-inap';

/** Lencana triase: nomor level + nama level (status tidak hanya lewat warna). */
export function TriageBadge({
  level,
  className,
  hidden,
}: {
  level: TriageLevel | null;
  className?: string;
  /** Papan administratif (ADR-0109): level triase tidak dikirim ke loket pendaftaran. */
  hidden?: boolean;
}) {
  if (level === null) {
    return (
      <span
        className={cx(
          'inline-flex items-center gap-1.5 rounded-[8px] border border-dashed border-line-strong bg-white px-2 py-1 text-caption font-bold text-ink-700',
          className,
        )}
      >
        {hidden ? 'Triase klinis' : 'Belum triase'}
      </span>
    );
  }
  const m = TRIAGE_META[level];
  return (
    <span
      className={cx(
        'inline-flex items-center gap-1.5 rounded-[8px] border px-2 py-1 text-caption font-bold whitespace-nowrap',
        m.badge,
        className,
      )}
    >
      <span className="sr-only">Triase </span>
      {level} · {m.label}
    </span>
  );
}
