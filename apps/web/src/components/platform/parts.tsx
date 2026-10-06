'use client';

import { Button, Chip, type ChipTone, cx, Icon } from '@simrs/ui';
import { type ReactNode, useEffect, useId, useRef, useState } from 'react';

/**
 * Potongan UI bersama layar demo platform dan operasional (FE1: P01, P06, P08, P10–P13, F07, F08, backup, go-live).
 * Semua status tertulis sebagai teks (tidak hanya warna), tombol ≥ 44 px dari `@simrs/ui`.
 */

/** Judul halaman: jejak (breadcrumb teks) + h1, aksi di kanan. */
export function ScreenHeader({
  trail,
  title,
  children,
}: {
  trail: string;
  title: string;
  children?: ReactNode;
}) {
  return (
    <header className="flex flex-wrap items-center justify-between gap-3">
      <div className="flex min-w-0 flex-col gap-0.5">
        <span className="text-caption text-ink-500">{trail}</span>
        <h1 className="m-0 text-h1 font-semibold">{title}</h1>
      </div>
      {children && <div className="flex flex-wrap items-center gap-2">{children}</div>}
    </header>
  );
}

/** Kartu bagian berjudul (`<section aria-labelledby>`), bisa disasar E2E lewat `getByRole('region', { name })`. */
export function Panel({
  title,
  sub,
  actions,
  children,
  className,
  tone,
}: {
  title: string;
  sub?: ReactNode;
  actions?: ReactNode;
  children: ReactNode;
  className?: string;
  tone?: 'warning' | 'danger' | 'success';
}) {
  const id = useId();
  return (
    <section
      aria-labelledby={id}
      className={cx(
        'flex min-w-0 flex-col gap-3 rounded-card border bg-white p-4',
        tone === 'danger'
          ? 'border-[#FECDCA]'
          : tone === 'warning'
            ? 'border-[#F5D9A8]'
            : tone === 'success'
              ? 'border-[#BFE3C6]'
              : 'border-line',
        className,
      )}
    >
      <div className="flex flex-wrap items-start justify-between gap-2">
        <span className="flex min-w-0 flex-col">
          <h2 id={id} className="m-0 text-base font-semibold">
            {title}
          </h2>
          {sub && <span className="text-[12.5px] text-ink-500">{sub}</span>}
        </span>
        {actions && <span className="flex flex-wrap items-center gap-2">{actions}</span>}
      </div>
      {children}
    </section>
  );
}

export interface FlowStep {
  label: string;
  note?: string;
}

/** Tahap alur kerja; tahap aktif `aria-current="step"`, status juga tertulis untuk pembaca layar. */
export function FlowSteps({ label, steps, current }: { label: string; steps: FlowStep[]; current: number }) {
  return (
    <ol aria-label={label} className="m-0 flex list-none flex-wrap gap-2 p-0">
      {steps.map((s, i) => {
        const state = i < current ? 'selesai' : i === current ? 'aktif' : 'belum';
        return (
          <li
            key={s.label}
            aria-current={state === 'aktif' ? 'step' : undefined}
            className={cx(
              'flex min-w-[150px] flex-1 items-center gap-2 rounded-control border px-3 py-2',
              state === 'aktif'
                ? 'border-brand-600 bg-[linear-gradient(90deg,#E6F4F1,#FFFFFF)]'
                : 'border-line bg-white',
            )}
          >
            <span
              aria-hidden="true"
              className={cx(
                'flex size-7 flex-none items-center justify-center rounded-full text-small font-bold',
                state === 'selesai'
                  ? 'bg-brand-50 text-brand-700'
                  : state === 'aktif'
                    ? 'bg-brand-600 text-white'
                    : 'bg-muted text-ink-500',
              )}
            >
              {state === 'selesai' ? <Icon name="check" size={14} strokeWidth={2.6} /> : i + 1}
            </span>
            <span className="flex min-w-0 flex-col">
              <span className="text-small font-semibold">
                {s.label}
                <span className="sr-only">
                  {state === 'selesai' ? ' (selesai)' : state === 'aktif' ? ' (tahap aktif)' : ' (belum)'}
                </span>
              </span>
              {s.note && <span className="truncate text-caption text-ink-500">{s.note}</span>}
            </span>
          </li>
        );
      })}
    </ol>
  );
}

/** Umpan balik berjam ("Tervalidasi · 10.41"). */
export function Stamp({ children, tone = 'success' }: { children: ReactNode; tone?: ChipTone }) {
  return (
    <Chip tone={tone} icon={tone === 'success' ? <Icon name="check" size={13} strokeWidth={2.4} /> : null}>
      {children}
    </Chip>
  );
}

/** Pembungkus tabel lebar: gulir sendiri di layar sempit, bisa difokus keyboard. */
export function TableWrap({ label, children }: { label: string; children: ReactNode }) {
  return (
    // Wilayah gulir perlu tabIndex agar bisa digulir dengan keyboard.
    <div role="region" aria-label={label} tabIndex={0} className="max-w-full overflow-x-auto">
      {children}
    </div>
  );
}

export const TH = 'border-b border-line px-2.5 py-2 text-left text-caption font-semibold text-ink-500';
export const TD = 'border-b border-[#EEF1F4] px-2.5 py-2 align-top text-small';

export interface ConfirmRequest {
  title: string;
  body: ReactNode;
  confirmLabel: string;
  danger?: boolean;
  /** Bila ada, alasan wajib diketik (minimal `reasonMin` huruf) sebelum tombol konfirmasi aktif. */
  reasonLabel?: string;
  reasonMin?: number;
  reasonPlaceholder?: string;
}

/**
 * Dialog konfirmasi modal (`<dialog>` asli, Escape menutup). Aksi berisiko memakai alasan wajib: tombol konfirmasi
 * tetap terlihat tetapi nonaktif dengan keterangan sampai alasan cukup panjang (docs/08 §5.2).
 */
export function ConfirmDialog({
  request,
  onConfirm,
  onClose,
}: {
  request: ConfirmRequest | null;
  onConfirm: (reason: string) => void;
  onClose: () => void;
}) {
  const ref = useRef<HTMLDialogElement>(null);
  const id = useId();
  const [reason, setReason] = useState('');
  useEffect(() => {
    const d = ref.current;
    if (!d) return;
    if (request && !d.open) {
      setReason('');
      d.showModal();
    } else if (!request && d.open) d.close();
  }, [request]);
  const min = request?.reasonMin ?? 10;
  const needsReason = Boolean(request?.reasonLabel);
  const short = needsReason && reason.trim().length < min;
  return (
    <dialog
      ref={ref}
      role="alertdialog"
      aria-labelledby={`${id}-judul`}
      aria-describedby={`${id}-isi`}
      onClose={onClose}
      className={cx(
        'm-auto w-[min(560px,calc(100vw-32px))] rounded-card border p-0 text-ink-900 backdrop:bg-[rgba(20,33,43,0.45)]',
        request?.danger ? 'border-[#FECDCA]' : 'border-line',
      )}
    >
      {request && (
        <form
          method="dialog"
          className="flex flex-col gap-3 p-5"
          onSubmit={(e) => {
            e.preventDefault();
            if (short) return;
            onConfirm(reason.trim());
            ref.current?.close();
          }}
        >
          <h2 id={`${id}-judul`} className="m-0 text-h2 font-semibold">
            {request.title}
          </h2>
          <div id={`${id}-isi`} className="text-small text-ink-700">
            {request.body}
          </div>
          {needsReason && (
            <label className="flex flex-col gap-1.5">
              <span className="text-small font-semibold text-ink-700">{request.reasonLabel}</span>
              <textarea
                value={reason}
                onChange={(e) => setReason(e.target.value)}
                rows={3}
                placeholder={request.reasonPlaceholder}
                aria-describedby={`${id}-syarat`}
                className="rounded-control border border-line-strong p-2.5 font-[inherit] text-ink-900"
              />
              <span id={`${id}-syarat`} className="text-caption text-ink-500">
                Minimal {min} huruf · tercatat di jejak audit
              </span>
            </label>
          )}
          <span className="flex flex-wrap items-center gap-2">
            <Button onClick={() => ref.current?.close()}>Batal</Button>
            <Button
              type="submit"
              variant={request.danger ? 'danger' : 'primary'}
              disabled={short}
              aria-describedby={short ? `${id}-kurang` : undefined}
            >
              {request.confirmLabel}
            </Button>
            {short && (
              <span id={`${id}-kurang`} className="text-caption font-medium text-warning">
                Tulis alasan dulu (minimal {min} huruf).
              </span>
            )}
          </span>
        </form>
      )}
    </dialog>
  );
}

/** Daftar riwayat berjam (umpan balik aksi terbaru di atas). */
export function ActivityLog({ label, items }: { label: string; items: Array<{ t: string; text: string }> }) {
  if (items.length === 0) return null;
  return (
    <ol aria-label={label} className="m-0 flex list-none flex-col gap-1.5 p-0">
      {items.map((it, i) => (
        <li key={`${it.t}-${i}`} className="flex gap-2.5 text-small">
          <span className="w-12 flex-none font-mono text-ink-500">{it.t}</span>
          <span className="min-w-0 text-ink-700">{it.text}</span>
        </li>
      ))}
    </ol>
  );
}
