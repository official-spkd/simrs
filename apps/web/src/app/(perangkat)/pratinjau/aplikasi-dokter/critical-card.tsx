'use client';

import type { DoctorAppInbox } from '@simrs/shared';
import { cx } from '@simrs/ui';
import Link from 'next/link';
import { useState } from 'react';
import { useDemoRunner } from '@/components/demo-sync';
import { criticalPendingText } from './doctor-pages';

type Critical = DoctorAppInbox['critical'];

const norm = (v: string) => v.trim().replace(',', '.');

/**
 * Nilai kritis kalium Tn. Hartono (I08, skenario IGD langkah `nilai-kritis`). Gerbang read-back: tombol
 * "Read-back benar" aktif hanya bila nilai yang dibacakan ulang sama dengan laporan lab. Bila tugas skenario
 * `readback` sedang giliran, tombol menjalankan tugas itu; tanpa skenario berjalan tombol nonaktif beralasan (pasien
 * skenario hanya maju lewat Simulasi). Nilai kritis pasien lain dicatat lewat `OtherCriticals` ke `hasil-kritis`.
 * Selama hasil belum keluar kartu hanya menyebut status order (belum ada order / sedang diproses), tanpa nilai.
 */
export function CriticalCard({
  critical,
  rev,
  labOrdered,
  onOpenPatient,
  orderHref,
}: {
  critical: Critical;
  rev: number;
  /** Order lab skenario sudah dikirim (membedakan "belum ada order" dari "sedang diproses"). */
  labOrdered: boolean;
  onOpenPatient: () => void;
  /** CPOE kunjungan pasien ("Buka order" setelah diterima), bila tersedia. */
  orderHref: string | null;
}) {
  const runner = useDemoRunner(rev);
  const [readback, setReadback] = useState('');
  const [tried, setTried] = useState(false);
  const c = critical;
  const accepted = c.state === 'diterima' ? c.acceptedAt : null;
  const head = `${c.analyte} ${c.value} ${c.unit}`;

  if (c.state === 'menunggu-hasil') {
    return (
      <section
        role="status"
        aria-label="Nilai kritis"
        className="rounded-[16px] border border-line bg-white p-3.5 text-[13px]"
      >
        <span className="font-semibold">Belum ada nilai kritis</span>
        <span className="block text-ink-700">
          {criticalPendingText(c, labOrdered)} Notifikasi masuk saat analis melaporkan nilai kritis.
        </span>
      </section>
    );
  }

  if (accepted) {
    return (
      <section
        role="status"
        aria-label="Nilai kritis"
        className="flex flex-col gap-2 rounded-[16px] border border-zamrud-200 bg-zamrud-50 p-3.5"
      >
        <span className="font-semibold text-success">Diterima {accepted} · read-back tercatat</span>
        <span className="text-[13px] text-ink-700">
          {head} · {c.patientName} · {c.location}. Nilai dibacakan ulang ke analis lab; order tata laksana
          hiperkalemia dilanjutkan ke perawat IGD.
        </span>
        <span className={cx('grid gap-2', orderHref ? 'grid-cols-2' : 'grid-cols-1')}>
          <button
            type="button"
            onClick={onOpenPatient}
            className="h-12 cursor-pointer rounded-[12px] border border-line-strong bg-white px-3 font-[inherit] font-medium"
          >
            Lihat EKG
          </button>
          {orderHref ? (
            <Link
              href={orderHref}
              className="flex h-12 items-center justify-center rounded-[12px] border border-brand-800 bg-white px-3 font-semibold text-brand-700 no-underline"
            >
              Buka order
            </Link>
          ) : null}
        </span>
      </section>
    );
  }

  const waiting = c.state === 'menunggu-laporan';
  const matches = norm(readback) === norm(c.value);
  const reason = waiting
    ? 'Menunggu laporan telepon dari analis lab sebelum read-back.'
    : c.mode !== 'skenario'
      ? 'Tn. Hartono pasien skenario Simulasi IGD: read-back tersimpan saat skenario sampai langkah nilai kritis (layar Simulasi).'
      : runner.pending
        ? 'Mencatat read-back…'
        : !matches
          ? 'Ketik nilai yang Anda bacakan ulang ke analis lab.'
          : null;
  const confirm = () => {
    if (!matches || waiting) return;
    if (c.mode === 'skenario' && c.stepIndex !== null) {
      runner.run({ type: 'task', step: c.stepIndex, task: 'readback', value: true, scenario: 'igd-ranap' });
    }
  };

  return (
    <section
      role="alert"
      aria-label="Nilai kritis"
      className="flex flex-col gap-2.5 rounded-[16px] border border-koral-200 bg-koral-50 p-3.5"
    >
      <span className="flex items-start gap-2.5">
        <span
          className="flex h-7 w-7 shrink-0 items-center justify-center rounded-full bg-danger font-bold text-white"
          aria-hidden="true"
        >
          !
        </span>
        <span className="flex flex-col">
          <span className="font-semibold text-danger">Nilai kritis · {head}</span>
          <span className="text-[12.5px] text-ink-700">
            {c.patientName} · RM {c.rm} · {c.location}
            {c.resultAt ? ` · hasil ${c.resultAt}` : ''}
          </span>
          <span className="text-[12.5px] text-ink-700">
            Dilaporkan {c.reportedBy}
            {c.reportedTo ? ` ke ${c.reportedTo}` : ''}
          </span>
        </span>
      </span>
      <form
        onSubmit={(e) => {
          e.preventDefault();
          setTried(true);
          confirm();
        }}
        className="flex flex-col gap-1.5"
      >
        <label htmlFor="readback-nilai" className="text-[13px] font-semibold text-ink-900">
          Nilai {c.analyte.toLowerCase()} yang dibacakan ulang ({c.unit})
        </label>
        <span className="flex gap-2">
          <input
            id="readback-nilai"
            inputMode="decimal"
            autoComplete="off"
            value={readback}
            disabled={waiting}
            onChange={(e) => setReadback(e.target.value)}
            aria-invalid={tried && !matches ? true : undefined}
            aria-describedby="readback-alasan"
            placeholder="mis. 6,8"
            className={cx(
              'h-11 min-w-0 flex-1 rounded-[12px] border bg-white px-3 font-[inherit]',
              tried && !matches ? 'border-danger' : 'border-line-strong',
            )}
          />
          <button
            type="submit"
            disabled={reason !== null}
            className="h-11 shrink-0 cursor-pointer rounded-[12px] border border-koral-700 bg-danger px-3.5 font-[inherit] font-semibold text-white disabled:cursor-not-allowed disabled:border-line disabled:bg-muted disabled:text-ink-400"
          >
            Read-back benar
          </button>
        </span>
        <span id="readback-alasan" className="text-[12px] text-ink-700">
          {runner.error?.message ?? reason ?? 'Siap dicatat ke skenario IGD (tugas read-back).'}
        </span>
      </form>
      <button
        type="button"
        onClick={onOpenPatient}
        className="h-11 w-fit cursor-pointer rounded-[12px] border border-line-strong bg-white px-3.5 font-[inherit] font-semibold"
      >
        Lihat EKG
      </button>
    </section>
  );
}
