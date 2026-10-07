'use client';

import { isoDateJakarta, type QueueBoard, type QueueDisplayEvent } from '@simrs/shared';
import { Icon } from '@simrs/ui';
import { useEffect, useRef, useState } from 'react';
import { type BoardClinicView, CallingPanel, ClinicCard } from '@/components/front-office/queue-board';
import { useDemoClock } from '@/components/front-office/use-demo-clock';
import { dateFull } from '@/lib/front-office';
import { applyQueueEvent, callAnnouncement } from '@/lib/queue-board';
import { connectQueueStream, type QueueStreamStatus } from '@/lib/queue-sse';
import { withBasePath } from '@/lib/base-path';

const SOUND_KEY = 'simrs.display.suara';

/** Nada pembuka dua ketukan (Web Audio), lalu kalimat panggilan (Web Speech id-ID). Diam bila browser tak mendukung. */
function announce(text: string): void {
  try {
    const Ctx = window.AudioContext;
    if (Ctx) {
      const ctx = new Ctx();
      [880, 660].forEach((hz, i) => {
        const osc = ctx.createOscillator();
        const gain = ctx.createGain();
        osc.frequency.value = hz;
        gain.gain.setValueAtTime(0.0001, ctx.currentTime + i * 0.45);
        gain.gain.exponentialRampToValueAtTime(0.3, ctx.currentTime + i * 0.45 + 0.03);
        gain.gain.exponentialRampToValueAtTime(0.0001, ctx.currentTime + i * 0.45 + 0.4);
        osc.connect(gain).connect(ctx.destination);
        osc.start(ctx.currentTime + i * 0.45);
        osc.stop(ctx.currentTime + i * 0.45 + 0.42);
      });
      setTimeout(() => void ctx.close(), 1500);
    }
    if ('speechSynthesis' in window) {
      const u = new SpeechSynthesisUtterance(text);
      u.lang = 'id-ID';
      u.rate = 0.9;
      setTimeout(() => window.speechSynthesis.speak(u), 950);
    }
  } catch {
    // Suara hanya pelengkap: papan tetap menampilkan panggilan.
  }
}

const STATUS_TEXT: Record<QueueStreamStatus, string> = {
  menyambung: 'Menyambung…',
  tersambung: 'Tersambung',
  terputus: 'Terputus · menyambung ulang',
};

/**
 * F04 · Papan antrean TV mode api (fase 2 potongan 4b): potret awal dari server, lalu event SSE lewat BFF
 * (`./events`). Panggilan langsung tampil tanpa muat ulang dan diumumkan (nada + suara id-ID; bisa dimatikan, dan
 * browser baru mengizinkan suara setelah petugas menekan "Aktifkan suara" sekali). Jam dinding nyata.
 */
export function LiveAntreanClient({
  tenantName,
  nowIso,
  initial,
}: {
  tenantName: string;
  nowIso: string;
  initial: QueueBoard;
}) {
  const { time, ms } = useDemoClock(nowIso);
  const [board, setBoard] = useState(initial);
  const [status, setStatus] = useState<QueueStreamStatus>('menyambung');
  const [sound, setSound] = useState(false);
  const soundRef = useRef(false);

  useEffect(() => {
    try {
      const on = window.localStorage.getItem(SOUND_KEY) === '1';
      soundRef.current = on;
      setSound(on);
    } catch {
      // Penyimpanan lokal tidak tersedia: suara tetap mati sampai diaktifkan.
    }
  }, []);

  useEffect(() => {
    const conn = connectQueueStream({
      url: withBasePath('/display/antrean/events'),
      onStatus: setStatus,
      onEvent: (ev: QueueDisplayEvent) => {
        setBoard((b) => applyQueueEvent(b, ev));
        if (ev.type === 'call' && soundRef.current) announce(callAnnouncement(ev));
      },
    });
    return () => conn.close();
  }, []);

  const toggleSound = () => {
    const next = !soundRef.current;
    soundRef.current = next;
    setSound(next);
    try {
      window.localStorage.setItem(SOUND_KEY, next ? '1' : '0');
    } catch {
      // abaikan
    }
    if (next) announce('Suara panggilan aktif.');
  };

  const meta = new Map(board.clinics.map((c) => [c.poliCode, c]));
  const callingMeta = board.calling ? meta.get(board.calling.poliCode) : undefined;
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
        backgroundColor: 'var(--color-canvas)',
        backgroundImage:
          'radial-gradient(1200px 700px at 0% 0%, var(--color-samudra-100) 0%, transparent 55%), radial-gradient(1000px 700px at 100% 100%, var(--color-samudra-50) 0%, transparent 55%)',
      }}
    >
      <header className="glass flex items-center justify-between border-b border-white/70 px-12 py-7">
        <div className="flex items-center gap-4">
          <div className="flex size-14 items-center justify-center rounded-[14px] bg-fajar text-white shadow-[0_6px_16px_rgba(44,85,196,0.35)]">
            <Icon name="plus" size={28} strokeWidth={2.2} />
          </div>
          <div className="flex flex-col">
            <h1 className="m-0 text-[28px] font-bold tracking-[-0.02em]">
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
          <span className="text-[20px] text-ink-700">{dateFull(isoDateJakarta(new Date(ms)))}</span>
        </div>
      </header>
      <div className="flex min-h-0 flex-1 gap-8 px-12 py-8">
        <CallingPanel
          queueNo={board.calling?.queueNo ?? '—'}
          poliName={callingMeta?.poliName ?? board.calling?.poliCode ?? ''}
          room={callingMeta ? `${callingMeta.room} · ${callingMeta.doctorName}` : ''}
          history={board.history.map((h) => h.queueNo)}
        />
        <section aria-label="Antrean per poli" className="grid flex-1 grid-cols-2 gap-6">
          {clinics.map((c) => (
            <ClinicCard key={c.poliCode} c={c} />
          ))}
        </section>
      </div>
      <footer className="flex items-center gap-6 bg-brand-900 px-12 py-5 text-white">
        <span className="flex-none rounded-lg bg-brand-600 px-3.5 py-1.5 text-[20px] font-bold">INFO</span>
        <span className="flex-1 text-[24px]">{board.info}</span>
        <div role="group" aria-label="Kontrol perangkat" className="flex flex-none items-center gap-3">
          <span
            role="status"
            className="flex items-center gap-2 text-[16px] whitespace-nowrap text-brand-200"
          >
            <Icon name={status === 'tersambung' ? 'check' : 'alert'} size={18} strokeWidth={2.2} />
            {STATUS_TEXT[status]}
          </span>
          <button
            type="button"
            aria-pressed={sound}
            onClick={toggleSound}
            className="h-11 cursor-pointer rounded-[10px] border border-white/30 bg-white/10 px-3.5 font-[inherit] text-[14px] font-semibold whitespace-nowrap text-white"
          >
            {sound ? 'Matikan suara' : 'Aktifkan suara'}
          </button>
        </div>
      </footer>
    </div>
  );
}
