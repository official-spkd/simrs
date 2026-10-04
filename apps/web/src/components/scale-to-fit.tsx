'use client';

import { type ReactNode, useEffect, useState } from 'react';
import { fitScale } from '@/lib/fit-scale';

/**
 * Menampilkan kanvas berukuran tetap (anjungan, TV antrean, tablet, ponsel) utuh di jendela mana pun saat
 * presentasi: diperkecil/diperbesar dengan `transform: scale`, di tengah layar. Ukuran asli tetap dipakai untuk
 * tata letak sehingga tampilannya sama dengan perangkat sesungguhnya.
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
  const [scale, setScale] = useState<number | null>(null);
  useEffect(() => {
    const update = () => setScale(fitScale(window.innerWidth, window.innerHeight, width, height));
    update();
    window.addEventListener('resize', update);
    return () => window.removeEventListener('resize', update);
  }, [width, height]);
  return (
    <div className="flex h-screen w-full items-center justify-center overflow-hidden">
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
