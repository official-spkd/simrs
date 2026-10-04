'use client';

import { EMAR_TIMES, type EmarMedication, type EmarTime, formatJam, SAFETY_REASON_MIN } from '@simrs/shared';
import { Button, Chip, cx } from '@simrs/ui';
import { useState, useTransition } from 'react';
import { EMAR_STATE_META, emarActionable } from '@/lib/rawat-inap';
import { recordAdministrationAction } from './actions';
import { EmarGate, type EmarScan } from './emar-gate';

export interface EmarLocal {
  scan: EmarScan;
  /** Slot diberikan di layar ini: kunci `<obat>|<jam>` → label "✓ 12.03". */
  given: Record<string, string>;
  log: Array<{ t: string; what: string; note: string }>;
}

/** eMAR (mockup Ranap): grid obat × jam, terkunci sampai gelang cocok; terlambat wajib alasan. */
export function EmarPanel({
  encounterId,
  meds,
  now,
  note,
  rm,
  name,
  nurse,
  state,
  scenarioBusy,
  onScan,
  onChange,
}: {
  encounterId: string;
  meds: EmarMedication[];
  now: EmarTime;
  note: string;
  rm: string;
  name: string;
  nurse: string;
  state: EmarLocal;
  scenarioBusy: boolean;
  onScan: () => void;
  onChange: (next: EmarLocal) => void;
}) {
  const [late, setLate] = useState<{ med: EmarMedication; time: EmarTime } | null>(null);
  const [reason, setReason] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [busy, start] = useTransition();
  const unlocked = state.scan.status !== 'terkunci';

  const give = (med: EmarMedication, time: EmarTime, lateReason: string | null) =>
    start(async () => {
      const r = await recordAdministrationAction({
        encounterId,
        medicationId: med.id,
        time,
        wristband: state.scan.status === 'override' ? 'override' : 'cocok',
        scanOverrideReason: state.scan.reason,
        lateReason,
      });
      if (!r.ok) return setError(r.error ?? 'Pemberian belum tercatat.');
      setError(null);
      setLate(null);
      setReason('');
      onChange({
        ...state,
        given: { ...state.given, [`${med.id}|${time}`]: `✓ ${r.ok.at}${lateReason ? ' · telat' : ''}` },
        log: [
          ...state.log,
          {
            t: r.ok.at,
            what: med.name,
            note: `jadwal ${time}${lateReason ? ` · terlambat · ${lateReason}` : ''} · ${nurse} (simulasi, tidak disimpan)`,
          },
        ],
      });
    });

  return (
    <section aria-label="eMAR" className="flex min-w-0 flex-[1_1_520px] flex-col gap-3">
      <div className="flex flex-col gap-3 rounded-card border border-line bg-white px-4 py-3.5">
        <div className="flex flex-wrap items-baseline justify-between gap-2">
          <h2 className="m-0 text-body font-semibold">eMAR · jadwal pemberian obat</h2>
          <span className="text-caption text-ink-500">Sumber: resep terverifikasi apoteker</span>
        </div>
        <EmarGate
          scan={state.scan}
          rm={rm}
          name={name}
          note={note}
          busy={scenarioBusy}
          onScan={onScan}
          onOverride={(r) =>
            onChange({ ...state, scan: { status: 'override', at: formatJam(new Date()), reason: r } })
          }
        />
        <div className="overflow-x-auto">
          <table className="w-full min-w-[560px] border-collapse text-small">
            <caption className="sr-only">Jadwal pemberian obat hari ini</caption>
            <thead>
              <tr className="text-left text-caption text-ink-700">
                <th scope="col" className="py-2 pr-2 font-semibold">
                  Obat · dosis · rute
                </th>
                {EMAR_TIMES.map((t) => (
                  <th
                    key={t}
                    scope="col"
                    className={cx('px-1 py-2 text-center font-semibold', t === now && 'text-brand-700')}
                  >
                    {t.slice(0, 2)}
                    {t === now ? ' · kini' : ''}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {meds.map((m) => (
                <tr key={m.id} className="border-t border-line-soft align-top">
                  <th scope="row" className="py-2 pr-2 text-left font-normal">
                    <span className="flex flex-col gap-0.5">
                      <span className="font-semibold">{m.name}</span>
                      <span className="text-caption text-ink-500">{m.sig}</span>
                      <span className="flex flex-wrap gap-1">
                        <span className="font-mono text-[11px] text-ink-500">
                          {m.kfa ? `KFA ${m.kfa}` : 'KFA belum dipetakan'}
                        </span>
                        {m.highAlert && <Chip tone="danger">Kewaspadaan tinggi</Chip>}
                      </span>
                    </span>
                  </th>
                  {m.slots.map((s) => {
                    const done = state.given[`${m.id}|${s.time}`];
                    const meta = EMAR_STATE_META[done ? 'diberikan' : s.state];
                    const label = done ?? (s.state === 'diberikan' ? `✓ ${s.label}` : s.label);
                    const can = !done && emarActionable(s.state);
                    return (
                      <td key={s.time} className="px-1 py-2">
                        <button
                          type="button"
                          disabled={!can || !unlocked || busy}
                          onClick={() =>
                            s.state === 'terlambat'
                              ? setLate({ med: m, time: s.time })
                              : give(m, s.time, null)
                          }
                          aria-label={`${m.name} jam ${s.time} · ${meta.label}${label && s.state !== 'kosong' ? ` · ${label}` : ''}${can && !unlocked ? ' · pindai gelang dulu' : ''}`}
                          title={
                            can ? (unlocked ? 'Catat pemberian' : 'Pindai gelang pasien dulu') : undefined
                          }
                          className={cx(
                            'min-h-11 w-full rounded-[8px] border px-1 font-[inherit] text-[11.5px] font-semibold',
                            meta.cls,
                            can && unlocked ? 'cursor-pointer' : 'cursor-default',
                            can && !unlocked && 'opacity-70',
                          )}
                        >
                          {s.state === 'kosong' && !done ? '·' : label}
                        </button>
                      </td>
                    );
                  })}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        {late && (
          <div className="flex flex-col gap-1.5 rounded-control border border-danger-border bg-[#FFF8F7] p-3">
            <span className="font-semibold text-danger-strong">
              {late.med.name} · jadwal {late.time} terlambat
            </span>
            <label htmlFor="emar-telat" className="text-small font-semibold">
              Alasan keterlambatan (wajib, minimal {SAFETY_REASON_MIN} karakter, tercatat di jejak audit)
            </label>
            <input
              id="emar-telat"
              value={reason}
              onChange={(e) => setReason(e.target.value)}
              placeholder="Contoh: pasien sedang pemeriksaan foto toraks"
              className="h-11 rounded-control border border-line-strong bg-white px-3 font-[inherit]"
            />
            <span className="flex flex-wrap gap-2">
              <Button
                variant="danger"
                disabled={reason.trim().length < SAFETY_REASON_MIN || busy}
                onClick={() => give(late.med, late.time, reason.trim())}
              >
                Catat pemberian terlambat
              </Button>
              <Button onClick={() => setLate(null)}>Batal</Button>
            </span>
          </div>
        )}
        {error && (
          <span role="alert" className="text-caption font-semibold text-danger">
            {error}
          </span>
        )}
        {state.log.length > 0 && (
          <div className="flex flex-col gap-1 border-t border-line-soft pt-2.5">
            <span className="text-caption font-semibold text-ink-700">Pemberian tercatat shift ini</span>
            <ul className="m-0 flex list-none flex-col gap-1 p-0 text-small">
              {state.log.map((g) => (
                <li key={`${g.t}-${g.what}`}>
                  <span className="font-mono font-semibold">{g.t}</span> · {g.what}{' '}
                  <span className="text-ink-500">· {g.note}</span>
                </li>
              ))}
            </ul>
          </div>
        )}
      </div>
    </section>
  );
}
