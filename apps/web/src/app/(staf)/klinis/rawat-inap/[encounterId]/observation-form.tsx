'use client';

import { CONSCIOUSNESS, ewsScore } from '@simrs/shared';
import { Button, cx, Field } from '@simrs/ui';
import { type ChangeEvent, useId, useState } from 'react';
import { useStoreAction } from '@/lib/demo/store/client';
import { ewsLevel } from '@/lib/rawat-inap';
import { recordObservationAction } from './actions-demo';

export interface ObservationEntry {
  encounterId: string;
  rev: number;
  /** Posisi perawat/bidan/dokter. */
  allowed: boolean;
  user: string;
}

type Key = 'temp' | 'hr' | 'rr' | 'sbp' | 'dbp' | 'spo2';

const FIELDS: Array<{ k: Key; label: string; mode: 'numeric' | 'decimal' }> = [
  { k: 'temp', label: 'Suhu (°C)', mode: 'decimal' },
  { k: 'hr', label: 'Nadi (x/mnt)', mode: 'numeric' },
  { k: 'rr', label: 'Napas (x/mnt)', mode: 'numeric' },
  { k: 'sbp', label: 'TD sistolik (mmHg)', mode: 'numeric' },
  { k: 'dbp', label: 'TD diastolik (mmHg)', mode: 'numeric' },
  { k: 'spo2', label: 'SpO2 (%)', mode: 'numeric' },
];

const CONSCIOUSNESS_LABEL: Record<(typeof CONSCIOUSNESS)[number], string> = {
  A: 'Sadar (A)',
  C: 'Bingung baru (C)',
  V: 'Respons suara (V)',
  P: 'Respons nyeri (P)',
  U: 'Tidak respons (U)',
};

const EMPTY: Record<Key, string> = { temp: '', hr: '', rr: '', sbp: '', dbp: '', spo2: '' };

/**
 * Isian observasi tanda vital baru (K12): pratinjau skor EWS dengan mesin NEWS2 bersama; server menghitung ulang
 * skor dan menyimpan observasi di toko demo atas nama pengguna sesi, lalu tabel dan ubin EWS diperbarui.
 */
export function ObservationForm({ entry }: { entry: ObservationEntry }) {
  const id = useId();
  const { run, pending } = useStoreAction(entry.rev);
  const [f, setF] = useState(EMPTY);
  const [onOxygen, setOxygen] = useState(false);
  const [consciousness, setConsciousness] = useState<(typeof CONSCIOUSNESS)[number]>('A');
  const [msg, setMsg] = useState<{ ok: boolean; text: string; field?: string } | null>(null);
  const set = (k: Key) => (e: ChangeEvent<HTMLInputElement>) =>
    setF((cur) => ({ ...cur, [k]: e.target.value }));
  const num = (k: Key) => Number(f[k].replace(',', '.'));
  const complete = FIELDS.every((x) => f[x.k].trim() !== '' && Number.isFinite(num(x.k)));
  const preview = complete
    ? ewsScore({
        temp: num('temp'),
        hr: num('hr'),
        rr: num('rr'),
        sbp: num('sbp'),
        spo2: num('spo2'),
        onOxygen,
        consciousness,
      })
    : null;
  const err = (k: Key) => (msg && !msg.ok && msg.field === k ? msg.text : null);

  if (!entry.allowed) {
    return (
      <p className="m-0 text-caption text-ink-500">
        Observasi baru dicatat posisi perawat, bidan, atau dokter.
      </p>
    );
  }

  return (
    <form
      aria-label="Catat observasi"
      className="flex flex-col gap-2.5 border-t border-line-soft pt-3"
      onSubmit={(e) => {
        e.preventDefault();
        run(
          (r) =>
            recordObservationAction(
              {
                encounterId: entry.encounterId,
                ...Object.fromEntries(FIELDS.map((x) => [x.k, f[x.k].replace(',', '.')])),
                onOxygen,
                consciousness,
              },
              r,
            ),
          (res) => {
            setMsg({ ok: res.ok, text: res.message, field: res.field });
            if (res.ok) setF(EMPTY);
          },
        );
      }}
    >
      <h3 className="m-0 text-small font-semibold">Catat observasi baru · {entry.user}</h3>
      <div className="grid grid-cols-2 gap-2.5 md:grid-cols-3">
        {FIELDS.map((x) => (
          <Field
            key={x.k}
            label={x.label}
            value={f[x.k]}
            inputMode={x.mode}
            onChange={set(x.k)}
            error={err(x.k)}
            required
          />
        ))}
      </div>
      <div className="flex flex-wrap items-end gap-3">
        <div className="flex flex-col gap-1">
          <label htmlFor={`${id}-sadar`} className="text-small font-semibold">
            Kesadaran (ACVPU)
          </label>
          <select
            id={`${id}-sadar`}
            value={consciousness}
            onChange={(e) => setConsciousness(e.target.value as (typeof CONSCIOUSNESS)[number])}
            className="h-11 rounded-control border border-line-strong bg-white px-3 font-[inherit]"
          >
            {CONSCIOUSNESS.map((c) => (
              <option key={c} value={c}>
                {CONSCIOUSNESS_LABEL[c]}
              </option>
            ))}
          </select>
        </div>
        <label className="flex min-h-11 items-center gap-2 text-small">
          <input
            type="checkbox"
            checked={onOxygen}
            onChange={(e) => setOxygen(e.target.checked)}
            className="size-[18px] accent-brand-600"
          />
          Mendapat oksigen tambahan
        </label>
        {preview !== null && (
          <span className={cx('rounded-full px-2.5 py-1 text-caption font-bold', ewsLevel(preview).tone)}>
            Pratinjau EWS {preview} · {ewsLevel(preview).level}
          </span>
        )}
      </div>
      <span className="flex flex-wrap items-center gap-3">
        <Button type="submit" variant="primary" disabled={pending || !complete}>
          {pending ? 'Menyimpan…' : 'Simpan observasi'}
        </Button>
        {!complete && <span className="text-caption text-ink-500">Isi keenam tanda vital.</span>}
        {msg && !msg.field && (
          <span
            role={msg.ok ? 'status' : 'alert'}
            className={cx('text-small font-semibold', msg.ok ? 'text-success' : 'text-danger')}
          >
            {msg.text}
          </span>
        )}
      </span>
    </form>
  );
}
