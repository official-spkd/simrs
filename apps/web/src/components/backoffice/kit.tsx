'use client';

import { Button, type ButtonVariant, cx, Icon } from '@simrs/ui';
import { type ReactNode, useEffect, useId, useRef, useState } from 'react';
import { CARD_BASE, H1, H2, ROW_SELECTED, TABLE_HOVER, TH_BASE } from './styles';

/**
 * Perangkat kecil layar back office fase 8–9 (mode presentasi, ADR-0023): panel berjudul, umpan balik berjam,
 * jejak tahap, tombol nonaktif beralasan (docs/08 §5.2), dan konfirmasi beralasan. Aksi layar tersimpan di toko demo
 * bersama (ADR-0085, `use-toko.ts`); aturan bisnisnya di `lib/<domain>.ts` dan `lib/<domain>-toko.ts`.
 */

export interface Flash {
  ok: boolean;
  text: string;
}

/** Umpan balik aksi (`role="status"`): hijau berhasil, kuning ditolak/ditahan. */
export function FlashLine({ flash, className }: { flash: Flash | null; className?: string }) {
  if (!flash) return null;
  return (
    <div
      role="status"
      className={cx(
        'rounded-card border px-4 py-2.5 text-small font-medium',
        flash.ok
          ? 'animate-pop border-success-border bg-alert-success text-success'
          : 'border-warning-border bg-alert-warning text-warning',
        className,
      )}
    >
      {flash.text}
    </div>
  );
}

/** Kartu berjudul (h2) dengan subjudul dan aksi di kanan; `aria-labelledby` ke judulnya. */
export function Panel({
  title,
  sub,
  actions,
  children,
  flush = false,
  className,
  tone,
}: {
  title: string;
  sub?: ReactNode;
  actions?: ReactNode;
  children: ReactNode;
  flush?: boolean;
  className?: string;
  tone?: 'danger' | 'warning' | 'success';
}) {
  const id = useId();
  return (
    <section
      aria-labelledby={id}
      className={cx(
        'flex min-w-0 flex-col overflow-hidden',
        CARD_BASE,
        tone === 'danger'
          ? 'border-danger-border'
          : tone === 'warning'
            ? 'border-warning-border'
            : tone === 'success'
              ? 'border-success-border'
              : 'border-white/95',
        className,
      )}
    >
      <div className="flex flex-wrap items-center justify-between gap-3 border-b border-[rgba(23,32,46,0.06)] px-4 py-3">
        <span className="flex min-w-0 flex-[1_1_220px] flex-col">
          <h2 id={id} className={H2}>
            {title}
          </h2>
          {sub && <span className="text-[12.5px] text-ink-500">{sub}</span>}
        </span>
        {actions && <span className="flex flex-wrap items-center gap-2">{actions}</span>}
      </div>
      <div className={cx('flex min-w-0 flex-col', !flush && 'gap-3 p-4')}>{children}</div>
    </section>
  );
}

export interface StageView {
  label: string;
  /** Jam/teks waktu tahap selesai, mis. "10.52". */
  at?: string | null;
}

/**
 * Jejak tahap alur (urutan tidak bisa dilompati): tahap < `current` selesai, `current` aktif. `current` =
 * `stages.length` berarti semua selesai.
 */
export function StageTrack({
  stages,
  current,
  label,
  rejected,
}: {
  stages: readonly StageView[];
  current: number;
  label: string;
  /** Alur berhenti di tahap aktif karena ditolak/dibatalkan. */
  rejected?: boolean;
}) {
  return (
    <ol aria-label={label} className="m-0 flex list-none flex-wrap gap-2 p-0">
      {stages.map((s, i) => {
        const done = i < current;
        const active = i === current;
        const state = done ? 'selesai' : active ? (rejected ? 'dihentikan' : 'aktif') : 'belum';
        return (
          <li
            key={s.label}
            aria-current={active ? 'step' : undefined}
            className={cx(
              'flex min-w-[150px] flex-1 items-center gap-2 rounded-control border px-2.5 py-1.5',
              active && rejected
                ? 'border-danger-border bg-alert-critical'
                : active
                  ? 'border-transparent bg-nav-active shadow-[0_6px_16px_rgba(23,32,46,0.18)]'
                  : done
                    ? 'border-zamrud-200 bg-zamrud-50'
                    : 'border-transparent bg-[rgba(23,32,46,0.05)]',
            )}
          >
            <span
              aria-hidden="true"
              className={cx(
                'flex size-6 flex-none items-center justify-center rounded-full text-caption font-bold',
                done
                  ? 'bg-zamrud-100 text-zamrud-700'
                  : active && rejected
                    ? 'bg-danger text-white'
                    : active
                      ? 'bg-white text-brand-800'
                      : 'bg-white/80 text-ink-500',
              )}
            >
              {done ? <Icon name="check" size={12} strokeWidth={2.6} /> : i + 1}
            </span>
            <span className="flex min-w-0 flex-col">
              <span
                className={cx(
                  'text-caption font-semibold',
                  active && !rejected ? 'text-white' : 'text-ink-900',
                )}
              >
                {s.label}
                <span className="sr-only"> ({state})</span>
              </span>
              <span className={cx('text-[11.5px]', active && !rejected ? 'text-white/90' : 'text-ink-500')}>
                {done
                  ? s.at
                    ? `selesai ${s.at}`
                    : 'selesai'
                  : active
                    ? rejected
                      ? 'dihentikan'
                      : 'sekarang'
                    : 'menunggu'}
              </span>
            </span>
          </li>
        );
      })}
    </ol>
  );
}

/**
 * Tombol dengan alasan nonaktif tertulis di dekatnya (docs/08 §5.2): `reason` bukan null → tombol nonaktif dan
 * alasannya dibacakan (`aria-describedby`).
 */
export function ReasonButton({
  children,
  reason,
  onClick,
  variant = 'primary',
  className,
}: {
  children: ReactNode;
  reason: string | null;
  onClick: () => void;
  variant?: ButtonVariant;
  className?: string;
}) {
  const id = useId();
  return (
    <span className={cx('flex flex-col items-start gap-1', className)}>
      <Button
        variant={variant}
        disabled={reason !== null}
        aria-describedby={reason ? id : undefined}
        onClick={onClick}
      >
        {children}
      </Button>
      {reason && (
        <span id={id} className="text-caption text-ink-500">
          {reason}
        </span>
      )}
    </span>
  );
}

/**
 * Konfirmasi sebaris (`role="alertdialog"`) untuk aksi penting/tak terbalikkan. Dengan `minReason`, alasan wajib
 * diisi minimal sekian huruf sebelum tombol konfirmasi aktif; alasan ikut tercatat.
 */
export function ConfirmBox({
  title,
  children,
  confirmLabel,
  onConfirm,
  onCancel,
  minReason,
  reasonLabel = 'Alasan (wajib, tercatat)',
  danger = false,
}: {
  title: string;
  children?: ReactNode;
  confirmLabel: string;
  onConfirm: (reason: string) => void;
  onCancel: () => void;
  minReason?: number;
  reasonLabel?: string;
  danger?: boolean;
}) {
  const id = useId();
  const ref = useRef<HTMLDivElement>(null);
  const [reason, setReason] = useState('');
  useEffect(() => ref.current?.focus(), []);
  const short = minReason !== undefined && reason.trim().length < minReason;
  return (
    <div
      ref={ref}
      tabIndex={-1}
      role="alertdialog"
      aria-labelledby={`${id}-t`}
      aria-describedby={children ? `${id}-d` : undefined}
      className={cx(
        'flex flex-col gap-2 rounded-control border px-4 py-3 outline-none',
        danger ? 'border-danger-border bg-danger-bg' : 'border-warning-border bg-warning-bg',
      )}
    >
      <span id={`${id}-t`} className="font-semibold text-ink-900">
        {title}
      </span>
      {children && (
        <span id={`${id}-d`} className="text-small text-ink-700">
          {children}
        </span>
      )}
      {minReason !== undefined && (
        <span className="flex flex-col gap-1">
          <label htmlFor={`${id}-r`} className="text-small font-semibold text-ink-700">
            {reasonLabel}
          </label>
          <textarea
            id={`${id}-r`}
            value={reason}
            onChange={(e) => setReason(e.target.value)}
            rows={2}
            aria-describedby={`${id}-h`}
            className="min-h-11 rounded-control border border-line-strong bg-white px-3 py-2 font-[inherit] text-ink-900"
          />
          <span id={`${id}-h`} className="text-caption text-ink-500">
            {short ? `Minimal ${minReason} huruf (${reason.trim().length}/${minReason}).` : 'Alasan cukup.'}
          </span>
        </span>
      )}
      <span className="flex flex-wrap gap-2">
        <Button onClick={onCancel}>Batal</Button>
        <Button
          variant={danger ? 'danger' : 'primary'}
          disabled={short}
          onClick={() => onConfirm(reason.trim())}
        >
          {confirmLabel}
        </Button>
      </span>
    </div>
  );
}

/** Daftar pasangan label–nilai (`dl`). */
export function KeyValues({ rows }: { rows: ReadonlyArray<readonly [string, ReactNode]> }) {
  return (
    <dl className="m-0 grid grid-cols-[minmax(0,140px)_minmax(0,1fr)] gap-x-3 gap-y-1.5 text-small">
      {rows.map(([k, v]) => (
        <div key={k} className="contents">
          <dt className="text-ink-500">{k}</dt>
          <dd className="m-0 min-w-0 text-ink-900">{v}</dd>
        </div>
      ))}
    </dl>
  );
}

/**
 * Pembungkus tabel: tabel lebar menggulir di dalam kartu, bukan halaman. `minWidth` menjaga kolom tidak terjepit di
 * lebar tablet (lebih baik digulir daripada teks patah per kata).
 */
export function TableWrap({
  label,
  children,
  minWidth = 560,
}: {
  label: string;
  children: ReactNode;
  minWidth?: number;
}) {
  return (
    <div role="region" aria-label={label} tabIndex={0} className="relative max-w-full overflow-x-auto">
      <table className={cx('w-full border-collapse text-small', TABLE_HOVER)} style={{ minWidth }}>
        {children}
      </table>
    </div>
  );
}

export const TH = `${TH_BASE} px-3 py-2`;
export const TD = 'border-b border-line-soft px-3 py-2 align-top';

/** Baris yang bisa dipilih di worklist kiri (tombol penuh, `aria-pressed`). */
export function PickRow({
  selected,
  onClick,
  title,
  sub,
  right,
}: {
  selected: boolean;
  onClick: () => void;
  title: ReactNode;
  sub?: ReactNode;
  right?: ReactNode;
}) {
  return (
    <button
      type="button"
      aria-pressed={selected}
      onClick={onClick}
      className={cx(
        'flex min-h-touch w-full cursor-pointer items-center justify-between gap-3 border-0 border-b border-line-soft px-4 py-2.5 text-left font-[inherit]',
        selected
          ? cx(ROW_SELECTED, 'shadow-[inset_3px_0_0_var(--color-brand-600)]')
          : 'bg-transparent transition-colors hover:bg-brand-50/60',
      )}
    >
      <span className="flex min-w-0 flex-col">
        <span className="text-small font-semibold text-ink-900">{title}</span>
        {sub && <span className="text-caption text-ink-500">{sub}</span>}
      </span>
      {right && <span className="flex flex-none flex-wrap justify-end gap-1">{right}</span>}
    </button>
  );
}

/** Keadaan kosong di dalam kartu. */
export function EmptyNote({ children }: { children: ReactNode }) {
  return <p className="m-0 px-4 py-5 text-center text-small text-ink-500">{children}</p>;
}

const CONTROL = 'rounded-control border border-line-strong bg-white px-3 font-[inherit] text-ink-900';

/** Pilihan berlabel terlihat (44 px). `options`: [nilai, teks]. */
export function SelectField({
  label,
  value,
  onChange,
  options,
  placeholder,
  hint,
  disabled,
}: {
  label: string;
  value: string;
  onChange: (v: string) => void;
  options: ReadonlyArray<readonly [string, string]>;
  placeholder?: string;
  hint?: ReactNode;
  disabled?: boolean;
}) {
  const id = useId();
  return (
    <span className="flex min-w-0 flex-col gap-1.5">
      <label htmlFor={id} className="text-small font-semibold text-ink-700">
        {label}
      </label>
      <select
        id={id}
        value={value}
        onChange={(e) => onChange(e.target.value)}
        disabled={disabled}
        aria-describedby={hint ? `${id}-h` : undefined}
        className={cx('h-11 min-w-0', CONTROL)}
      >
        {placeholder !== undefined && <option value="">{placeholder}</option>}
        {options.map(([v, t]) => (
          <option key={v} value={v}>
            {t}
          </option>
        ))}
      </select>
      {hint && (
        <span id={`${id}-h`} className="text-caption text-ink-500">
          {hint}
        </span>
      )}
    </span>
  );
}

/** Isian teks (satu baris atau `rows` > 1 = area) berlabel terlihat. */
export function TextField({
  label,
  value,
  onChange,
  rows = 1,
  hint,
  inputMode,
  placeholder,
  disabled,
}: {
  label: string;
  value: string;
  onChange: (v: string) => void;
  rows?: number;
  hint?: ReactNode;
  inputMode?: 'numeric' | 'decimal' | 'text';
  placeholder?: string;
  disabled?: boolean;
}) {
  const id = useId();
  const described = hint ? `${id}-h` : undefined;
  return (
    <span className="flex min-w-0 flex-col gap-1.5">
      <label htmlFor={id} className="text-small font-semibold text-ink-700">
        {label}
      </label>
      {rows > 1 ? (
        <textarea
          id={id}
          value={value}
          rows={rows}
          placeholder={placeholder}
          disabled={disabled}
          aria-describedby={described}
          onChange={(e) => onChange(e.target.value)}
          className={cx('min-h-11 py-2', CONTROL)}
        />
      ) : (
        <input
          id={id}
          value={value}
          inputMode={inputMode}
          placeholder={placeholder}
          disabled={disabled}
          aria-describedby={described}
          onChange={(e) => onChange(e.target.value)}
          className={cx('h-11 min-w-0', CONTROL)}
        />
      )}
      {hint && (
        <span id={described} className="text-caption text-ink-500">
          {hint}
        </span>
      )}
    </span>
  );
}

/** Kotak centang berlabel dengan target sentuh 44 px. */
export function CheckField({
  label,
  checked,
  onChange,
  disabled,
}: {
  label: ReactNode;
  checked: boolean;
  onChange: (v: boolean) => void;
  disabled?: boolean;
}) {
  return (
    <label className="flex min-h-touch cursor-pointer items-center gap-2.5 text-small text-ink-900 has-[:disabled]:cursor-not-allowed">
      <input
        type="checkbox"
        checked={checked}
        disabled={disabled}
        onChange={(e) => onChange(e.target.checked)}
        className="h-4 w-4 flex-none accent-brand-600"
      />
      <span>{label}</span>
    </label>
  );
}

/** Kepala halaman back office: remah roti + h1 + aksi. */
export function PageHead({ crumb, title, actions }: { crumb: string; title: string; actions?: ReactNode }) {
  return (
    <header className="flex flex-wrap items-center justify-between gap-3">
      <div className="flex min-w-0 flex-col gap-0.5">
        <span className="text-caption text-ink-500">{crumb}</span>
        <h1 className={H1}>{title}</h1>
      </div>
      {actions && <div className="flex flex-wrap gap-2">{actions}</div>}
    </header>
  );
}
