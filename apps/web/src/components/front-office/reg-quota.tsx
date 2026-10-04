import type { Payer, PractitionerQuota } from '@simrs/shared';
import { cx } from '@simrs/ui';
import { deskQuota } from '@/lib/front-office';

/** F03 · Kartu kuota dokter hari ini (JKN/non-JKN); kuota kelompok penjamin habis → tidak bisa dipilih. */
export function RegQuota({
  quotas,
  payer,
  doctorId,
  locked,
  hint,
  countSelected,
  onPick,
}: {
  quotas: PractitionerQuota[];
  payer: Payer;
  doctorId: string | null;
  locked: boolean;
  hint: string;
  /** Tambahkan pendaftaran ini ke kuota dokter terpilih (false bila server sudah menghitungnya). */
  countSelected: boolean;
  onPick: (id: string) => void;
}) {
  return (
    <section
      aria-label="Kuota dokter hari ini"
      className="flex flex-col gap-2 rounded-card border border-line bg-white p-4"
    >
      <span className="font-semibold">Kuota dokter hari ini</span>
      {quotas.map((q) => {
        const sel = q.doctorId === doctorId;
        const v = deskQuota(q, payer, sel && countSelected);
        const disabled = locked || (v.full && !sel);
        return (
          <button
            key={q.doctorId}
            type="button"
            aria-pressed={sel}
            disabled={disabled}
            onClick={() => onPick(q.doctorId)}
            className={cx(
              'flex cursor-pointer flex-col gap-1.5 rounded-control px-3 py-2.5 text-left font-[inherit] disabled:cursor-not-allowed',
              sel ? 'border-2 border-brand-600 bg-selected' : 'border border-line bg-white',
              v.full && !sel && 'bg-subtle',
            )}
          >
            <span className="flex items-baseline justify-between gap-2">
              <span className="text-small font-semibold text-ink-900">{q.doctorName}</span>
              <span className="font-mono text-caption text-ink-700">
                {q.start}–{q.end}
              </span>
            </span>
            <span className="h-1.5 overflow-hidden rounded-full bg-muted" aria-hidden="true">
              <span
                className={cx(
                  'block h-1.5',
                  v.level === 'penuh'
                    ? 'bg-danger'
                    : v.level === 'hampir-penuh'
                      ? 'bg-[#D97706]'
                      : 'bg-brand-600',
                )}
                style={{ width: `${v.percent}%` }}
              />
            </span>
            <span className="text-caption text-ink-700">
              {v.used} dari {v.total} terisi · JKN {v.jknText} · non-JKN {v.nonJknText}
            </span>
            {v.full && (
              <span className="text-caption font-semibold text-danger">
                Kuota {payer === 'BPJS' ? 'JKN' : 'non-JKN'} penuh
              </span>
            )}
          </button>
        );
      })}
      {quotas.length === 0 && (
        <span className="text-small text-ink-500">Tidak ada dokter praktik di poli ini.</span>
      )}
      {hint && <span className="text-caption text-ink-500">{hint}</span>}
    </section>
  );
}

/** F03 · Pratinjau/nomor antrean poli. */
export function RegQueuePreview({
  label,
  queueNo,
  line,
  note,
}: {
  label: string;
  queueNo: string;
  line: string;
  note: string;
}) {
  return (
    <section
      aria-label="Antrean poli"
      aria-live="polite"
      className="flex flex-col gap-1 rounded-card border border-brand-100 bg-[linear-gradient(160deg,rgba(15,118,110,0.08),#FFFFFF_60%)] p-4"
    >
      <span className="text-caption font-semibold tracking-[0.06em] text-brand-700">{label}</span>
      <span className="font-mono text-[40px] leading-tight font-bold text-brand-700">{queueNo}</span>
      <span className="text-small text-ink-700">{line}</span>
      <span className="text-caption text-ink-500">{note}</span>
    </section>
  );
}
