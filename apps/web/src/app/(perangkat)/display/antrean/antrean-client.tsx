'use client';

import type { QueueBoard } from '@simrs/shared';
import { Icon } from '@simrs/ui';
import { useEffect, useState } from 'react';
import { type BoardClinicView, CallingPanel, ClinicCard } from '@/components/front-office/queue-board';
import { useDemoClock } from '@/components/front-office/use-demo-clock';
import { boardCallNext, type BoardState } from '@/lib/front-office';

/** Jeda panggilan otomatis (mockup DisplayAntrean: 6 detik); panggilan pertama menunggu dua kali lebih lama. */
const AUTO_MS = 6000;

interface Ticker {
  board: BoardState;
  paused: boolean;
  /** Milidetik sejak layar dibuka saat panggilan terakhir / sekarang. */
  lastCall: number;
  now: number;
}

/**
 * F04 · Papan antrean ruang tunggu (TV 1920×1080): panggilan bergiliran antarpoli tiap 6 detik (bisa dijeda atau
 * dipanggil manual oleh presenter). Nomor yang dicadangkan untuk petugas poli (PD-027) tidak dipanggil otomatis.
 */
export function AntreanClient({
  tenantName,
  nowIso,
  dateLabel,
  board,
}: {
  tenantName: string;
  nowIso: string;
  dateLabel: string;
  /** Mode presentasi: fixture selalu punya panggilan berjalan (papan API tanpa panggilan diisi potongan 4b). */
  board: QueueBoard & { calling: NonNullable<QueueBoard['calling']> };
}) {
  const { time } = useDemoClock(nowIso);
  const [s, setS] = useState<Ticker>(() => ({
    board: { clinics: board.clinics, calling: board.calling, history: board.history },
    paused: false,
    lastCall: AUTO_MS,
    now: 0,
  }));

  useEffect(() => {
    const t0 = Date.now();
    const id = setInterval(() => {
      const t = Date.now() - t0;
      setS((cur) =>
        !cur.paused && t - cur.lastCall >= AUTO_MS
          ? { ...cur, board: boardCallNext(cur.board), lastCall: t, now: t }
          : { ...cur, now: t },
      );
    }, 1000);
    return () => clearInterval(id);
  }, []);

  const meta = new Map(board.clinics.map((c) => [c.poliCode, c]));
  const callingMeta = meta.get(s.board.calling.poliCode);
  const clinics: BoardClinicView[] = s.board.clinics.map((c) => {
    const m = meta.get(c.poliCode);
    return {
      poliCode: c.poliCode,
      name: m?.poliName ?? c.poliCode,
      room: m ? `${m.room} · ${m.doctorName}` : '',
      current: c.current ?? '—',
      next: c.waiting.slice(0, 2).join(', ') || '—',
      note: m?.note ?? '',
      warn: m?.noteTone === 'perhatian',
    };
  });
  const left = Math.max(0, Math.ceil((AUTO_MS - (s.now - s.lastCall)) / 1000));

  const toggle = () => setS((cur) => ({ ...cur, paused: !cur.paused, lastCall: cur.now }));
  const callNow = () => setS((cur) => ({ ...cur, board: boardCallNext(cur.board), lastCall: cur.now }));

  return (
    <div
      className="flex h-full w-full flex-col text-ink-900"
      style={{
        backgroundColor: '#F3F6F8',
        backgroundImage:
          'radial-gradient(1200px 600px at 0% 0%, rgba(15,118,110,0.10), rgba(15,118,110,0) 70%), radial-gradient(circle at 1px 1px, rgba(20,33,43,0.06) 1.2px, rgba(20,33,43,0) 1.8px)',
        backgroundSize: 'auto, 30px 30px',
      }}
    >
      <header className="flex items-center justify-between border-b border-line bg-white/90 px-12 py-7">
        <div className="flex items-center gap-4">
          <div className="flex size-14 items-center justify-center rounded-[14px] bg-[linear-gradient(135deg,#1D7E77,#0F766E)] text-white">
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
          queueNo={s.board.calling.queueNo}
          poliName={callingMeta?.poliName ?? ''}
          room={callingMeta ? `${callingMeta.room} · ${callingMeta.doctorName}` : ''}
          history={s.board.history.map((h) => h.queueNo)}
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
          <span className="text-[14px] whitespace-nowrap text-[#B8C4CE]">
            {s.paused ? 'Panggilan otomatis dijeda' : `Otomatis · berikutnya ${left} dtk`}
          </span>
          <button
            type="button"
            aria-pressed={s.paused}
            onClick={toggle}
            className="h-11 cursor-pointer rounded-[10px] border border-white/30 bg-white/10 px-3.5 font-[inherit] text-[14px] font-semibold whitespace-nowrap text-white"
          >
            {s.paused ? 'Lanjut' : 'Jeda'}
          </button>
          <button
            type="button"
            onClick={callNow}
            className="h-11 cursor-pointer rounded-[10px] border border-white/30 bg-white/10 px-3.5 font-[inherit] text-[14px] font-semibold whitespace-nowrap text-white"
          >
            Panggil berikutnya
          </button>
        </div>
      </footer>
    </div>
  );
}
