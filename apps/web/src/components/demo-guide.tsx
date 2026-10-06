'use client';

import { Icon } from '@simrs/ui';
import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { useEffect, useRef, useState } from 'react';
import type { GuideView } from '@/lib/demo/guide-view';
import { useDemoRunner } from './demo-sync';
import { OpenScreenButton } from './open-screen-button';

/**
 * Panel panduan presenter (mode presentasi, ADR-0023): langkah skenario aktif, posisi pembawanya, tombol membuka
 * layar terkait sebagai posisi itu, dan "kerjakan 1 tugas" dengan nilai bawaan. Pemicunya ada di header lengket
 * (bukan melayang di atas isi, sehingga tidak pernah menutupi tombol layar); panelnya terbuka ke bawah dan tertutup
 * lagi saat pindah layar, Escape, atau klik di luar. Disembunyikan di layar Simulasi (isinya sudah lengkap di sana).
 */
export function DemoGuide({ guide, rev }: { guide: GuideView; rev: number }) {
  const pathname = usePathname();
  // Panel terbuka hanya di layar tempat dibuka: pindah layar = tertutup, layar baru tidak tertutup panel.
  const [openOn, setOpenOn] = useState<string | null>(null);
  const open = openOn === pathname;
  const { run, pending, error } = useDemoRunner(rev);
  const rootRef = useRef<HTMLElement>(null);
  const triggerRef = useRef<HTMLButtonElement>(null);

  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== 'Escape') return;
      setOpenOn(null);
      triggerRef.current?.focus();
    };
    const onPointer = (e: PointerEvent) => {
      if (e.target instanceof Node && !rootRef.current?.contains(e.target)) setOpenOn(null);
    };
    document.addEventListener('keydown', onKey);
    document.addEventListener('pointerdown', onPointer);
    return () => {
      document.removeEventListener('keydown', onKey);
      document.removeEventListener('pointerdown', onPointer);
    };
  }, [open]);

  if (pathname === '/simulasi') return null;

  const label = guide.finished ? 'Simulasi selesai' : `Simulasi · ${guide.stepNo} · ${guide.stage}`;

  return (
    // Di ponsel header membungkus: pemicu rata kanan agar panelnya (rata kanan) tetap di dalam layar.
    <aside ref={rootRef} aria-label="Panduan simulasi" className="relative max-sm:ml-auto">
      <button
        ref={triggerRef}
        type="button"
        onClick={() => setOpenOn(open ? null : pathname)}
        aria-expanded={open}
        aria-controls={open ? 'panduan-simulasi' : undefined}
        // Label lengkap untuk pembaca layar dan tooltip; teks terlihat diringkas di layar sempit (awalannya sama).
        aria-label={label}
        title={label}
        className="flex min-h-11 cursor-pointer items-center gap-1.5 rounded-full border border-brand-800 bg-brand-600 px-3.5 font-[inherit] text-small font-semibold whitespace-nowrap text-white"
      >
        <Icon name="play" size={16} className="flex-none" />
        {guide.finished ? (
          'Simulasi selesai'
        ) : (
          <span>
            Simulasi · {guide.stepNo}
            <span className="hidden lg:inline"> · {guide.stage}</span>
          </span>
        )}
      </button>
      {open && (
        <div
          id="panduan-simulasi"
          className="absolute top-full right-0 z-40 mt-2 flex w-[360px] max-w-[calc(100vw-3rem)] flex-col gap-2.5 animate-pal-in rounded-card border border-white/95 bg-white/95 p-4 shadow-float backdrop-blur-xl"
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
          <Link href="/simulasi" className="inline-flex min-h-11 items-center text-small font-semibold">
            Buka layar Simulasi →
          </Link>
        </div>
      )}
    </aside>
  );
}
