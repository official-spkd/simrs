'use client';

import type { EncounterDiagnosis } from '@simrs/shared';
import { cx } from '@simrs/ui';
import { useId, useState } from 'react';
import { ICD10_OPTIONS } from '@/lib/klinis';

/** A · Asesmen: chip diagnosis ICD-10 (pertama = utama) + pemilih kode dari rujukan seed. */
export function SoapDiagnoses({
  diagnoses,
  editable,
  onAdd,
  onRemove,
  showMissing,
}: {
  diagnoses: readonly EncounterDiagnosis[];
  editable: boolean;
  onAdd: (code: string) => void;
  onRemove: (code: string) => void;
  showMissing: boolean;
}) {
  const [open, setOpen] = useState(false);
  const pickId = useId();
  const available = ICD10_OPTIONS.filter((o) => !diagnoses.some((d) => d.code === o.code));
  return (
    <div className="flex flex-col gap-2">
      <span id={`${pickId}-head`} className="text-small font-semibold">
        A · Asesmen (ICD-10)
      </span>
      <ul aria-labelledby={`${pickId}-head`} className="m-0 flex list-none flex-wrap items-center gap-2 p-0">
        {diagnoses.map((d) => (
          <li
            key={d.code}
            className={cx(
              'flex min-h-9 items-center gap-1.5 rounded-control border px-2.5 py-1 text-small',
              d.primary ? 'border-brand-200 bg-brand-50' : 'border-line bg-white',
            )}
          >
            <span className={cx('font-mono font-semibold', d.primary ? 'text-brand-700' : 'text-ink-900')}>
              {d.code}
            </span>
            <span>{d.display}</span>
            {d.primary && <span className="font-semibold">· utama</span>}
            {editable && (
              <button
                type="button"
                onClick={() => onRemove(d.code)}
                aria-label={`Hapus diagnosis ${d.code}`}
                className="-my-1 ml-0.5 flex size-8 cursor-pointer items-center justify-center rounded-full border-0 bg-transparent text-ink-500 hover:bg-muted"
              >
                ✕
              </button>
            )}
          </li>
        ))}
        {editable && (
          <li>
            <button
              type="button"
              aria-expanded={open}
              aria-controls={pickId}
              onClick={() => setOpen((v) => !v)}
              className="min-h-11 cursor-pointer rounded-control border border-dashed border-ink-400 bg-white px-3 font-[inherit] text-small text-ink-700"
            >
              {open ? 'Batal' : '+ Tambah diagnosis'}
            </button>
          </li>
        )}
      </ul>
      {editable && open && (
        <div className="flex flex-col gap-1">
          <label htmlFor={pickId} className="text-caption font-semibold text-ink-700">
            Pilih kode ICD-10
          </label>
          <select
            id={pickId}
            value=""
            onChange={(e) => {
              if (e.target.value) onAdd(e.target.value);
              setOpen(false);
            }}
            className="h-11 max-w-full rounded-control border border-line-strong bg-white px-2.5 font-[inherit] text-small"
          >
            <option value="">Pilih kode ICD-10…</option>
            {available.map((o) => (
              <option key={o.code} value={o.code}>
                {o.code} · {o.display}
              </option>
            ))}
          </select>
        </div>
      )}
      {showMissing && (
        <span className="text-caption text-danger">
          Belum ada diagnosis. Minimal satu diagnosis wajib diisi sebelum kunjungan diselesaikan.
        </span>
      )}
    </div>
  );
}
