'use client';

import type { ConsultantOption } from '@simrs/shared';
import { Button, cx } from '@simrs/ui';
import { useEffect, useId, useState, useTransition } from 'react';
import { searchConsultantsAction } from '@/lib/server/data/klinis/konsul-actions';

const INPUT =
  'h-11 min-w-0 rounded-control border border-line-strong bg-white px-3 font-[inherit] text-small';

/**
 * K10 · Pemilih dokter (tujuan konsul / penerima DPJP utama) dengan pencarian di server (fase 3 · 3.8, ADR-0059):
 * ketik minimal 2 huruf nama dokter atau unit, hasil dibatasi dan berurutan stabil dari API. Tidak memuat seluruh
 * dokter RS. Pilihan = tombol ber-`aria-pressed`; nilai terpilih ditulis sebagai teks.
 */
export function ConsultantPicker({
  label,
  value,
  onChange,
}: {
  label: string;
  /** Dokter terpilih (null = belum). */
  value: ConsultantOption | null;
  onChange: (v: ConsultantOption | null) => void;
}) {
  const id = useId();
  const [q, setQ] = useState('');
  const [results, setResults] = useState<readonly ConsultantOption[] | null>(null);
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
        const res = await searchConsultantsAction(term);
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
  }, [term]);

  return (
    <div className="flex min-w-0 flex-col gap-1" role="group" aria-labelledby={`${id}-l`}>
      <span id={`${id}-l`} className="text-small font-semibold">
        {label}
      </span>
      {value ? (
        <span className="flex flex-wrap items-center gap-2">
          <span className="text-small" aria-live="polite">
            Dipilih: <span className="font-semibold">{value.nama}</span>
            {value.units.length > 0 ? ` · ${value.units.join(', ')}` : ''}
          </span>
          <Button onClick={() => onChange(null)}>Ganti dokter</Button>
        </span>
      ) : (
        <>
          <label htmlFor={`${id}-q`} className="text-caption text-ink-700">
            Cari nama dokter atau unit (minimal 2 huruf)
          </label>
          <input
            id={`${id}-q`}
            type="search"
            value={q}
            autoComplete="off"
            onChange={(e) => setQ(e.target.value)}
            className={INPUT}
          />
          <span className="text-caption text-ink-500" aria-live="polite">
            {pending
              ? 'Mencari…'
              : error
                ? error
                : results === null
                  ? ''
                  : results.length === 0
                    ? 'Tidak ada dokter yang cocok.'
                    : `${results.length} dokter ditemukan${results.length >= 20 ? '; persempit pencarian bila belum tampil' : ''}.`}
          </span>
          {results && results.length > 0 && (
            <ul
              aria-label={`Hasil pencarian ${label.toLowerCase()}`}
              className="m-0 flex list-none flex-col gap-1 p-0"
            >
              {results.map((c) => (
                <li key={c.userId}>
                  <button
                    type="button"
                    onClick={() => onChange(c)}
                    className={cx(
                      'flex min-h-11 w-full cursor-pointer flex-col items-start rounded-control border border-line-strong bg-white px-3 py-1.5 text-left font-[inherit] text-small hover:bg-brand-50/60',
                    )}
                  >
                    <span className="font-semibold">{c.nama}</span>
                    {c.units.length > 0 && (
                      <span className="text-caption text-ink-500">{c.units.join(', ')}</span>
                    )}
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
