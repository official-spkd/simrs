'use client';

import { type ReactNode, useId, useState } from 'react';
import { cx } from './cx';

export interface SafetyGateResolution {
  kind: 'ikuti' | 'override';
  /** Ringkasan keputusan yang ditampilkan, mis. "Glimepirid dihapus · 10.41" atau alasan override. */
  text: string;
}

/**
 * Gerbang keselamatan (CLAUDE.md §4.9): CDS, nilai kritis, gelang eMAR, time-out operasi, triase di bawah saran.
 * Pekerjaan tertahan sampai ditindaklanjuti: ikuti rekomendasi, atau lanjut dengan alasan klinis yang wajib
 * diisi (minimal `minReason` karakter) dan tercatat. Tidak ada jalan pintas diam-diam.
 */
export function SafetyGate({
  title,
  children,
  recommendation,
  overrideLabel = 'Tetap lanjut dengan alasan klinis',
  minReason = 10,
  onFollow,
  onOverride,
  resolved = null,
  disabled = false,
  tone = 'danger',
}: {
  title: string;
  /** Penjelasan risiko. */
  children?: ReactNode;
  /** Label tombol tindakan yang disarankan, mis. "Hapus glimepirid". */
  recommendation: string;
  overrideLabel?: string;
  minReason?: number;
  onFollow: () => void;
  onOverride: (reason: string) => void;
  resolved?: SafetyGateResolution | null;
  disabled?: boolean;
  tone?: 'danger' | 'warning';
}) {
  const id = useId();
  const [overriding, setOverriding] = useState(false);
  const [reason, setReason] = useState('');
  const short = reason.trim().length < minReason;
  const danger = tone === 'danger';

  return (
    <div
      role={resolved ? 'status' : 'alert'}
      className={cx(
        'flex flex-col gap-2.5 rounded-[12px] border p-3.5',
        resolved
          ? 'border-line bg-white'
          : danger
            ? 'border-danger-border bg-[linear-gradient(100deg,rgba(180,35,24,0.09),#FFF8F7_60%)]'
            : 'border-warning-border bg-[linear-gradient(100deg,rgba(138,75,0,0.09),#FFFAF2_60%)]',
      )}
    >
      <span className="flex flex-col gap-0.5">
        <span
          className={cx(
            'font-semibold',
            resolved ? 'text-ink-900' : danger ? 'text-danger-strong' : 'text-warning-strong',
          )}
        >
          <span className="sr-only">{danger ? 'Gerbang keselamatan: ' : 'Perhatian: '}</span>
          {title}
        </span>
        {children && <span className="text-small text-ink-700">{children}</span>}
      </span>

      {resolved ? (
        <span
          className={cx(
            'text-small font-semibold',
            resolved.kind === 'ikuti' ? 'text-success' : 'text-warning',
          )}
        >
          {resolved.kind === 'ikuti' ? '✓ ' : 'Override tercatat · '}
          {resolved.text}
        </span>
      ) : (
        <>
          <span className="flex flex-wrap gap-2">
            <button
              type="button"
              disabled={disabled}
              onClick={onFollow}
              className={cx(
                'min-h-11 cursor-pointer rounded-control border px-4 font-[inherit] font-semibold text-white disabled:cursor-not-allowed disabled:opacity-60',
                danger ? 'border-danger-strong bg-danger' : 'border-warning-strong bg-warning',
              )}
            >
              {recommendation}
            </button>
            {!overriding && (
              <button
                type="button"
                disabled={disabled}
                onClick={() => setOverriding(true)}
                className="min-h-11 cursor-pointer rounded-control border border-line-strong bg-white px-4 font-[inherit] font-medium text-ink-900 disabled:cursor-not-allowed"
              >
                {overrideLabel}
              </button>
            )}
          </span>
          {overriding && (
            <form
              className="flex flex-col gap-1.5"
              onSubmit={(e) => {
                e.preventDefault();
                if (!short) onOverride(reason.trim());
              }}
            >
              <label htmlFor={`${id}-alasan`} className="text-small font-semibold">
                Alasan klinis (wajib, minimal {minReason} karakter; tercatat di jejak audit)
              </label>
              <textarea
                id={`${id}-alasan`}
                value={reason}
                rows={2}
                maxLength={500}
                onChange={(e) => setReason(e.target.value)}
                className="rounded-control border border-line-strong bg-white px-3 py-2 font-[inherit]"
              />
              <span className="flex flex-wrap items-center gap-2">
                <button
                  type="submit"
                  disabled={disabled || short}
                  className="min-h-11 cursor-pointer rounded-control border border-ink-700 bg-ink-900 px-4 font-[inherit] font-semibold text-white disabled:cursor-not-allowed disabled:opacity-50"
                >
                  Simpan alasan dan lanjut
                </button>
                <button
                  type="button"
                  onClick={() => {
                    setOverriding(false);
                    setReason('');
                  }}
                  className="min-h-11 cursor-pointer rounded-control border-0 bg-transparent px-2 font-[inherit] text-small text-ink-700"
                >
                  Batal
                </button>
                {short && (
                  <span className="text-caption text-ink-500">
                    {Math.max(minReason - reason.trim().length, 0)} karakter lagi
                  </span>
                )}
              </span>
            </form>
          )}
        </>
      )}
    </div>
  );
}
