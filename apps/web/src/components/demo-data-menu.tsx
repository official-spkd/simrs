'use client';

import { formatTanggalWaktu } from '@simrs/shared';
import { Button, Icon } from '@simrs/ui';
import { useRouter } from 'next/navigation';
import { useEffect, useId, useRef, useState, useTransition } from 'react';
import {
  type DemoDataSummary,
  demoDataSummaryAction,
  resetDemoDataAction,
} from '@/lib/server/demo/state-actions';
import { announceDemoChange } from './demo-sync';

/**
 * Lencana "Mode presentasi · data fiktif" sekaligus menu data demo (ADR-0023, ADR-0085): menjelaskan bahwa aksi di
 * layar yang tersambung toko demo tersimpan per RS, dan untuk admin SIM RS, manajemen, atau Superadmin demo
 * menyediakan "Mulai ulang data demo" dengan konfirmasi. Skenario Simulasi punya tombol mulai ulang sendiri.
 */
export function DemoDataMenu() {
  const id = useId();
  const router = useRouter();
  const wrap = useRef<HTMLSpanElement>(null);
  const [open, setOpen] = useState(false);
  const [confirming, setConfirming] = useState(false);
  const [summary, setSummary] = useState<DemoDataSummary | null>(null);
  const [message, setMessage] = useState<{ ok: boolean; text: string } | null>(null);
  const [pending, startTransition] = useTransition();

  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') setOpen(false);
    };
    const onDown = (e: MouseEvent) => {
      if (wrap.current && !wrap.current.contains(e.target as Node)) setOpen(false);
    };
    document.addEventListener('keydown', onKey);
    document.addEventListener('mousedown', onDown);
    return () => {
      document.removeEventListener('keydown', onKey);
      document.removeEventListener('mousedown', onDown);
    };
  }, [open]);

  const toggle = () => {
    const next = !open;
    setOpen(next);
    setConfirming(false);
    setMessage(null);
    if (next) {
      startTransition(async () => {
        try {
          setSummary(await demoDataSummaryAction());
        } catch {
          setSummary(null);
        }
      });
    }
  };

  const reset = () =>
    startTransition(async () => {
      const r = await resetDemoDataAction(true);
      setMessage({ ok: r.ok, text: r.message });
      setConfirming(false);
      if (!r.ok) return;
      setSummary(await demoDataSummaryAction());
      announceDemoChange();
      router.refresh();
    });

  return (
    <span ref={wrap} className="relative inline-flex">
      <button
        type="button"
        aria-expanded={open}
        aria-controls={`${id}-panel`}
        onClick={toggle}
        title="Semua nama, nomor, dan angka di layar ini fiktif dan tidak tersimpan ke rekam medis"
        className="inline-flex min-h-11 cursor-pointer items-center gap-1.5 rounded-full border-0 bg-warning-bg px-3 font-[inherit] text-caption font-semibold text-warning"
      >
        <Icon name="info" size={14} />
        Mode presentasi · data fiktif
        <span aria-hidden="true">▾</span>
      </button>
      {open && (
        <div
          id={`${id}-panel`}
          role="region"
          aria-label="Data demo"
          className="absolute top-full left-0 z-40 mt-1.5 flex w-[min(22rem,calc(100vw-2rem))] flex-col gap-2.5 animate-pal-in rounded-card border border-white/95 bg-white/95 p-3.5 text-small text-ink-700 shadow-float backdrop-blur-xl"
        >
          <span className="font-semibold text-ink-900">
            Data demo{summary ? ` · ${summary.tenantName}` : ''}
          </span>
          <span>
            Semua nama, nomor, dan angka fiktif. Aksi di layar yang tersambung data demo bersama tetap ada
            setelah dimuat ulang dan terlihat di layar lain.
          </span>
          {summary ? (
            <span>
              {summary.shared
                ? 'Ruang bersama semua akun presentasi RS ini (juga di perangkat lain): '
                : 'Ruang data akun ini saja (bukan akun presentasi): '}
              <strong className="font-semibold text-ink-900">{summary.events}</strong> aksi tersimpan.
              {summary.lastReset
                ? ` Terakhir dimulai ulang ${formatTanggalWaktu(summary.lastReset.at)} oleh ${summary.lastReset.by}.`
                : ' Belum pernah dimulai ulang.'}
            </span>
          ) : (
            <span aria-live="polite">{pending ? 'Memuat ringkasan…' : 'Ringkasan tidak tersedia.'}</span>
          )}
          {message && (
            <span
              role={message.ok ? 'status' : 'alert'}
              className={message.ok ? 'text-success' : 'text-danger'}
            >
              {message.text}
            </span>
          )}
          {summary && !summary.canReset && (
            <span className="text-caption text-ink-500">
              Mulai ulang data demo hanya untuk admin SIM RS, manajemen, atau Superadmin demo.
            </span>
          )}
          {summary?.canReset && !confirming && (
            <Button variant="secondary" disabled={pending} onClick={() => setConfirming(true)}>
              Mulai ulang data demo
            </Button>
          )}
          {summary?.canReset && confirming && (
            <div
              role="alertdialog"
              aria-labelledby={`${id}-confirm`}
              className="flex flex-col gap-2 rounded-control border border-danger-border bg-danger-bg p-3"
            >
              <span id={`${id}-confirm`} className="text-ink-900">
                {summary.shared
                  ? `Semua aksi tersimpan akun presentasi ${summary.tenantName} dihapus`
                  : 'Semua aksi tersimpan akun ini dihapus'}{' '}
                dan semua layar kembali ke data awal. Skenario Simulasi tidak ikut berubah. Lanjutkan?
              </span>
              <span className="flex flex-wrap justify-end gap-2">
                <Button onClick={() => setConfirming(false)} disabled={pending}>
                  Batal
                </Button>
                <Button variant="danger" onClick={reset} disabled={pending}>
                  {pending ? 'Memulai ulang…' : 'Ya, mulai ulang'}
                </Button>
              </span>
            </div>
          )}
        </div>
      )}
    </span>
  );
}
