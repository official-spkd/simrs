'use client';

import type { PatientAppHome } from '@simrs/shared';
import { cx } from '@simrs/ui';
import { type FormEvent, useState } from 'react';
import { STALE_TEXT } from '@/components/backoffice/use-toko';
import { demoStamp } from '@/lib/backoffice-toko';
import { useStoreAction } from '@/lib/demo/store/client';
import { patientAppAction } from './actions';
import { GLUCOSE_BAND_LABEL, type GlucoseBand, glucoseBand } from '@/lib/manajemen';

const W = 320;
const H = 80;
const LO = 60;
const HI = 200;
const y = (v: number) =>
  Math.round((H - 6 - ((Math.min(Math.max(v, LO), HI) - LO) / (HI - LO)) * (H - 12)) * 10) / 10;
const x = (i: number, n: number) => 10 + (i * (W - 20)) / Math.max(n - 1, 1);
/** Titik terakhir per pita: brand = dalam sasaran, oranye = di atas, merah = di bawah (status juga dalam teks). */
const DOT: Record<GlucoseBand, string> = { dalam: '#0F766E', atas: '#C27A1A', bawah: '#B42318' };

/**
 * Gula darah mandiri 7 hari (mockup AppPasien): garis dengan pita sasaran dokter, catat hasil hari ini dengan
 * validasi jangkauan alat. Nilai di bawah sasaran ditandai bahaya (riwayat hipoglikemia berat) dalam teks, bukan
 * warna saja. Catatan tersimpan di toko demo (domain `aplikasi-pasien`) dan tampil lagi setelah muat ulang.
 */
export function GlucoseCard({
  glucose,
  target,
  recordedAt,
  rev,
}: {
  glucose: PatientAppHome['glucose'];
  target: PatientAppHome['glucoseTarget'];
  /** Jam catatan terakhir di aplikasi (null = data dari glukometer pagi ini). */
  recordedAt: string | null;
  rev: number;
}) {
  const values = glucose.map((g) => g.value);
  const when = recordedAt ? `dicatat ${recordedAt}` : 'pagi ini';
  const { run, pending } = useStoreAction(rev);
  const [open, setOpen] = useState(false);
  const [text, setText] = useState('');
  const [err, setErr] = useState('');
  const last = values.at(-1) ?? 0;
  const band = glucoseBand(last, target);
  const d = values.map((v, i) => `${i ? 'L' : 'M'}${x(i, values.length)} ${y(v)}`).join(' ');

  const save = (e: FormEvent) => {
    e.preventDefault();
    const raw = text.replace(',', '.').trim();
    const v = Math.round(Number.parseFloat(raw));
    if (!raw || Number.isNaN(v)) return setErr('Isi angka hasil pemeriksaan.');
    if (v < 20 || v > 600) return setErr('Angka di luar jangkauan alat (20–600 mg/dL). Periksa lagi.');
    run(
      (r) => patientAppAction({ event: { type: 'gula.dicatat', value: v, jam: demoStamp().jam }, rev: r }),
      (res) => {
        if (!res.ok) return setErr(res.stale ? STALE_TEXT : res.message);
        setOpen(false);
        setText('');
        setErr('');
      },
    );
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
        aria-label={`Gula darah 7 hari dari ${values[0]} ke ${last} mg/dL, ${GLUCOSE_BAND_LABEL[band]}; sasaran dokter ${target.min}–${target.max} mg/dL`}
      >
        <rect x={0} y={y(target.max)} width={W} height={y(target.min) - y(target.max)} fill="#EAF5EC" />
        <path d={d} fill="none" stroke="#0F766E" strokeWidth={2.2} strokeLinejoin="round" />
        <circle cx={x(values.length - 1, values.length)} cy={y(last)} r={4.5} fill={DOT[band]} />
      </svg>
      <span className="text-[12.5px] text-ink-700">
        Terakhir <span className="font-mono font-semibold text-ink-900">{last} mg/dL</span> {when} ·{' '}
        <span className={cx(band === 'bawah' && 'font-semibold text-danger')}>
          {GLUCOSE_BAND_LABEL[band]}
        </span>{' '}
        (pita hijau = {target.min}–{target.max})
      </span>
      {band === 'bawah' && (
        <span
          role="alert"
          className="rounded-[12px] border border-danger-border bg-danger-bg px-3 py-2 text-[12.5px] text-danger"
        >
          <span className="font-semibold">Gula darah rendah.</span> Segera makan atau minum yang manis,
          periksa ulang 15 menit lagi, dan hubungi rumah sakit bila tetap rendah atau badan terasa lemas.
        </span>
      )}
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
              disabled={pending}
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
