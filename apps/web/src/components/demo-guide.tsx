'use client';

import { Icon } from '@simrs/ui';
import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { useEffect, useState } from 'react';
import type { GuideView } from '@/lib/demo/guide-view';
import { useDemoRunner } from './demo-sync';
import { OpenScreenButton } from './open-screen-button';

const OPEN_KEY = 'simrs-panduan-terbuka';

/**
 * Panel panduan presenter (mode presentasi, ADR-0023): langkah skenario aktif, posisi pembawanya, tombol membuka
 * layar terkait sebagai posisi itu, dan "kerjakan 1 tugas" dengan nilai bawaan. Tertutup secara bawaan agar tidak
 * menutupi layar yang sedang dipresentasikan; disembunyikan di layar Simulasi (isinya sudah lengkap di sana).
 */
export function DemoGuide({ guide, rev }: { guide: GuideView; rev: number }) {
  const pathname = usePathname();
  const [open, setOpen] = useState(false);
  const { run, pending, error } = useDemoRunner(rev);

  useEffect(() => {
    try {
      setOpen(sessionStorage.getItem(OPEN_KEY) === '1');
    } catch {
      // penyimpanan sesi tidak tersedia: tetap tertutup
    }
  }, []);
  const toggle = () => {
    setOpen((o) => {
      try {
        sessionStorage.setItem(OPEN_KEY, o ? '0' : '1');
      } catch {
        // abaikan
      }
      return !o;
    });
  };

  if (pathname === '/simulasi') return null;

  return (
    <aside
      aria-label="Panduan simulasi"
      className="fixed right-4 bottom-4 z-40 flex max-w-[calc(100vw-2rem)] flex-col items-end gap-2"
    >
      {open && (
        <div
          id="panduan-simulasi"
          className="flex w-[360px] max-w-full flex-col gap-2.5 rounded-card border border-line bg-white p-4 shadow-[0_12px_32px_rgba(16,24,40,0.18)]"
        >
          <span className="text-caption text-ink-500">
            {guide.scenarioLabel} · {guide.patientName}
          </span>
          <span className="flex flex-col gap-0.5">
            <span className="text-[12.5px] text-ink-500">
              Langkah {guide.stepNo} · {guide.stage}
            </span>
            <span className="font-semibold">{guide.title}</span>
          </span>
          {!guide.finished && (
            <>
              <span className="text-small text-ink-700">
                Peran: {guide.actor}
                {guide.roleName ? ` (posisi ${guide.roleName})` : ''}
                {guide.onRole ? ' · posisi sudah sesuai' : ''}
              </span>
              <span className="rounded-control bg-brand-50 px-3 py-2 text-small text-brand-700">
                {guide.nextTask ? `Tugas berikutnya: ${guide.nextTask}` : 'Semua tugas langkah ini selesai.'}
              </span>
              {guide.screen && (
                <OpenScreenButton
                  screen={guide.screen}
                  role={guide.role}
                  roleName={guide.roleName}
                  variant="button"
                />
              )}
              <button
                type="button"
                disabled={pending}
                onClick={() => run({ type: 'auto' })}
                className="min-h-11 cursor-pointer self-start rounded-control border border-line-strong bg-white px-4 font-[inherit] text-small font-medium text-ink-900 disabled:cursor-wait"
              >
                {guide.nextTask ? 'Kerjakan 1 tugas (nilai bawaan)' : 'Lanjut ke tahap berikutnya'}
              </button>
            </>
          )}
          {error && (
            <span role="alert" className="text-caption text-danger">
              {error.message}
            </span>
          )}
          <Link href="/simulasi" className="text-small font-semibold">
            Buka layar Simulasi →
          </Link>
        </div>
      )}
      <button
        type="button"
        onClick={toggle}
        aria-expanded={open}
        aria-controls="panduan-simulasi"
        className="flex min-h-11 cursor-pointer items-center gap-2 rounded-full border border-brand-800 bg-brand-600 px-4 font-[inherit] text-small font-semibold text-white shadow-[0_6px_18px_rgba(15,118,110,0.35)]"
      >
        <Icon name="play" size={16} />
        {guide.finished ? 'Simulasi selesai' : `Simulasi · ${guide.stepNo} · ${guide.stage}`}
      </button>
    </aside>
  );
}
