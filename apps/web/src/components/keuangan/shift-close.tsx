'use client';

import { Button } from '@simrs/ui';
import { useEffect, useId, useRef, useState, useTransition } from 'react';
import { kasirAction } from '@/app/(staf)/keuangan/kasir/actions';

type FocusTarget = 'trigger' | 'confirm' | 'status';

/**
 * Tutup shift kasir (dua langkah: minta konfirmasi, lalu kirim rekap kas ke akuntansi — simulasi). Saat tombol
 * diganti konfirmasi (atau sebaliknya), fokus keyboard dipindah ke elemen pengganti agar tidak hilang.
 */
export function ShiftClose({ summary }: { summary: string }) {
  const id = useId();
  const [confirming, setConfirming] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();
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
  }, [confirming, message]);
  const go = (target: FocusTarget, update: () => void) => {
    focusNext.current = target;
    update();
  };

  if (message) {
    return (
      <span ref={statusRef} tabIndex={-1} role="status" className="text-small font-semibold text-success">
        {message}
      </span>
    );
  }
  if (!confirming) {
    return (
      <Button ref={triggerRef} onClick={() => go('confirm', () => setConfirming(true))}>
        Tutup shift
      </Button>
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
          startTransition(async () => {
            const r = await kasirAction({ type: 'tutup-shift' });
            go('status', () => setMessage(r.message));
          })
        }
      >
        Ya, tutup shift
      </Button>
      <Button variant="ghost" onClick={() => go('trigger', () => setConfirming(false))}>
        Batal
      </Button>
    </span>
  );
}
