'use client';

import { Button } from '@simrs/ui';
import { useState, useTransition } from 'react';
import { kasirAction } from '@/app/(staf)/keuangan/kasir/actions';

/** Tutup shift kasir (dua langkah: minta konfirmasi, lalu kirim rekap kas ke akuntansi — simulasi). */
export function ShiftClose({ summary }: { summary: string }) {
  const [confirming, setConfirming] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();
  if (message) {
    return (
      <span role="status" className="text-small font-semibold text-success">
        {message}
      </span>
    );
  }
  if (!confirming) {
    return <Button onClick={() => setConfirming(true)}>Tutup shift</Button>;
  }
  return (
    <span role="group" aria-label="Konfirmasi tutup shift" className="flex flex-wrap items-center gap-2">
      <span className="text-small text-ink-700">{summary}. Tutup shift sekarang?</span>
      <Button
        variant="primary"
        disabled={pending}
        onClick={() =>
          startTransition(async () => {
            const r = await kasirAction({ type: 'tutup-shift' });
            setMessage(r.message);
          })
        }
      >
        Ya, tutup shift
      </Button>
      <Button variant="ghost" onClick={() => setConfirming(false)}>
        Batal
      </Button>
    </span>
  );
}
