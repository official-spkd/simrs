import type { ReactNode } from 'react';

/**
 * Bingkai ponsel 390×844 untuk pratinjau aplikasi (dipakai di dalam `ScaleToFit`): sudut membulat, bilah status
 * palsu (jam, sinyal, baterai — dekoratif), lalu isi aplikasi mengisi sisa tinggi.
 */
export function PhoneFrame({ time, children }: { time: string; children: ReactNode }) {
  return (
    <div className="flex h-full w-full flex-col overflow-hidden rounded-[44px] border-[6px] border-ink-900 bg-canvas text-[14px] text-ink-900 shadow-float">
      <div className="flex h-9 shrink-0 items-center justify-between bg-white px-6 text-[13px] font-semibold">
        <span>{time}</span>
        <span className="flex items-center gap-1.5" aria-hidden="true">
          <svg width="18" height="12" viewBox="0 0 18 12">
            {[0, 1, 2, 3].map((i) => (
              <rect
                key={i}
                x={i * 4.5}
                y={9 - i * 3}
                width={3}
                height={3 + i * 3}
                rx={0.8}
                fill="var(--color-ink-900)"
              />
            ))}
          </svg>
          <svg width="16" height="12" viewBox="0 0 16 12">
            <path
              d="M8 11l2.2-2.6a3 3 0 0 0-4.4 0zM3.4 6.3a6.6 6.6 0 0 1 9.2 0M1 3.6a10 10 0 0 1 14 0"
              stroke="var(--color-ink-900)"
              strokeWidth="1.6"
              fill="none"
              strokeLinecap="round"
            />
          </svg>
          <svg width="24" height="12" viewBox="0 0 24 12">
            <rect
              x="0.8"
              y="0.8"
              width="19.4"
              height="10.4"
              rx="2.6"
              stroke="var(--color-ink-900)"
              strokeWidth="1.2"
              fill="none"
            />
            <rect x="2.6" y="2.6" width="13" height="6.8" rx="1.4" fill="var(--color-ink-900)" />
            <rect x="21.4" y="4" width="1.8" height="4" rx="0.9" fill="var(--color-ink-900)" />
          </svg>
        </span>
      </div>
      {children}
    </div>
  );
}
