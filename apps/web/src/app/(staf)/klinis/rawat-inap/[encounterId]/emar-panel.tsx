'use client';

import { EMAR_TIMES, type EmarMedication, type EmarTime } from '@simrs/shared';
import { Button, Chip, cx } from '@simrs/ui';
import { type ReactNode, useState, useTransition } from 'react';
import { useStoreAction } from '@/lib/demo/store/client';
import {
  allDueGiven,
  dueProgress,
  EMAR_STATE_META,
  emarActionable,
  emarDosePayload,
  emarGivenLabel,
  emarKey,
  emarScanPayload,
} from '@/lib/rawat-inap';
import { recordAdministrationAction, scanWristbandAction } from './actions-demo';
import { type DoseInput, EmarDosePanel } from './emar-dose';
import { EmarGate, type EmarScan } from './emar-gate';

export interface EmarLocal {
  scan: EmarScan;
  /**
   * Slot diberikan: kunci `<obat>|<jam>` → label "✓ 12.03". Pasien fixture: dari toko demo (server); pasien skenario:
   * dosis yang sudah diperiksa server di layar ini sampai tugas `emar` Simulasi mencatatnya.
   */
  given: Record<string, string>;
  log: Array<{ t: string; what: string; note: string }>;
}

/**
 * eMAR (mockup Ranap): grid obat × jam, terkunci sampai gelang cocok; lalu dosis diberikan satu per satu (pilih
 * slot → pindai label obat → catat), masing-masing diperiksa server dan tersimpan di toko demo (`rekam-medis`) atas
 * nama pengguna sesi. Pasien skenario: tugas `emar` Simulasi selesai setelah semua dosis jam "kini" tercatat
 * (`onAllDue`).
 */
export function EmarPanel({
  encounterId,
  meds,
  now,
  note,
  rm,
  name,
  nurse,
  rev,
  state,
  wait,
  scenarioTask,
  scenarioBusy,
  onChange,
  onAllDue,
  footer,
}: {
  encounterId: string;
  meds: EmarMedication[];
  now: EmarTime;
  note: string;
  rm: string;
  name: string;
  nurse: string;
  /** Revisi toko `rekam-medis` yang dilihat layar. */
  rev: number;
  state: EmarLocal;
  /** Pasien skenario di luar giliran tugas `emar`: alasan menunggu (grid tetap terkunci). */
  wait: string | null;
  /** Tugas `emar` Simulasi sedang gilirannya (pasien skenario). */
  scenarioTask: boolean;
  scenarioBusy: boolean;
  onChange: (update: (cur: EmarLocal) => EmarLocal) => void;
  onAllDue: () => void;
  /** Ubin pantauan di bawah kartu eMAR (mockup Ranap: EWS terakhir, GDS). */
  footer?: ReactNode;
}) {
  const [pick, setPick] = useState<{ med: EmarMedication; time: EmarTime } | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [scanning, start] = useTransition();
  const { run, pending: recording } = useStoreAction(rev);
  const busy = scanning || recording;
  const unlocked = state.scan.status !== 'terkunci';
  const locked = busy || scenarioBusy;
  const progress = dueProgress(meds, now, state.given);
  const allDue = allDueGiven(meds, now, state.given);

  const scan = (wristbandCode: string | null, reason: string | null) =>
    start(async () => {
      // Pindai gelang (simulasi): kode gelang = RM pasien; server mencocokkannya dengan rekam kunjungan.
      const r = await scanWristbandAction(emarScanPayload(encounterId, wristbandCode, reason));
      if (!r.ok) return setError(r.error ?? 'Gelang belum terverifikasi.');
      const ok = r.ok;
      setError(null);
      onChange((cur) => ({
        ...cur,
        scan: { status: ok.override ? 'override' : 'cocok', at: ok.at, reason },
      }));
    });

  const record = (med: EmarMedication, time: EmarTime, d: DoseInput) =>
    run(
      (r) =>
        recordAdministrationAction(
          emarDosePayload({ encounterId, medicationId: med.id, time, rm, identity: state.scan, dose: d }),
          r,
        ),
      (res) => {
        if (!res.ok || !res.at) return setError(res.message || 'Pemberian belum tercatat.');
        setError(null);
        setPick(null);
        if (!res.scenario) return;
        // Pasien skenario: dosis sudah diperiksa server; dicatat ke Simulasi lewat tugas `emar` setelah semua dosis.
        const facts = { late: !!res.late, doubleCheckedBy: res.doubleCheckedBy ?? null };
        const at = res.at;
        const key = emarKey(med.id, time);
        const given = { ...state.given, [key]: emarGivenLabel(at, facts) };
        onChange((cur) => ({
          ...cur,
          given: { ...cur.given, [key]: emarGivenLabel(at, facts) },
          log: [
            ...cur.log,
            {
              t: at,
              what: med.name,
              note: `jadwal ${time}${facts.late ? ` · terlambat · ${d.lateReason ?? ''}` : ''}${facts.doubleCheckedBy ? ` · cek ganda ${facts.doubleCheckedBy}` : ''} · ${nurse} · masuk rekam Simulasi saat semua dosis jam ini tercatat`,
            },
          ],
        }));
        if (allDueGiven(meds, now, given)) onAllDue();
      },
    );

  return (
    <section aria-label="eMAR" className="flex min-w-0 flex-[1_1_520px] flex-col gap-3">
      <div className="flex flex-col gap-3 rounded-card border border-white/95 bg-white/90 shadow-card px-4 py-3.5">
        <div className="flex flex-wrap items-baseline justify-between gap-2">
          <h2 className="m-0 text-body font-semibold">eMAR · jadwal pemberian obat</h2>
          <span className="text-caption text-ink-500">Sumber: resep terverifikasi apoteker</span>
        </div>
        <EmarGate
          scan={state.scan}
          rm={rm}
          name={name}
          note={note}
          wait={wait}
          progress={
            progress.total > 0
              ? `Dosis jam ${now}: ${progress.given} dari ${progress.total} tercatat.${scenarioTask ? ' Tugas Simulasi selesai setelah semua dosis jam ini tercatat.' : ''}`
              : null
          }
          busy={locked}
          drugScanned={state.log.length > 0}
          onScan={() => scan(rm, null)}
          onOverride={(reason) => scan(null, reason)}
        />
        {/* Kolom tetap: kelima jam muat di kartu laptop (≥ 460 px); lebih sempit lagi tabel bergeser dengan petunjuk. */}
        <div className="@container flex flex-col gap-1">
          <span className="text-caption text-ink-500 @min-[460px]:hidden" aria-hidden="true">
            Geser tabel ke samping untuk melihat semua jam →
          </span>
          <div className="overflow-x-auto">
            <table className="w-full min-w-[460px] table-fixed border-collapse text-small">
              <caption className="sr-only">Jadwal pemberian obat hari ini</caption>
              <thead>
                <tr className="border-b border-line text-left text-caption text-ink-500">
                  <th scope="col" className="w-[36%] py-2 pr-2 font-semibold">
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
                      const done = state.given[emarKey(m.id, s.time)];
                      const meta = EMAR_STATE_META[done ? 'diberikan' : s.state];
                      const label = done ?? (s.state === 'diberikan' ? `✓ ${s.label}` : s.label);
                      const can = !done && emarActionable(s.state);
                      const picked = pick?.med.id === m.id && pick.time === s.time;
                      return (
                        <td key={s.time} className="px-1 py-2">
                          <button
                            type="button"
                            disabled={!can || !unlocked || locked}
                            aria-expanded={can && unlocked ? picked : undefined}
                            aria-controls={picked ? 'emar-dosis' : undefined}
                            onClick={() => {
                              setError(null);
                              setPick({ med: m, time: s.time });
                            }}
                            aria-label={`${m.name} jam ${s.time} · ${meta.label}${label && s.state !== 'kosong' ? ` · ${label}` : ''}${can && !unlocked ? ' · pindai gelang dulu' : ''}`}
                            title={
                              can
                                ? unlocked
                                  ? 'Pilih dosis ini, pindai label obat, lalu catat'
                                  : 'Pindai gelang pasien dulu'
                                : undefined
                            }
                            className={cx(
                              'min-h-11 w-full rounded-[8px] border px-1 font-[inherit] text-[11.5px] font-semibold',
                              meta.cls,
                              can && unlocked ? 'cursor-pointer' : 'cursor-default',
                              can && !unlocked && 'opacity-70',
                              picked && 'ring-2 ring-brand-600',
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
        </div>
        {pick && (
          <EmarDosePanel
            key={emarKey(pick.med.id, pick.time)}
            med={pick.med}
            time={pick.time}
            late={pick.med.slots.find((s) => s.time === pick.time)?.state === 'terlambat'}
            nurse={nurse}
            busy={locked}
            error={error}
            onRecord={(d) => record(pick.med, pick.time, d)}
            onCancel={() => {
              setPick(null);
              setError(null);
            }}
          />
        )}
        {error && !pick && (
          <span role="alert" className="text-caption font-semibold text-danger">
            {error}
          </span>
        )}
        {scenarioTask && allDue && !scenarioBusy && (
          <div className="flex flex-wrap items-center gap-2 text-small">
            <span className="text-ink-700">
              Semua dosis jam {now} tercatat; tugas Simulasi belum tercatat.
            </span>
            <Button size="sm" disabled={locked} onClick={onAllDue}>
              Catat tugas eMAR di Simulasi
            </Button>
          </div>
        )}
        {state.log.length > 0 && (
          <div className="flex flex-col gap-1 border-t border-line-soft pt-2.5">
            <span className="text-caption font-semibold text-ink-700">Pemberian tercatat shift ini</span>
            <ul aria-label="Pemberian tercatat" className="m-0 flex list-none flex-col gap-1 p-0 text-small">
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
      {footer}
    </section>
  );
}
