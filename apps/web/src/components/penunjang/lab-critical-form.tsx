'use client';

import { Button, cx } from '@simrs/ui';
import { useId, useState } from 'react';

/**
 * Formulir pelaporan nilai kritis (mockup Lab): nama penerima dan konfirmasi read-back keduanya wajib; laporan
 * tanpa read-back tidak sah sehingga tidak bisa disimpan.
 */
export function CriticalReportForm({
  valueText,
  placeholder,
  busy,
  serverError,
  onCancel,
  onSubmit,
}: {
  /** Nilai yang dibacakan ulang, mis. "Kalium 6,4 mmol/L". */
  valueText: string;
  placeholder: string;
  busy: boolean;
  serverError: string | null;
  onCancel: () => void;
  onSubmit: (recipient: string) => void;
}) {
  const id = useId();
  const [name, setName] = useState('');
  const [readBack, setReadBack] = useState(false);
  const [tried, setTried] = useState(false);
  const nameErr = tried && name.trim().length < 5 ? 'Nama penerima wajib diisi (minimal 5 karakter).' : '';
  const rbErr = tried && !readBack ? 'Read-back wajib dikonfirmasi sebelum disimpan.' : '';

  return (
    <form
      noValidate
      aria-label="Pelaporan nilai kritis"
      onSubmit={(e) => {
        e.preventDefault();
        setTried(true);
        if (name.trim().length >= 5 && readBack) onSubmit(name.trim());
      }}
      className="mt-1.5 flex flex-col gap-2 rounded-[12px] border border-koral-200 bg-white/90 p-3"
    >
      <span className="text-caption text-ink-700">
        Bacakan nilai ke penerima (SBAR). Laporan baru sah setelah penerima membacakan ulang nilainya.
      </span>
      <label htmlFor={`${id}-nama`} className="text-small font-semibold">
        Nama penerima laporan (DPJP / dokter jaga)
      </label>
      <input
        id={`${id}-nama`}
        value={name}
        maxLength={120}
        autoComplete="off"
        placeholder={placeholder}
        onChange={(e) => setName(e.target.value)}
        aria-invalid={!!nameErr}
        aria-describedby={nameErr ? `${id}-nama-err` : undefined}
        className={cx(
          'h-11 rounded-control border px-3 font-[inherit] text-ink-900',
          nameErr ? 'border-koral-600 bg-koral-50' : 'border-line-strong bg-white',
        )}
      />
      {nameErr && (
        <span id={`${id}-nama-err`} className="text-caption text-danger">
          {nameErr}
        </span>
      )}
      <label className="flex min-h-11 cursor-pointer items-center gap-2.5 text-small">
        <input
          type="checkbox"
          checked={readBack}
          onChange={(e) => setReadBack(e.target.checked)}
          aria-invalid={!!rbErr}
          aria-describedby={rbErr ? `${id}-rb-err` : undefined}
          className="size-[18px] flex-none accent-brand-600"
        />
        <span>Read-back: penerima mengulang nilai &ldquo;{valueText}&rdquo; dengan benar</span>
      </label>
      {rbErr && (
        <span id={`${id}-rb-err`} className="text-caption text-danger">
          {rbErr}
        </span>
      )}
      {serverError && (
        <span role="alert" className="text-caption font-semibold text-danger">
          {serverError}
        </span>
      )}
      <span className="flex flex-wrap justify-end gap-2">
        <Button onClick={onCancel}>Batal</Button>
        <Button type="submit" variant="danger" disabled={busy}>
          {busy ? 'Menyimpan…' : 'Simpan pelaporan'}
        </Button>
      </span>
    </form>
  );
}
