'use client';

import type { ReconRow } from '@simrs/shared';
import { Button, cx } from '@simrs/ui';
import { useId, useState } from 'react';
import { RESOLUTION_NOTE_MIN, resolutionError } from '@/lib/btn';

/**
 * Formulir penyelesaian satu pengecualian rekonsiliasi: tindakan wajib dipilih dan catatan penyelesaian wajib
 * (minimal 10 karakter) sebelum "Terapkan" aktif. Tercatat di jejak audit (versi produksi).
 */
export function RekonException({
  row,
  busy,
  onApply,
}: {
  row: ReconRow;
  busy: boolean;
  onApply: (actionId: string, note: string) => void;
}) {
  const id = useId();
  const [actionId, setActionId] = useState('');
  const [note, setNote] = useState('');
  const [tried, setTried] = useState(false);
  const ex = row.exception;
  if (!ex) return null;
  const error = resolutionError(row, actionId, note);
  const len = note.trim().length;
  const hint = tried && error ? error : `${len}/${RESOLUTION_NOTE_MIN} karakter minimal · dibaca auditor`;
  return (
    <form
      className="flex flex-col gap-2 rounded-control border border-danger-border bg-[#FFFBFA] p-3"
      onSubmit={(e) => {
        e.preventDefault();
        setTried(true);
        if (!error) onApply(actionId, note.trim());
      }}
    >
      <span className="text-small text-ink-700">{ex.explanation}</span>
      <div className="flex flex-wrap items-end gap-2">
        <label className="flex min-w-0 flex-[1_1_240px] flex-col gap-1 text-small font-semibold text-ink-700">
          Tindakan penyelesaian
          <select
            value={actionId}
            onChange={(e) => setActionId(e.target.value)}
            aria-label={`Tindakan untuk selisih ${row.label}`}
            className="h-11 rounded-control border border-line-strong bg-white px-2 font-[inherit] font-normal text-ink-900"
          >
            <option value="">Pilih tindakan…</option>
            {ex.actions.map((a) => (
              <option key={a.id} value={a.id}>
                {a.label}
              </option>
            ))}
          </select>
        </label>
      </div>
      <label htmlFor={`${id}-catatan`} className="text-small font-semibold text-ink-700">
        Catatan penyelesaian (wajib)
      </label>
      <textarea
        id={`${id}-catatan`}
        rows={2}
        maxLength={300}
        value={note}
        onChange={(e) => setNote(e.target.value)}
        aria-invalid={tried && !!error}
        aria-describedby={`${id}-pesan`}
        placeholder="mis. Dicek terhadap laporan TPDI dan mutasi BTN; tagihan dilunasi"
        className="rounded-control border border-line-strong bg-white px-3 py-2 font-[inherit]"
      />
      <span className="flex flex-wrap items-center justify-between gap-2">
        <span
          id={`${id}-pesan`}
          className={cx('text-caption', tried && error ? 'font-semibold text-danger' : 'text-ink-500')}
        >
          {hint}
        </span>
        <Button type="submit" variant="primary" size="sm" disabled={busy || !!error} className="min-h-11">
          Terapkan
        </Button>
      </span>
    </form>
  );
}
