'use client';

import type { PatientAppHome } from '@simrs/shared';
import { cx } from '@simrs/ui';
import { useState } from 'react';

/** "PD-021" + 2 → "PD-023". */
function bump(code: string, by: number): string {
  const m = /^(.*-)(\d+)$/.exec(code);
  if (!m) return code;
  const digits = m[2] ?? '0';
  return `${m[1] ?? ''}${String(Number(digits) + by).padStart(digits.length, '0')}`;
}

/** Pola kotak deterministik dari kode booking (hiasan mirip QR; kode tertulis di sebelahnya). */
function CodePattern({ code }: { code: string }) {
  const n = 13;
  let seed = [...code].reduce((a, c) => (a * 31 + c.charCodeAt(0)) % 2_147_483_647, 7);
  const cells: Array<[number, number]> = [];
  for (let y = 0; y < n; y++) {
    for (let x = 0; x < n; x++) {
      seed = (seed * 48_271) % 2_147_483_647;
      const finder = (x < 4 && y < 4) || (x > 8 && y < 4) || (x < 4 && y > 8);
      if (finder ? x % 3 === 0 || y % 3 === 0 || (x % 4 === 1 && y % 4 === 1) : seed % 3 === 0)
        cells.push([x, y]);
    }
  }
  return (
    <svg
      viewBox={`0 0 ${n} ${n}`}
      width={84}
      height={84}
      aria-hidden="true"
      className="shrink-0 rounded-md bg-white p-1.5"
    >
      {cells.map(([x, y]) => (
        <rect key={`${x}-${y}`} x={x} y={y} width={1} height={1} fill="#14212B" />
      ))}
    </svg>
  );
}

/**
 * Kartu antrean aktif aplikasi pasien (mockup AppPasien). Nomor dan tahap mengikuti skenario rawat jalan
 * (booking → A-031 → PD-027); tombol "Maju" hanya mensimulasikan antrean bergerak di ponsel ini.
 */
export function QueueCard({
  queue,
  payer,
  onAdvance,
}: {
  queue: PatientAppHome['queue'];
  payer: string;
  /** Dipanggil setelah antrean maju dengan sisa pasien di depan (notifikasi saat tersisa 3 dan giliran tiba). */
  onAdvance?: (ahead: number) => void;
}) {
  const [moved, setMoved] = useState(0);
  const total = queue.ahead;
  const ahead = total === null ? null : Math.max(0, total - moved);
  const serving =
    queue.serving && total ? (ahead === 0 ? queue.number : bump(queue.serving, moved)) : queue.serving;
  const pct = total
    ? Math.round(((total - (ahead ?? 0)) / total) * 100)
    : queue.stage === 'pulang'
      ? 100
      : null;

  return (
    <section
      aria-label="Antrean aktif"
      className="flex flex-col gap-3 rounded-[18px] bg-[linear-gradient(150deg,#0F766E,#0B5D56)] p-4 text-white"
    >
      <span className="flex items-center justify-between gap-2 text-[12.5px]">
        <span className="font-semibold">{queue.title}</span>
        <span className="rounded-full bg-white/20 px-2 py-0.5 font-semibold">{payer}</span>
      </span>
      <span className="flex items-end justify-between gap-3">
        <span className="flex flex-col">
          <span className="text-[12px] text-white/80">{queue.numberLabel}</span>
          <span className="font-mono text-[34px] leading-tight font-bold">{queue.number}</span>
        </span>
        {queue.stage === 'booking' ? (
          <CodePattern code={queue.number} />
        ) : serving ? (
          <span className="flex flex-col items-end">
            <span className="text-[12px] text-white/80">Sedang dilayani</span>
            <span className="font-mono text-[20px] font-semibold">{serving}</span>
          </span>
        ) : null}
      </span>
      {pct !== null && (
        <span className="h-1.5 overflow-hidden rounded-full bg-white/25" aria-hidden="true">
          <span className="block h-1.5 rounded-full bg-white" style={{ width: `${pct}%` }} />
        </span>
      )}
      <span aria-live="polite" className="flex items-start justify-between gap-3 text-[13px]">
        <span className="flex flex-col gap-0.5">
          {ahead !== null && ahead > 0 && (
            <span className="font-semibold">
              {ahead} pasien lagi · perkiraan ±{ahead * 7} menit
              {ahead <= 3 ? '. Silakan menuju ruang tunggu.' : '. Notifikasi dikirim saat tersisa 3.'}
            </span>
          )}
          {ahead === 0 && queue.stage !== 'pulang' && <span className="font-semibold">Giliran Anda.</span>}
          <span className="text-white/90">{queue.message}</span>
          <span className="text-[12px] text-white/85">{queue.location}</span>
        </span>
        {ahead !== null && ahead > 0 && (
          <button
            type="button"
            onClick={() => {
              setMoved(moved + 1);
              onAdvance?.(Math.max(0, (total ?? 0) - moved - 1));
            }}
            aria-label="Simulasi antrean maju satu pasien"
            className={cx(
              'h-11 shrink-0 cursor-pointer rounded-full border border-white/50 bg-white/15 px-4 font-[inherit] text-[13px] font-semibold text-white',
            )}
          >
            Maju
          </button>
        )}
      </span>
    </section>
  );
}
