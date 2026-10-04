'use client';

import { cx, Icon } from '@simrs/ui';
import Link from 'next/link';
import { useState } from 'react';
import { useDemoRunner } from '@/components/demo-sync';

export interface KioskScenarioTask {
  id: string;
  label: string;
  done: boolean;
  enabled: boolean;
}

/** Keadaan langkah `kedatangan` skenario rawat jalan di anjungan (dihitung server dari replay skenario). */
export interface KioskScenarioView {
  rev: number;
  /** Indeks langkah kedatangan bila langkah itu sedang aktif; null bila tidak. */
  step: number | null;
  label: string;
  patientName: string;
  tasks: KioskScenarioTask[];
  /** Nilai biometrik yang sudah dipilih (`wajah`/`jari`). */
  bioValue: string | null;
  canNext: boolean;
  nextLabel: string;
  ticketDone: boolean;
}

/**
 * Petunjuk presenter di luar kanvas anjungan (mode presentasi): kode booking Tn. Suryo, kemajuan tugas
 * langkah kedatangan, dan tombol lanjut ke langkah Pendaftaran setelah tiket tercetak. Bisa diciutkan.
 */
export function KioskPresenterHint({
  scenario,
  bookingCode,
  ticketNo,
}: {
  scenario: KioskScenarioView;
  bookingCode: string;
  ticketNo: string;
}) {
  const [open, setOpen] = useState(true);
  const { run, pending, error } = useDemoRunner(scenario.rev);
  if (!open) {
    return (
      <button
        type="button"
        aria-expanded={false}
        onClick={() => setOpen(true)}
        className="fixed top-3 right-3 z-50 inline-flex min-h-11 cursor-pointer items-center gap-1.5 rounded-full border border-[#9FCFC8] bg-white/95 px-3 font-[inherit] text-caption font-semibold text-brand-700 shadow-sm"
      >
        <Icon name="play" size={13} />
        Petunjuk presenter
      </button>
    );
  }
  return (
    <aside
      aria-label="Petunjuk presenter"
      className="fixed top-3 right-3 z-50 flex w-[320px] max-w-[calc(100vw-24px)] flex-col gap-2 rounded-card border border-[#9FCFC8] bg-white/95 p-3 shadow-[0_4px_16px_rgba(15,118,110,0.18)]"
    >
      <span className="flex items-start justify-between gap-2">
        <span className="text-caption font-semibold text-brand-700">
          Simulasi · {scenario.label} · presenter
        </span>
        <button
          type="button"
          aria-expanded
          onClick={() => setOpen(false)}
          className="min-h-9 cursor-pointer rounded-[9px] border border-line-strong bg-white px-2 font-[inherit] text-caption"
        >
          Ciutkan
        </button>
      </span>
      {scenario.ticketDone ? (
        <span className="text-small text-ink-900">
          {scenario.patientName} sudah check-in · tiket{' '}
          <span className="font-mono font-semibold">{ticketNo}</span> menunggu dipanggil di loket pendaftaran.
        </span>
      ) : (
        <span className="text-small text-ink-900">
          {scenario.patientName} check-in: pilih <b>Saya sudah punya booking</b> → <b>Kode booking</b>, lalu
          ketik{' '}
          <span className="rounded bg-brand-50 px-1 font-mono font-semibold text-brand-700">
            {bookingCode}
          </span>
          .
        </span>
      )}
      <ul className="m-0 flex list-none flex-col gap-1 p-0 text-small">
        {scenario.tasks.map((t) => (
          <li
            key={t.id}
            className={cx('flex items-center gap-1.5', t.done ? 'text-success' : 'text-ink-700')}
          >
            <Icon name={t.done ? 'check' : 'clock'} size={13} strokeWidth={2.2} />
            <span className="sr-only">{t.done ? 'Selesai: ' : t.enabled ? 'Giliran: ' : 'Menunggu: '}</span>
            {t.label}
          </li>
        ))}
      </ul>
      {scenario.canNext && (
        <button
          type="button"
          disabled={pending}
          onClick={() => run({ type: 'next', scenario: 'rawat-jalan' })}
          className="min-h-11 cursor-pointer rounded-control border border-brand-800 bg-brand-600 px-3 font-[inherit] text-small font-semibold text-white disabled:cursor-wait disabled:opacity-70"
        >
          {scenario.nextLabel}
        </button>
      )}
      {scenario.ticketDone && (
        <Link href="/pendaftaran" className="text-small font-semibold">
          Buka layar Pendaftaran (loket 3)
        </Link>
      )}
      {error && (
        <span role="alert" className="text-caption text-danger">
          {error.message}
        </span>
      )}
    </aside>
  );
}
