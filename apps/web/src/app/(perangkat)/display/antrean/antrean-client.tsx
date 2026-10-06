'use client';

import type { QueueBoard } from '@simrs/shared';
import { Icon } from '@simrs/ui';
import { useCallback, useEffect, useRef, useState } from 'react';
import { type BoardClinicView, CallingPanel, ClinicCard } from '@/components/front-office/queue-board';
import { useDemoClock } from '@/components/front-office/use-demo-clock';
import { useStoreAction } from '@/lib/demo/store/client';
import { callNextPoliAction } from './actions-demo';

/** Jeda panggilan otomatis presenter (mockup DisplayAntrean: 6 detik). */
const AUTO_MS = 6000;

export interface DisplayCallView {
  queueNo: string;
  place: string;
  room: string;
}

/**
 * F04 · Papan antrean ruang tunggu (TV 1920×1080) mode presentasi. Isi papan dari server (toko demo bersama):
 * kunjungan baru dari meja pendaftaran masuk "Berikutnya", panggilan loket dan poli tampil di "SEDANG DIPANGGIL",
 * dan papan memperbarui diri tanpa muat ulang (`DemoPolling`). Kontrol presenter: "Panggil berikutnya" dan panggilan
 * otomatis tiap 6 detik (bawaan mati); keduanya tersimpan sehingga semua layar melihat panggilan yang sama.
 * Nomor yang dicadangkan untuk petugas poli (PD-027) tidak dipanggil dari papan.
 */
export function AntreanClient({
  tenantName,
  nowIso,
  dateLabel,
  board,
  calling,
  history,
  loket,
}: {
  tenantName: string;
  nowIso: string;
  dateLabel: string;
  board: QueueBoard;
  calling: DisplayCallView;
  history: DisplayCallView[];
  loket: { current: string | null; waiting: string[] };
}) {
  const { time } = useDemoClock(nowIso);
  const { run, pending } = useStoreAction(0);
  const [auto, setAuto] = useState(false);
  const [left, setLeft] = useState(AUTO_MS / 1000);
  const [message, setMessage] = useState<string | null>(null);
  const timeRef = useRef(time);
  useEffect(() => {
    timeRef.current = time;
  }, [time]);

  const callNow = useCallback(
    () =>
      run(
        () => callNextPoliAction({ jam: timeRef.current }),
        (r) => {
          setMessage(r.ok ? null : r.message);
          if (r.empty) setAuto(false);
        },
      ),
    [run],
  );

  useEffect(() => {
    if (!auto) return;
    let n = AUTO_MS / 1000;
    setLeft(n);
    const id = window.setInterval(() => {
      n -= 1;
      if (n <= 0) {
        n = AUTO_MS / 1000;
        callNow();
      }
      setLeft(n);
    }, 1000);
    return () => window.clearInterval(id);
  }, [auto, callNow]);

  const clinics: BoardClinicView[] = board.clinics.map((c) => ({
    poliCode: c.poliCode,
    name: c.poliName,
    room: `${c.room} · ${c.doctorName}`,
    current: c.current ?? '—',
    next: c.waiting.slice(0, 2).join(', ') || '—',
    note: c.note,
    warn: c.noteTone === 'perhatian',
  }));

  return (
    <div
      className="flex h-full w-full flex-col text-ink-900"
      style={{
        backgroundColor: '#F3F6F8',
        backgroundImage:
          'radial-gradient(1200px 600px at 0% 0%, color-mix(in srgb, var(--color-brand-600) 10%, transparent), transparent 70%), radial-gradient(circle at 1px 1px, rgba(20,33,43,0.06) 1.2px, rgba(20,33,43,0) 1.8px)',
        backgroundSize: 'auto, 30px 30px',
      }}
    >
      <header className="flex items-center justify-between border-b border-line bg-white/90 px-12 py-7">
        <div className="flex items-center gap-4">
          <div className="flex size-14 items-center justify-center rounded-[14px] bg-[linear-gradient(135deg,var(--color-brand-500),var(--color-brand-600))] text-white">
            <Icon name="plus" size={28} strokeWidth={2.2} />
          </div>
          <div className="flex flex-col">
            <h1 className="m-0 text-[28px] font-bold">
              {tenantName} · {board.area}
            </h1>
            <span className="text-[20px] text-ink-700">
              Poli {board.clinics.map((c) => c.poliName).join(' · ')}
            </span>
          </div>
        </div>
        <div
          role="group"
          aria-label="Loket pendaftaran"
          className="flex flex-col items-center rounded-[18px] border border-line bg-white px-6 py-2"
        >
          <span className="text-[18px] font-semibold text-ink-700">Loket pendaftaran</span>
          <span className="font-mono text-[32px] font-bold text-brand-700">
            <span className="sr-only">Dilayani </span>
            {loket.current ?? '—'}
          </span>
          <span className="text-[18px] text-ink-700">
            Berikutnya:{' '}
            <span className="font-mono font-semibold text-ink-900">
              {loket.waiting.slice(0, 3).join(', ') || '—'}
            </span>
          </span>
        </div>
        <div className="flex flex-col items-end">
          <span className="font-mono text-[48px] font-semibold">
            <span className="sr-only">Pukul </span>
            {time}
          </span>
          <span className="text-[20px] text-ink-700">{dateLabel}</span>
        </div>
      </header>
      <div className="flex min-h-0 flex-1 gap-8 px-12 py-8">
        <CallingPanel
          queueNo={calling.queueNo}
          poliName=""
          place={calling.place}
          room={calling.room}
          history={history.map((h) => h.queueNo)}
        />
        <section aria-label="Antrean per poli" className="grid flex-1 grid-cols-2 gap-6">
          {clinics.map((c) => (
            <ClinicCard key={c.poliCode} c={c} />
          ))}
        </section>
      </div>
      <footer className="flex items-center gap-6 bg-ink-900 px-12 py-5 text-white">
        <span className="flex-none rounded-lg bg-brand-600 px-3.5 py-1.5 text-[20px] font-bold">INFO</span>
        <span className="flex-1 text-[24px]">{board.info}</span>
        <div role="group" aria-label="Kontrol presentasi" className="flex flex-none items-center gap-2">
          <span role="status" className="text-[14px] whitespace-nowrap text-[#B8C4CE]">
            {message ?? (auto ? `Otomatis · berikutnya ${left} dtk` : 'Panggilan otomatis mati')}
          </span>
          <button
            type="button"
            aria-pressed={auto}
            onClick={() => {
              setMessage(null);
              setAuto((a) => !a);
            }}
            className="h-11 cursor-pointer rounded-[10px] border border-white/30 bg-white/10 px-3.5 font-[inherit] text-[14px] font-semibold whitespace-nowrap text-white"
          >
            Panggilan otomatis
          </button>
          <button
            type="button"
            disabled={pending}
            onClick={callNow}
            className="h-11 cursor-pointer rounded-[10px] border border-white/30 bg-white/10 px-3.5 font-[inherit] text-[14px] font-semibold whitespace-nowrap text-white disabled:opacity-60"
          >
            Panggil berikutnya
          </button>
        </div>
      </footer>
    </div>
  );
}
