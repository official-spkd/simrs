'use client';

import { formatJam } from '@simrs/shared';
import { cx } from '@simrs/ui';
import { useEffect, useRef, useState } from 'react';
import { STALE_TEXT } from '@/components/backoffice/use-toko';
import { useStoreAction } from '@/lib/demo/store/client';
import { readbackMatches } from '@/lib/manajemen-aplikasi';
import { DEMO_NOW } from '@/lib/demo/fixtures/waktu';
import { readbackCriticalAction } from './actions';

export interface AppCritical {
  id: string;
  patientName: string;
  rm: string;
  location: string;
  test: string;
  valueText: string;
  raisedAt: string;
  report: { recipient: string; reportedAt: string } | null;
}

/**
 * I08 · Nilai kritis lain untuk dokter (dari Pusat hasil kritis, bukan pasien skenario): dokter membacakan ulang
 * nilainya; read-back tersimpan ke domain `hasil-kritis` atas nama pengguna sesi sehingga Pusat hasil kritis dan
 * Laboratorium menutup hasil kritis itu.
 */
export function OtherCriticals({ items, rev }: { items: readonly AppCritical[]; rev: number }) {
  const { run, pending } = useStoreAction(rev);
  const [values, setValues] = useState<Record<string, string>>({});
  const [msg, setMsg] = useState<{ id: string; ok: boolean; text: string } | null>(null);
  const opened = useRef(0);
  useEffect(() => {
    opened.current = Date.now();
  }, []);
  if (items.length === 0) return null;
  return (
    <section aria-label="Nilai kritis lain" className="flex flex-col gap-2.5">
      <span className="font-semibold">Nilai kritis lain untuk Anda</span>
      {items.map((c) => {
        const v = values[c.id] ?? '';
        const ok = readbackMatches(c.valueText, v);
        return (
          <div
            key={c.id}
            role="group"
            aria-label={`Nilai kritis ${c.patientName}`}
            className={cx(
              'flex flex-col gap-1.5 rounded-[16px] border p-3',
              c.report ? 'border-zamrud-200 bg-zamrud-50' : 'border-koral-200 bg-koral-50',
            )}
          >
            <span className="text-[13.5px] font-semibold">
              {c.test} · {c.valueText}
            </span>
            <span className="text-[12.5px] text-ink-700">
              {c.patientName} · RM {c.rm} · {c.location}
            </span>
            {c.report ? (
              <span role="status" className="text-[12.5px] font-semibold text-success">
                Read-back tercatat {formatJam(c.report.reportedAt)} oleh {c.report.recipient}
              </span>
            ) : (
              <form
                onSubmit={(e) => {
                  e.preventDefault();
                  if (!ok) return;
                  const elapsed = Math.floor(
                    (Date.parse(DEMO_NOW) - Date.parse(c.raisedAt) + (Date.now() - opened.current)) / 1000,
                  );
                  run(
                    (r) =>
                      readbackCriticalAction({
                        id: c.id,
                        value: v,
                        rev: r,
                        elapsedSeconds: Math.max(0, elapsed),
                      }),
                    (res) => setMsg({ id: c.id, ok: res.ok, text: res.stale ? STALE_TEXT : res.message }),
                  );
                }}
                className="flex flex-col gap-1"
              >
                <label htmlFor={`rb-${c.id}`} className="text-[12.5px] font-semibold">
                  Nilai yang dibacakan ulang ({c.test.split(' · ')[0]})
                </label>
                <span className="flex gap-2">
                  <input
                    id={`rb-${c.id}`}
                    value={v}
                    autoComplete="off"
                    onChange={(e) => setValues((cur) => ({ ...cur, [c.id]: e.target.value }))}
                    className="h-11 min-w-0 flex-1 rounded-[12px] border border-line-strong bg-white px-3 font-[inherit]"
                  />
                  <button
                    type="submit"
                    disabled={!ok || pending}
                    className="h-11 shrink-0 cursor-pointer rounded-[12px] border border-koral-700 bg-danger px-3 font-[inherit] font-semibold text-white disabled:cursor-not-allowed disabled:border-line disabled:bg-muted disabled:text-ink-400"
                  >
                    Read-back benar<span className="sr-only"> {c.patientName}</span>
                  </button>
                </span>
                <span className="text-[12px] text-ink-700">
                  {msg?.id === c.id
                    ? msg.text
                    : ok
                      ? 'Siap dicatat ke Pusat hasil kritis.'
                      : 'Ketik nilai yang Anda bacakan ulang ke pelapor.'}
                </span>
              </form>
            )}
          </div>
        );
      })}
    </section>
  );
}
