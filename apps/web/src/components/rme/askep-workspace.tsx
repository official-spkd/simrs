'use client';

import { type EmarMedication, formatJam } from '@simrs/shared';
import { Button, Chip, cx, TabList } from '@simrs/ui';
import Link from 'next/link';
import { useId, useState } from 'react';
import {
  addNursingDxAction,
  markInterventionAction,
  recordRoundDoseAction,
  saveEvalAction,
} from '@/app/(staf)/klinis/asuhan-keperawatan/actions';
import { useStoreAction } from '@/lib/demo/store/client';
import {
  dueDoses,
  type EvalDraft,
  evalBlocker,
  EVAL_LABEL,
  type EvalResult,
  interventionKey,
  type NursingDx,
  recordDoseBlocker,
  type ScanState,
  scanWristband,
  type Shift,
  SHIFT_LABEL,
  shiftOf,
  type ShiftEval,
  shiftProgress,
  WRISTBAND_GATE,
} from '@/lib/rme-askep';
import { Feedback, type FeedbackMsg, ReasonField } from './feedback';

const CARD =
  'flex min-w-0 flex-col gap-3 rounded-card border border-white/95 bg-white/90 shadow-card px-4 py-3.5';
const INPUT = 'h-11 rounded-control border border-line-strong bg-white px-3 font-[inherit]';
const EMPTY_EVAL: EvalDraft = { s: '', o: '', result: '', p: '' };

interface MasterDx {
  label: string;
  outcome: string;
  interventions: readonly string[];
}

/**
 * K12 · Asuhan keperawatan per shift (diagnosis master lokal, luaran, intervensi, evaluasi SOAP) dan ronde obat
 * shift dengan gerbang gelang eMAR: sebelum gelang cocok, tombol catat pemberian nonaktif beserta alasannya; dosis
 * terlambat wajib alasan, obat high-alert wajib cek ganda. Semua aksi tersimpan di toko demo (`rekam-medis`) atas
 * nama pengguna sesi; pemberian obat tercatat di eMAR yang sama dengan layar Rawat inap. Pindai gelang di layar ini
 * hanya membuka tombol; server mencocokkan kode gelang lagi pada setiap dosis.
 */
export function AskepWorkspace({
  encounterId,
  rm,
  canNurse,
  user,
  now,
  today,
  dxs,
  done,
  evals,
  given,
  rev,
  master,
  meds,
  emarNote,
  secondNurses,
  emarHref,
}: {
  encounterId: string;
  rm: string;
  canNurse: boolean;
  user: string;
  now: string;
  today: string;
  /** Diagnosis keperawatan (rencana + tambahan tersimpan). */
  dxs: readonly NursingDx[];
  /** Intervensi dikerjakan per kunjungan|intervensi|shift|tanggal (rekam awal = true, tersimpan = pelaku + jam). */
  done: Readonly<Record<string, { by: string; at: string } | true>>;
  evals: readonly ShiftEval[];
  /** Dosis tercatat per `<obat>|<jam>` (eMAR bersama Rawat inap). */
  given: Readonly<Record<string, string>>;
  /** Revisi toko `rekam-medis`. */
  rev: number;
  master: readonly MasterDx[];
  meds: readonly EmarMedication[];
  emarNote: string;
  secondNurses: readonly string[];
  emarHref: string | null;
}) {
  const id = useId();
  const { run, pending } = useStoreAction(rev);
  const [optimistic, setOptimistic] = useState<string[]>([]);
  const [shift, setShift] = useState<Shift>(shiftOf(now));
  const [drafts, setDrafts] = useState<Record<string, EvalDraft>>({});
  const [tried, setTried] = useState<Record<string, boolean>>({});
  const [newDx, setNewDx] = useState('');
  const [msg, setMsg] = useState<FeedbackMsg | null>(null);
  const [scan, setScan] = useState<ScanState>({ status: 'belum' });
  const [code, setCode] = useState('');
  const [doseInput, setDoseInput] = useState<
    Record<string, { lateReason: string; secondNurse: string; tried: boolean }>
  >({});
  const progress = shiftProgress(dxs, evals, shift, today);
  const doses = dueDoses(meds);
  const say = (res: { ok: boolean; message: string }) => setMsg({ ok: res.ok, text: res.message });
  const nowShift = shiftOf(now);

  const saveEval = (dx: NursingDx) => {
    const d = drafts[dx.id] ?? EMPTY_EVAL;
    setTried((t) => ({ ...t, [dx.id]: true }));
    if (evalBlocker(d) || !d.result) return;
    run((r) => saveEvalAction({ encounterId, dxId: dx.id, shift, ...d }, r), say);
  };

  return (
    <div className="flex flex-col gap-4">
      <Feedback msg={msg} />
      <div className="flex flex-wrap items-start gap-4">
        <section aria-label="Rencana asuhan keperawatan" className={cx(CARD, 'flex-[2_1_560px]')}>
          <div className="flex flex-wrap items-center justify-between gap-2">
            <div className="flex flex-col">
              <h2 className="m-0 text-body font-semibold">Rencana asuhan keperawatan</h2>
              <span className="text-caption text-ink-500">
                Diagnosis keperawatan master lokal (selaras SDKI) · evaluasi {progress.done} dari{' '}
                {progress.total} diagnosis shift ini
              </span>
            </div>
            <TabList
              label="Shift"
              value={shift}
              onChange={(v) => setShift(v as Shift)}
              items={(Object.keys(SHIFT_LABEL) as Shift[]).map((s) => ({ id: s, label: SHIFT_LABEL[s] }))}
            />
          </div>
          {dxs.map((dx) => {
            const ev = evals.find((e) => e.dxId === dx.id && e.shift === shift && e.date === today);
            const d = drafts[dx.id] ?? EMPTY_EVAL;
            const block = evalBlocker(d);
            const setD = (patch: Partial<EvalDraft>) =>
              setDrafts((cur) => ({ ...cur, [dx.id]: { ...d, ...patch } }));
            return (
              <article
                key={dx.id}
                aria-labelledby={`${dx.id}-judul`}
                className="flex flex-col gap-2 rounded-control border border-line px-3.5 py-3"
              >
                <h3 id={`${dx.id}-judul`} className="m-0 text-body font-semibold">
                  {dx.label}
                </h3>
                <p className="m-0 text-small text-ink-700">
                  <span className="font-semibold">Luaran: </span>
                  {dx.outcome}
                </p>
                <fieldset className="m-0 flex flex-col gap-1 border-0 p-0">
                  <legend className="mb-1 p-0 text-small font-semibold">Intervensi shift {shift}</legend>
                  {dx.interventions.map((x) => {
                    const k = interventionKey(dx.id, x.id, shift, today);
                    const v = done[k] ?? (optimistic.includes(k) ? { by: user, at: now } : undefined);
                    return (
                      <label key={x.id} className="flex min-h-11 items-center gap-2 text-small">
                        <input
                          type="checkbox"
                          checked={!!v}
                          disabled={!canNurse || !!v || pending || shift !== nowShift}
                          onChange={() => {
                            setOptimistic((cur) => [...cur, k]);
                            run(
                              (r) =>
                                markInterventionAction({ encounterId, dxId: dx.id, interventionId: x.id }, r),
                              (res) => {
                                if (!res.ok) setOptimistic((cur) => cur.filter((y) => y !== k));
                                say(res);
                              },
                            );
                          }}
                          className="size-4 accent-brand-600"
                        />
                        {x.label}
                        {v && v !== true && (
                          <span className="text-caption text-success">✓ {formatJam(v.at)}</span>
                        )}
                      </label>
                    );
                  })}
                </fieldset>
                {ev ? (
                  <div className="flex flex-col gap-0.5 rounded-control bg-subtle px-3 py-2 text-small">
                    {ev.s && <span>S: {ev.s}</span>}
                    <span>O: {ev.o}</span>
                    <span>A: {EVAL_LABEL[ev.result]}</span>
                    <span>P: {ev.p}</span>
                    <span className="text-caption font-semibold text-success">
                      Evaluasi final · {formatJam(ev.at)} · {ev.by}
                    </span>
                  </div>
                ) : canNurse ? (
                  <form
                    aria-label={`Evaluasi ${dx.label}`}
                    className="grid grid-cols-1 gap-2 rounded-control bg-[linear-gradient(135deg,var(--color-brand-50),var(--color-brand-100))] p-3 md:grid-cols-2"
                    onSubmit={(e) => {
                      e.preventDefault();
                      saveEval(dx);
                    }}
                  >
                    <div className="flex flex-col gap-1">
                      <label htmlFor={`${dx.id}-s`} className="text-small font-semibold">
                        S · Subjektif
                      </label>
                      <input
                        id={`${dx.id}-s`}
                        value={d.s}
                        onChange={(e) => setD({ s: e.target.value })}
                        className={INPUT}
                      />
                    </div>
                    <div className="flex flex-col gap-1">
                      <label htmlFor={`${dx.id}-o`} className="text-small font-semibold">
                        O · Objektif <span className="text-danger">*</span>
                      </label>
                      <input
                        id={`${dx.id}-o`}
                        value={d.o}
                        onChange={(e) => setD({ o: e.target.value })}
                        className={INPUT}
                      />
                    </div>
                    <div className="flex flex-col gap-1">
                      <label htmlFor={`${dx.id}-a`} className="text-small font-semibold">
                        A · Hasil evaluasi <span className="text-danger">*</span>
                      </label>
                      <select
                        id={`${dx.id}-a`}
                        value={d.result}
                        onChange={(e) => setD({ result: e.target.value as EvalResult })}
                        className={INPUT}
                      >
                        <option value="">Pilih…</option>
                        {(Object.keys(EVAL_LABEL) as EvalResult[]).map((r) => (
                          <option key={r} value={r}>
                            {EVAL_LABEL[r]}
                          </option>
                        ))}
                      </select>
                    </div>
                    <div className="flex flex-col gap-1">
                      <label htmlFor={`${dx.id}-p`} className="text-small font-semibold">
                        P · Rencana lanjut <span className="text-danger">*</span>
                      </label>
                      <input
                        id={`${dx.id}-p`}
                        value={d.p}
                        onChange={(e) => setD({ p: e.target.value })}
                        className={INPUT}
                      />
                    </div>
                    {tried[dx.id] && block && (
                      <p role="alert" className="m-0 text-small font-semibold text-danger md:col-span-2">
                        {block}
                      </p>
                    )}
                    <Button type="submit" variant="primary" className="self-start">
                      Simpan evaluasi shift
                    </Button>
                  </form>
                ) : (
                  <span className="text-caption text-ink-500">Belum dievaluasi pada shift ini.</span>
                )}
              </article>
            );
          })}
          {canNurse && (
            <form
              aria-label="Tambah diagnosis keperawatan"
              className="flex flex-wrap items-end gap-2"
              onSubmit={(e) => {
                e.preventDefault();
                const m = master.find((x) => x.label === newDx);
                if (!m) return;
                run(
                  (r) => addNursingDxAction({ encounterId, label: m.label }, r),
                  (res) => {
                    if (res.ok) setNewDx('');
                    say(res);
                  },
                );
              }}
            >
              <div className="flex min-w-0 flex-[1_1_240px] flex-col gap-1">
                <label htmlFor={`${id}-dx`} className="text-small font-semibold">
                  Tambah diagnosis keperawatan
                </label>
                <select
                  id={`${id}-dx`}
                  value={newDx}
                  onChange={(e) => setNewDx(e.target.value)}
                  className={INPUT}
                >
                  <option value="">Pilih dari master…</option>
                  {master
                    .filter((m) => !dxs.some((d) => d.label === m.label))
                    .map((m) => (
                      <option key={m.label} value={m.label}>
                        {m.label}
                      </option>
                    ))}
                </select>
              </div>
              <Button type="submit" disabled={!newDx}>
                Tambahkan
              </Button>
            </form>
          )}
        </section>

        <section aria-label="Ronde obat shift" className={cx(CARD, 'flex-[1_1_360px]')}>
          <div className="flex flex-wrap items-baseline justify-between gap-2">
            <h2 className="m-0 text-body font-semibold">Ronde obat shift (eMAR)</h2>
            {emarHref && (
              <Link href={emarHref} className="text-small font-semibold text-brand-700">
                Buka eMAR lengkap
              </Link>
            )}
          </div>
          {scan.status === 'cocok' ? (
            <p
              role="status"
              className="m-0 rounded-control border border-zamrud-200 bg-alert-success px-3 py-2 text-small font-semibold text-success"
            >
              ✓ Pasien benar · gelang terpindai {formatJam(scan.at)} · RM {rm}
            </p>
          ) : (
            <div className="flex flex-col gap-2 rounded-control border border-kunyit-200 bg-alert-warning px-3 py-2.5">
              <span className="font-semibold text-warning-strong">
                Pemberian obat terkunci: gelang belum terverifikasi
              </span>
              <span className="text-small text-ink-700">{emarNote}</span>
              {scan.status === 'tidak-cocok' && (
                <span role="alert" className="text-small font-semibold text-danger">
                  Gelang tidak cocok ({scan.code}): bukan pasien ini. Pemberian tetap terkunci; periksa
                  identitas pasien.
                </span>
              )}
              {canNurse && (
                <form
                  aria-label="Verifikasi gelang"
                  className="flex flex-wrap items-end gap-2"
                  onSubmit={(e) => {
                    e.preventDefault();
                    const at = new Date().toISOString();
                    const r = scanWristband(code, rm, at);
                    setScan(r);
                    if (r.status === 'cocok') {
                      setMsg({ ok: true, text: `Gelang cocok · ${formatJam(at)}; ronde obat terbuka.` });
                    }
                  }}
                >
                  <div className="flex flex-col gap-1">
                    <label htmlFor={`${id}-gelang`} className="text-small font-semibold">
                      Kode gelang (hasil pindai)
                    </label>
                    <input
                      id={`${id}-gelang`}
                      value={code}
                      onChange={(e) => setCode(e.target.value)}
                      className={cx(INPUT, 'w-44 font-mono')}
                    />
                  </div>
                  <Button type="submit" variant="primary" disabled={!code.trim()}>
                    Verifikasi gelang
                  </Button>
                  <Button variant="ghost" onClick={() => setCode(rm)}>
                    Pindai gelang (simulasi)
                  </Button>
                </form>
              )}
            </div>
          )}
          {doses.length === 0 && (
            <p className="m-0 text-small text-ink-500">Tidak ada dosis jatuh tempo pada shift ini.</p>
          )}
          <ul aria-label="Dosis jatuh tempo" className="m-0 flex list-none flex-col gap-2 p-0">
            {doses.map((dose) => {
              const inp = doseInput[dose.key] ?? { lateReason: '', secondNurse: '', tried: false };
              const block = recordDoseBlocker(dose, { scan, ...inp });
              const setInp = (patch: Partial<typeof inp>) =>
                setDoseInput((cur) => ({ ...cur, [dose.key]: { ...inp, ...patch } }));
              const g = given[dose.key];
              return (
                <li key={dose.key}>
                  <article
                    aria-labelledby={`${id}-${dose.key}`}
                    className="flex flex-col gap-1.5 rounded-control border border-line px-3 py-2"
                  >
                    <h3 id={`${id}-${dose.key}`} className="m-0 text-small font-semibold">
                      {dose.time} · {dose.name}
                    </h3>
                    <span className="text-caption text-ink-700">{dose.sig}</span>
                    <span className="flex flex-wrap gap-1.5">
                      {dose.late && <Chip tone="danger">Terlambat</Chip>}
                      {dose.highAlert && <Chip tone="warning">High-alert · cek ganda</Chip>}
                    </span>
                    {g ? (
                      <span className="text-small font-semibold text-success">{g}</span>
                    ) : (
                      <>
                        {scan.status === 'cocok' && dose.late && (
                          <ReasonField
                            label="Alasan keterlambatan"
                            value={inp.lateReason}
                            onChange={(lateReason) => setInp({ lateReason })}
                            showError={inp.tried}
                          />
                        )}
                        {scan.status === 'cocok' && dose.highAlert && (
                          <div className="flex flex-col gap-1">
                            <label htmlFor={`${id}-${dose.key}-cek`} className="text-small font-semibold">
                              Perawat pemeriksa kedua
                            </label>
                            <select
                              id={`${id}-${dose.key}-cek`}
                              value={inp.secondNurse}
                              onChange={(e) => setInp({ secondNurse: e.target.value })}
                              className={INPUT}
                            >
                              <option value="">Pilih perawat…</option>
                              {secondNurses.map((n) => (
                                <option key={n} value={n}>
                                  {n}
                                </option>
                              ))}
                            </select>
                          </div>
                        )}
                        <Button
                          variant="primary"
                          className="self-start"
                          disabled={!canNurse || scan.status !== 'cocok' || pending}
                          aria-describedby={scan.status !== 'cocok' ? `${id}-${dose.key}-why` : undefined}
                          onClick={() => {
                            setInp({ tried: true });
                            if (block) return;
                            run(
                              (r) =>
                                recordRoundDoseAction(
                                  {
                                    encounterId,
                                    medicationId: dose.medicationId,
                                    time: dose.time,
                                    wristbandCode: code,
                                    lateReason: inp.lateReason,
                                    secondNurse: inp.secondNurse,
                                  },
                                  r,
                                ),
                              say,
                            );
                          }}
                        >
                          Catat pemberian
                        </Button>
                        {scan.status !== 'cocok' && (
                          <span id={`${id}-${dose.key}-why`} className="text-caption text-ink-500">
                            {WRISTBAND_GATE}
                          </span>
                        )}
                        {scan.status === 'cocok' && inp.tried && block && (
                          <span role="alert" className="text-caption font-semibold text-danger">
                            {block}
                          </span>
                        )}
                      </>
                    )}
                  </article>
                </li>
              );
            })}
          </ul>
        </section>
      </div>
    </div>
  );
}
