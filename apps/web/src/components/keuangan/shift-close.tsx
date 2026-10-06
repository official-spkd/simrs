'use client';

import { formatJam, formatRupiah } from '@simrs/shared';
import { Button } from '@simrs/ui';
import { useEffect, useId, useRef, useState } from 'react';
import { kasirAction } from '@/app/(staf)/keuangan/kasir/actions';
import { useStoreAction } from '@/lib/demo/store/client';
import type { ShiftState } from '@/lib/keuangan-tagihan-toko';

type FocusTarget = 'trigger' | 'confirm' | 'status';

/**
 * Tutup shift kasir (dua langkah: minta konfirmasi, lalu kirim rekap kas ke akuntansi). Tersimpan di toko demo
 * (domain `tagihan`) atas nama pengguna sesi; selama shift tertutup kasir tidak menerima pembayaran sampai shift baru
 * dibuka. Saat tombol diganti konfirmasi (atau sebaliknya), fokus keyboard dipindah ke elemen pengganti.
 */
export function ShiftClose({ summary, shift, rev }: { summary: string; shift: ShiftState; rev: number }) {
  const id = useId();
  const [confirming, setConfirming] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const { run, pending } = useStoreAction(rev);
  const triggerRef = useRef<HTMLButtonElement>(null);
  const confirmRef = useRef<HTMLButtonElement>(null);
  const statusRef = useRef<HTMLSpanElement>(null);
  const focusNext = useRef<FocusTarget | null>(null);
  useEffect(() => {
    const target = focusNext.current;
    focusNext.current = null;
    if (!target) return;
    const refs = { trigger: triggerRef, confirm: confirmRef, status: statusRef };
    refs[target].current?.focus();
  }, [confirming, shift.closedAt]);
  const go = (target: FocusTarget, update: () => void) => {
    focusNext.current = target;
    update();
  };

  if (shift.closedAt) {
    return (
      <span className="flex flex-wrap items-center gap-2">
        <span ref={statusRef} tabIndex={-1} role="status" className="text-small font-semibold text-success">
          Shift ditutup {formatJam(shift.closedAt)} oleh {shift.closedBy} · {shift.settled} tagihan lunas ·
          kas tunai {formatRupiah(BigInt(shift.cash))} · rekap dikirim ke akuntansi
        </span>
        <Button
          disabled={pending}
          onClick={() =>
            run(
              (r) => kasirAction({ type: 'buka-shift', rev: r }),
              (res) => (res.ok ? go('trigger', () => setConfirming(false)) : setError(res.message)),
            )
          }
        >
          Buka shift baru
        </Button>
        {error && (
          <span role="alert" className="text-caption text-danger">
            {error}
          </span>
        )}
      </span>
    );
  }
  if (!confirming) {
    return (
      <span className="flex flex-wrap items-center gap-2">
        {shift.reopenedAt && (
          <span className="text-caption text-ink-500">Shift dibuka {formatJam(shift.reopenedAt)}</span>
        )}
        <Button ref={triggerRef} onClick={() => go('confirm', () => setConfirming(true))}>
          Tutup shift
        </Button>
      </span>
    );
  }
  return (
    <span role="group" aria-label="Konfirmasi tutup shift" className="flex flex-wrap items-center gap-2">
      <span id={`${id}-ringkas`} className="text-small text-ink-700">
        {summary}. Tutup shift sekarang?
      </span>
      <Button
        ref={confirmRef}
        variant="primary"
        disabled={pending}
        aria-describedby={`${id}-ringkas`}
        onClick={() =>
          run(
            (r) => kasirAction({ type: 'tutup-shift', rev: r }),
            (res) => (res.ok ? go('status', () => setConfirming(false)) : setError(res.message)),
          )
        }
      >
        Ya, tutup shift
      </Button>
      <Button variant="ghost" onClick={() => go('trigger', () => setConfirming(false))}>
        Batal
      </Button>
      {error && (
        <span role="alert" className="text-caption text-danger">
          {error}
        </span>
      )}
    </span>
  );
}
