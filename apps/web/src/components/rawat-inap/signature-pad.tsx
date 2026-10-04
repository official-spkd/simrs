'use client';

import { formatJam } from '@simrs/shared';
import { cx } from '@simrs/ui';
import { type PointerEvent, useId, useRef, useState } from 'react';

export interface SignatureValue {
  /** `goresan` = digambar di bantalan; `nama` = alternatif ketik nama (papan ketik / pembaca layar). */
  method: 'goresan' | 'nama';
  name: string;
  at: string;
}

const W = 600;
const H = 150;
/** Panjang goresan minimal (piksel kanvas) agar dianggap tanda tangan, bukan sentuhan tak sengaja. */
const MIN_STROKE = 60;

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
  const drawing = useRef(false);
  const last = useRef<{ x: number; y: number } | null>(null);
  const length = useRef(0);
  const [typed, setTyped] = useState('');

  const point = (e: PointerEvent<HTMLCanvasElement>) => {
    const c = e.currentTarget;
    const r = c.getBoundingClientRect();
    return { x: ((e.clientX - r.left) / r.width) * c.width, y: ((e.clientY - r.top) / r.height) * c.height };
  };
  const clear = () => {
    const ctx = canvas.current?.getContext('2d');
    ctx?.clearRect(0, 0, W, H);
    length.current = 0;
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
            e.currentTarget.setPointerCapture(e.pointerId);
            drawing.current = true;
            last.current = point(e);
          }}
          onPointerMove={(e) => {
            if (!drawing.current || !last.current) return;
            const ctx = e.currentTarget.getContext('2d');
            const p = point(e);
            if (ctx) {
              ctx.strokeStyle = '#14212B';
              ctx.lineWidth = 3;
              ctx.lineCap = 'round';
              ctx.beginPath();
              ctx.moveTo(last.current.x, last.current.y);
              ctx.lineTo(p.x, p.y);
              ctx.stroke();
            }
            length.current += Math.hypot(p.x - last.current.x, p.y - last.current.y);
            last.current = p;
          }}
          onPointerUp={() => {
            if (!drawing.current) return;
            drawing.current = false;
            last.current = null;
            if (length.current >= MIN_STROKE && !value) {
              onChange({ method: 'goresan', name: signerName, at: formatJam(new Date()) });
            }
          }}
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
