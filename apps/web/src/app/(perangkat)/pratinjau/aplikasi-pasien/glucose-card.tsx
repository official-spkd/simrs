'use client';

import { formatJam, type PatientAppHome } from '@simrs/shared';
import { cx } from '@simrs/ui';
import { type FormEvent, useState } from 'react';

const W = 320;
const H = 80;
const LO = 60;
const HI = 200;
const y = (v: number) =>
  Math.round((H - 6 - ((Math.min(Math.max(v, LO), HI) - LO) / (HI - LO)) * (H - 12)) * 10) / 10;
const x = (i: number, n: number) => 10 + (i * (W - 20)) / Math.max(n - 1, 1);

/**
 * Gula darah mandiri 7 hari (mockup AppPasien): garis dengan pita sasaran dokter, catat hasil hari ini dengan
 * validasi jangkauan alat. Catatan hanya di ponsel ini (simulasi, tidak disimpan).
 */
export function GlucoseCard({
  glucose,
  target,
}: {
  glucose: PatientAppHome['glucose'];
  target: PatientAppHome['glucoseTarget'];
}) {
  const [values, setValues] = useState(() => glucose.map((g) => g.value));
  const [when, setWhen] = useState('pagi ini');
  const [open, setOpen] = useState(false);
  const [text, setText] = useState('');
  const [err, setErr] = useState('');
  const last = values.at(-1) ?? 0;
  const inBand = last >= target.min && last <= target.max;
  const d = values.map((v, i) => `${i ? 'L' : 'M'}${x(i, values.length)} ${y(v)}`).join(' ');

  const save = (e: FormEvent) => {
    e.preventDefault();
    const raw = text.replace(',', '.').trim();
    const v = Math.round(Number.parseFloat(raw));
    if (!raw || Number.isNaN(v)) return setErr('Isi angka hasil pemeriksaan.');
    if (v < 20 || v > 600) return setErr('Angka di luar jangkauan alat (20–600 mg/dL). Periksa lagi.');
    setValues((cur) => [...cur.slice(1), v]);
    setWhen(`dicatat ${formatJam(new Date())} (simulasi, tidak disimpan)`);
    setOpen(false);
    setText('');
    setErr('');
  };

  return (
    <section
      aria-label="Gula darah"
      className="flex flex-col gap-2 rounded-[18px] border border-line bg-white p-4"
    >
      <span className="flex items-baseline justify-between">
        <span className="font-semibold">Gula darah mandiri</span>
        <span className="text-[12px] text-ink-500">7 hari</span>
      </span>
      <svg
        viewBox={`0 0 ${W} ${H}`}
        width="100%"
        height={H}
        role="img"
        aria-label={`Gula darah 7 hari dari ${values[0]} ke ${last} mg/dL; sasaran dokter ${target.min}–${target.max} mg/dL`}
      >
        <rect x={0} y={y(target.max)} width={W} height={y(target.min) - y(target.max)} fill="#EAF5EC" />
        <path d={d} fill="none" stroke="#0F766E" strokeWidth={2.2} strokeLinejoin="round" />
        <circle
          cx={x(values.length - 1, values.length)}
          cy={y(last)}
          r={4.5}
          fill={inBand ? '#0F766E' : '#C27A1A'}
        />
      </svg>
      <span className="text-[12.5px] text-ink-700">
        Terakhir <span className="font-mono font-semibold text-ink-900">{last} mg/dL</span> {when} ·{' '}
        {inBand ? 'dalam sasaran' : 'di atas sasaran'} (pita hijau = {target.min}–{target.max})
      </span>
      {!open ? (
        <button
          type="button"
          onClick={() => setOpen(true)}
          className="h-11 cursor-pointer rounded-[12px] border border-line-strong bg-white font-[inherit] font-semibold text-brand-700"
        >
          Catat hasil hari ini
        </button>
      ) : (
        <form onSubmit={save} className="flex flex-col gap-1.5">
          <label htmlFor="gd-input" className="text-[13px] font-semibold">
            Hasil gula darah (mg/dL)
          </label>
          <span className="flex gap-2">
            <input
              id="gd-input"
              type="number"
              inputMode="numeric"
              placeholder="mis. 132"
              value={text}
              onChange={(e) => {
                setText(e.target.value);
                setErr('');
              }}
              aria-invalid={err ? true : undefined}
              aria-describedby="gd-pesan"
              className={cx(
                'h-11 min-w-0 flex-1 rounded-[12px] border px-3 font-[inherit]',
                err ? 'border-danger' : 'border-line-strong',
              )}
            />
            <button
              type="button"
              onClick={() => {
                setOpen(false);
                setErr('');
              }}
              className="h-11 cursor-pointer rounded-[12px] border border-line-strong bg-white px-3 font-[inherit]"
            >
              Batal
            </button>
            <button
              type="submit"
              className="h-11 cursor-pointer rounded-[12px] border border-brand-800 bg-brand-600 px-3 font-[inherit] font-semibold text-white"
            >
              Simpan
            </button>
          </span>
          <span id="gd-pesan" className={cx('text-[12px]', err ? 'text-danger' : 'text-ink-500')}>
            {err || 'Masukkan angka dari glukometer. Nilai akan muncul di grafik.'}
          </span>
        </form>
      )}
    </section>
  );
}
