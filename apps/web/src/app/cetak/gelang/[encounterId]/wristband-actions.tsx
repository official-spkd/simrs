'use client';

import { SAFETY_REASON_MIN } from '@simrs/shared';
import { Button, Icon } from '@simrs/ui';
import { useRouter } from 'next/navigation';
import { useId, useState, useTransition } from 'react';
import { reprintWristbandAction } from '../../../(staf)/klinis/tempat-tidur/actions-api';

/** Cetak (dialog cetak browser) + cetak ulang beralasan (gelang lama batal, kode baru terbit). Tidak ikut tercetak. */
export function WristbandActions({ encounterId }: { encounterId: string }) {
  const router = useRouter();
  const id = useId();
  const [open, setOpen] = useState(false);
  const [reason, setReason] = useState('');
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null);
  const [pending, start] = useTransition();
  const ok = reason.trim().length >= SAFETY_REASON_MIN;
  return (
    <div className="band-actions mx-auto flex w-[280mm] max-w-full flex-col gap-2">
      <div className="flex flex-wrap gap-2">
        <Button variant="primary" onClick={() => window.print()}>
          <Icon name="printer" size={16} />
          Cetak gelang
        </Button>
        <Button onClick={() => setOpen((v) => !v)}>Cetak ulang (gelang rusak/hilang)…</Button>
        <Button variant="ghost" onClick={() => router.back()}>
          Kembali
        </Button>
      </div>
      {open && (
        <form
          className="flex flex-wrap items-end gap-2"
          onSubmit={(e) => {
            e.preventDefault();
            if (!ok) return;
            start(async () => {
              const r = await reprintWristbandAction(encounterId, { reason: reason.trim() });
              if (r.ok) {
                setMsg({ ok: true, text: 'Gelang baru terbit; gelang lama tidak berlaku lagi.' });
                setOpen(false);
                setReason('');
                router.refresh();
              } else setMsg({ ok: false, text: r.message });
            });
          }}
        >
          <label
            htmlFor={`${id}-r`}
            className="flex min-w-[280px] flex-1 flex-col gap-1 text-small font-semibold"
          >
            Alasan cetak ulang (minimal {SAFETY_REASON_MIN} karakter)
            <input
              id={`${id}-r`}
              value={reason}
              maxLength={500}
              onChange={(e) => setReason(e.target.value)}
              className="h-11 rounded-control border border-line-strong bg-white px-3"
            />
          </label>
          <Button type="submit" variant="danger" disabled={!ok || pending}>
            Terbitkan gelang baru
          </Button>
        </form>
      )}
      {msg && (
        <p
          role={msg.ok ? 'status' : 'alert'}
          className={`m-0 text-small font-semibold ${msg.ok ? 'text-success' : 'text-danger'}`}
        >
          {msg.text}
        </p>
      )}
    </div>
  );
}
