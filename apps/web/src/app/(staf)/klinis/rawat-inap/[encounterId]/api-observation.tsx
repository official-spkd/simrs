'use client';

import {
  CONSCIOUSNESS,
  type EwsObservation,
  ewsScore,
  formatJam,
  type VitalSignsRecord,
} from '@simrs/shared';
import { Button, cx, Field } from '@simrs/ui';
import { useRouter } from 'next/navigation';
import { type ChangeEvent, useId, useState, useTransition } from 'react';
import { ewsLevel } from '@/lib/rawat-inap';
import { recordVitalsAction, type VitalsResult } from './actions-api';
import type { Me } from './api-workspace';
import { EwsPanel } from './inpatient-panels';

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

/** Bentuk tabel observasi bersama (mode presentasi) dari rekaman API, urut lama → baru. */
export function toEwsObservations(vitals: readonly VitalSignsRecord[]): EwsObservation[] {
  return [...vitals]
    .sort((a, b) => a.occurredAt.localeCompare(b.occurredAt))
    .map((v) => ({
      at: v.occurredAt,
      temp: v.values.temp,
      hr: v.values.hr,
      rr: v.values.rr,
      sbp: v.values.sbp,
      dbp: v.values.dbp,
      spo2: v.values.spo2,
      onOxygen: v.values.onOxygen,
      consciousness: v.values.consciousness,
      score: v.ews.score,
    }));
}

/**
 * Observasi tanda vital + NEWS2 mode api (K12): tabel dan ubin EWS bersama mode presentasi, isian baru dengan
 * pratinjau skor dari mesin bersama; skor resmi dan keputusan eskalasi (notifikasi DPJP/tim tanpa PHI + SSE `ews`)
 * dari server.
 */
export function ApiObservationTab({
  encounterId,
  vitals,
  me,
  canWrite,
}: {
  encounterId: string;
  vitals: VitalSignsRecord[];
  me: Me;
  canWrite: boolean;
}) {
  return (
    <div className="flex flex-col gap-3">
      <EwsPanel observations={toEwsObservations(vitals)} entry={null} />
      {canWrite ? (
        <VitalsForm encounterId={encounterId} me={me} />
      ) : (
        <p className="m-0 text-caption text-ink-500">Peran Anda hanya dapat membaca observasi pasien ini.</p>
      )}
    </div>
  );
}

function VitalsForm({ encounterId, me }: { encounterId: string; me: Me }) {
  const id = useId();
  const router = useRouter();
  const [busy, start] = useTransition();
  const [f, setF] = useState(EMPTY);
  const [onOxygen, setOxygen] = useState(false);
  const [consciousness, setConsciousness] = useState<(typeof CONSCIOUSNESS)[number]>('A');
  const [saved, setSaved] = useState<VitalsResult | null>(null);
  const [error, setError] = useState<string | null>(null);
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

  return (
    <form
      aria-label="Catat observasi"
      className="flex flex-col gap-2.5 rounded-card border border-white/95 bg-white/90 px-4 py-3.5 shadow-card"
      onSubmit={(e) => {
        e.preventDefault();
        setError(null);
        start(async () => {
          const r = await recordVitalsAction({
            encounterId,
            ...Object.fromEntries(FIELDS.map((x) => [x.k, f[x.k].replace(',', '.')])),
            onOxygen,
            consciousness,
          });
          if (!r.ok) return setError(r.message);
          setSaved(r.data);
          setF(EMPTY);
          setOxygen(false);
          setConsciousness('A');
          router.refresh();
        });
      }}
    >
      <h3 className="m-0 text-small font-semibold">Catat observasi baru · {me.name}</h3>
      {saved &&
        (saved.escalated ? (
          <div
            role="alert"
            className="rounded-control border border-koral-200 bg-alert-critical px-3.5 py-2.5 text-small"
          >
            <span className="block font-bold text-danger-strong">
              Eskalasi EWS: skor {saved.score} (risiko {saved.risk}) pukul {formatJam(saved.at)}
            </span>
            <span className="text-ink-700">
              Notifikasi terkirim ke DPJP dan tim perawatan. {ewsLevel(saved.score, saved.maxParam).action}
            </span>
          </div>
        ) : (
          <p role="status" className="m-0 text-small font-semibold text-success">
            Observasi tersimpan {formatJam(saved.at)} · EWS {saved.score} (risiko {saved.risk}).
          </p>
        ))}
      <div className="grid grid-cols-2 gap-2.5 md:grid-cols-3">
        {FIELDS.map((x) => (
          <Field key={x.k} label={x.label} value={f[x.k]} inputMode={x.mode} onChange={set(x.k)} required />
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
        <Button type="submit" variant="primary" disabled={busy || !complete}>
          {busy ? 'Menyimpan…' : 'Simpan observasi'}
        </Button>
        {!complete && <span className="text-caption text-ink-500">Isi keenam tanda vital.</span>}
        {error && (
          <span role="alert" className="text-small font-semibold text-danger">
            {error}
          </span>
        )}
      </span>
    </form>
  );
}
