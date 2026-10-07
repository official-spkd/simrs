'use client';

import { Button } from '@simrs/ui';
import { useEffect, useId, useState, useTransition } from 'react';
import { searchCodeAction } from '@/lib/server/data/klinis/rekam-api-actions';

export interface CodedPick {
  code: string;
  display: string;
}

const INPUT =
  'h-11 min-w-0 rounded-control border border-line-strong bg-white px-3 font-[inherit] text-small';

/**
 * Pencarian kode baku dari data rujukan (`/ref/concepts`, ICD-10 diagnosis atau ICD-9-CM prosedur): kode tidak
 * diketik bebas (CLAUDE.md prinsip 10). Ketik minimal 2 huruf kode/nama, pilih dari hasil.
 */
export function CodeSearch({
  label,
  system,
  value,
  onChange,
}: {
  label: string;
  system: 'icd10' | 'icd9cm';
  value: CodedPick | null;
  onChange: (v: CodedPick | null) => void;
}) {
  const id = useId();
  const [q, setQ] = useState('');
  const [results, setResults] = useState<CodedPick[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [pending, start] = useTransition();
  const term = q.trim();

  useEffect(() => {
    if (term.length < 2) {
      setResults(null);
      setError(null);
      return;
    }
    const t = setTimeout(() => {
      start(async () => {
        const res = await searchCodeAction(system, term);
        if (res.ok) {
          setResults(res.data);
          setError(null);
        } else {
          setResults(null);
          setError(res.message);
        }
      });
    }, 250);
    return () => clearTimeout(t);
  }, [term, system]);

  return (
    <div className="flex min-w-0 flex-col gap-1" role="group" aria-labelledby={`${id}-l`}>
      <span id={`${id}-l`} className="text-small font-semibold">
        {label}
      </span>
      {value ? (
        <span className="flex flex-wrap items-center gap-2 text-small">
          <span>
            Dipilih: <span className="font-mono font-semibold">{value.code}</span> {value.display}
          </span>
          <Button onClick={() => onChange(null)}>Ganti kode</Button>
        </span>
      ) : (
        <>
          <label htmlFor={`${id}-q`} className="text-caption text-ink-700">
            Cari kode atau nama (minimal 2 huruf)
          </label>
          <input
            id={`${id}-q`}
            type="search"
            autoComplete="off"
            value={q}
            onChange={(e) => setQ(e.target.value)}
            className={INPUT}
          />
          <span className="text-caption text-ink-500" aria-live="polite">
            {pending
              ? 'Mencari…'
              : (error ??
                (results === null
                  ? ''
                  : results.length === 0
                    ? 'Tidak ada kode yang cocok.'
                    : `${results.length} kode ditemukan.`))}
          </span>
          {results && results.length > 0 && (
            <ul aria-label={`Hasil ${label}`} className="m-0 flex list-none flex-col gap-1 p-0">
              {results.map((r) => (
                <li key={r.code}>
                  <button
                    type="button"
                    onClick={() => onChange(r)}
                    className="flex min-h-11 w-full cursor-pointer items-center gap-2 rounded-control border border-line-strong bg-white px-3 py-1.5 text-left font-[inherit] text-small hover:bg-brand-50/60"
                  >
                    <span className="font-mono font-semibold">{r.code}</span>
                    <span>{r.display}</span>
                  </button>
                </li>
              ))}
            </ul>
          )}
        </>
      )}
    </div>
  );
}
