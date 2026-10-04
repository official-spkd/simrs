'use client';

import { formatJam } from '@simrs/shared';
import { Button } from '@simrs/ui';
import { useId, useState } from 'react';

/**
 * Laporan sudah dicatat tetapi belum sah: penerima harus membacakan ulang nilai (read-back) sebelum timer berhenti.
 * Dipakai bila tugas `lapor` simulasi selesai lebih dulu (mis. dari panel simulasi).
 */
export function ReadBackConfirm({
  recipient,
  reportedAt,
  valueText,
  busy,
  disabledReason,
  onConfirm,
}: {
  recipient: string;
  reportedAt: string | null;
  valueText: string;
  busy: boolean;
  disabledReason: string | null;
  onConfirm: () => void;
}) {
  const id = useId();
  const [checked, setChecked] = useState(false);
  const [tried, setTried] = useState(false);
  const err = tried && !checked ? 'Read-back wajib dikonfirmasi sebelum disimpan.' : '';
  return (
    <span className="mt-1.5 flex flex-col gap-2 rounded-control border border-danger-border bg-white p-3">
      <span className="text-small text-ink-700">
        Dilaporkan ke <strong>{recipient}</strong>
        {reportedAt ? ` pukul ${formatJam(reportedAt)}` : ''}. Laporan belum sah sampai penerima membacakan
        ulang nilainya.
      </span>
      <label className="flex min-h-11 cursor-pointer items-center gap-2.5 text-small">
        <input
          type="checkbox"
          checked={checked}
          onChange={(e) => setChecked(e.target.checked)}
          aria-describedby={err ? `${id}-err` : undefined}
          className="size-[18px] flex-none accent-brand-600"
        />
        <span>Read-back: penerima mengulang nilai &ldquo;{valueText}&rdquo; dengan benar</span>
      </label>
      {err && (
        <span id={`${id}-err`} className="text-caption text-danger">
          {err}
        </span>
      )}
      <span className="flex flex-wrap items-center justify-end gap-2">
        {disabledReason && <span className="text-caption font-semibold text-warning">{disabledReason}</span>}
        <Button
          variant="danger"
          disabled={busy || !!disabledReason}
          onClick={() => {
            setTried(true);
            if (checked) onConfirm();
          }}
        >
          {busy ? 'Menyimpan…' : 'Konfirmasi read-back'}
        </Button>
      </span>
    </span>
  );
}
