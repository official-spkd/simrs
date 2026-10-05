'use client';

import { type ReactNode, useEffect, useRef, useState } from 'react';
import { fitScale } from '@/lib/fit-scale';

/**
 * Menampilkan kanvas berukuran tetap (anjungan, TV antrean, tablet, ponsel) utuh di ruang yang tersedia saat
 * presentasi: diperkecil/diperbesar dengan `transform: scale`, di tengah. Ukuran ruang diukur dari wadahnya (bukan
 * jendela), sehingga baris presenter di atas atau panel petunjuk di samping tidak menutupi kanvas. Ukuran asli tetap
 * dipakai untuk tata letak sehingga tampilannya sama dengan perangkat sesungguhnya.
 */
export function ScaleToFit({
  width,
  height,
  label,
  children,
  className,
}: {
  width: number;
  height: number;
  /** Nama perangkat untuk pembaca layar, mis. "Anjungan pendaftaran mandiri". */
  label: string;
  children: ReactNode;
  className?: string;
}) {
  const frame = useRef<HTMLDivElement>(null);
  const [scale, setScale] = useState<number | null>(null);
  useEffect(() => {
    const el = frame.current;
    if (!el) return;
    const update = () => setScale(fitScale(el.clientWidth, el.clientHeight, width, height));
    update();
    const observer = new ResizeObserver(update);
    observer.observe(el);
    return () => observer.disconnect();
  }, [width, height]);
  return (
    <div ref={frame} className="flex min-h-0 w-full flex-1 items-center justify-center overflow-hidden">
      <div
        role="region"
        aria-label={label}
        data-scale={scale ?? undefined}
        className={className}
        style={{
          width,
          height,
          flex: 'none',
          transform: `scale(${scale ?? 1})`,
          transformOrigin: 'center center',
          visibility: scale === null ? 'hidden' : 'visible',
        }}
      >
        {children}
      </div>
    </div>
  );
}
