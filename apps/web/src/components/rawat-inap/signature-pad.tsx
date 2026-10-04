'use client';

import { formatJam } from '@simrs/shared';
import { cx } from '@simrs/ui';
import { type PointerEvent, useId, useRef, useState } from 'react';
import { StrokeTracker } from './signature-stroke';

export interface SignatureValue {
  /** `goresan` = digambar di bantalan; `nama` = alternatif ketik nama (papan ketik / pembaca layar). */
  method: 'goresan' | 'nama';
  name: string;
  at: string;
}

const W = 600;
const H = 150;

/**
 * Bantalan tanda tangan aksesibel: kanvas dengan pointer events (jari, stylus, mouse) + tombol "Hapus" + alternatif
 * ketik nama lengkap. Koordinat dihitung dari ukuran tampil sehingga tetap tepat di dalam `ScaleToFit`.
 */
export function SignaturePad({
  label,
  signerName,
  disabled,
  value,
  onChange,
}: {
  label: string;
  signerName: string;
  disabled: boolean;
  value: SignatureValue | null;
  onChange: (v: SignatureValue | null) => void;
}) {
  const id = useId();
  const canvas = useRef<HTMLCanvasElement | null>(null);
  const stroke = useRef(new StrokeTracker());
  const [typed, setTyped] = useState('');

  const point = (e: PointerEvent<HTMLCanvasElement>) => {
    const c = e.currentTarget;
    const r = c.getBoundingClientRect();
    return { x: ((e.clientX - r.left) / r.width) * c.width, y: ((e.clientY - r.top) / r.height) * c.height };
  };
  /**
   * Akhiri goresan dengan bersih: `pointerup`, `pointercancel` (mis. sistem mengambil alih sentuhan), atau capture
   * hilang. Capture selalu dilepas; goresan yang cukup panjang menjadi tanda tangan.
   */
  const end = (e: PointerEvent<HTMLCanvasElement>) => {
    const c = e.currentTarget;
    if (c.hasPointerCapture(e.pointerId)) c.releasePointerCapture(e.pointerId);
    if (stroke.current.end(e.pointerId) && !value) {
      onChange({ method: 'goresan', name: signerName, at: formatJam(new Date()) });
    }
  };
  const clear = () => {
    const ctx = canvas.current?.getContext('2d');
    ctx?.clearRect(0, 0, W, H);
    stroke.current.reset();
    setTyped('');
    onChange(null);
  };

  return (
    <div className="flex flex-col gap-2">
      <div className="flex items-center justify-between gap-2">
        <span id={`${id}-label`} className="font-semibold">
          {label}
        </span>
        <button
          type="button"
          disabled={disabled || !value}
          onClick={clear}
          aria-label={`Hapus ${label.toLowerCase()}`}
          className="min-h-11 cursor-pointer rounded-control border border-line-strong bg-white px-3.5 font-[inherit] text-small disabled:cursor-not-allowed disabled:opacity-50"
        >
          Hapus
        </button>
      </div>
      <div
        className={cx(
          'relative overflow-hidden rounded-[12px] border-2 border-dashed bg-white',
          value ? 'border-brand-200' : 'border-line-strong',
          disabled && 'opacity-60',
        )}
      >
        <canvas
          ref={canvas}
          width={W}
          height={H}
          role="img"
          aria-labelledby={`${id}-label`}
          aria-describedby={`${id}-hint`}
          className={cx(
            'block h-[150px] w-full touch-none',
            disabled ? 'cursor-not-allowed' : 'cursor-crosshair',
          )}
          onPointerDown={(e) => {
            if (disabled || value?.method === 'nama') return;
            if (stroke.current.down(e.pointerId, point(e))) e.currentTarget.setPointerCapture(e.pointerId);
          }}
          onPointerMove={(e) => {
            const seg = stroke.current.move(e.pointerId, point(e));
            const ctx = seg ? e.currentTarget.getContext('2d') : null;
            if (!seg || !ctx) return;
            ctx.strokeStyle = '#14212B';
            ctx.lineWidth = 3;
            ctx.lineCap = 'round';
            ctx.beginPath();
            ctx.moveTo(seg.from.x, seg.from.y);
            ctx.lineTo(seg.to.x, seg.to.y);
            ctx.stroke();
          }}
          onPointerUp={end}
          onPointerCancel={end}
          onLostPointerCapture={end}
        />
        {!value && (
          <span className="pointer-events-none absolute inset-0 flex items-center justify-center text-ink-400">
            Tanda tangan di sini
          </span>
        )}
        {value?.method === 'nama' && (
          <span className="pointer-events-none absolute inset-0 flex items-center justify-center font-serif text-[28px] text-ink-900 italic">
            {value.name}
          </span>
        )}
      </div>
      <span id={`${id}-hint`} className="text-caption text-ink-700">
        {value
          ? `${value.name} · ${value.method === 'nama' ? 'nama diketik' : 'goresan'} · ${value.at}`
          : `${signerName} · belum menandatangani`}
      </span>
      {!value && (
        <form
          className="flex flex-wrap items-end gap-2"
          onSubmit={(e) => {
            e.preventDefault();
            if (typed.trim().length >= 3)
              onChange({ method: 'nama', name: typed.trim(), at: formatJam(new Date()) });
          }}
        >
          <label className="flex min-w-0 flex-1 flex-col gap-1 text-caption font-semibold text-ink-700">
            Atau ketik nama lengkap sebagai tanda tangan
            <input
              value={typed}
              disabled={disabled}
              onChange={(e) => setTyped(e.target.value)}
              className="h-11 rounded-control border border-line-strong bg-white px-3 font-[inherit] text-body font-normal text-ink-900"
            />
          </label>
          <button
            type="submit"
            disabled={disabled || typed.trim().length < 3}
            className="min-h-11 cursor-pointer rounded-control border border-line-strong bg-white px-3.5 font-[inherit] text-small font-semibold disabled:cursor-not-allowed disabled:opacity-50"
          >
            Pakai nama ketik
          </button>
        </form>
      )}
    </div>
  );
}
