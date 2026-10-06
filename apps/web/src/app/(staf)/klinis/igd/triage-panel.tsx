'use client';

import { type EdTrackingItem, formatJam, SAFETY_REASON_MIN, type TriageLevel } from '@simrs/shared';
import { Button, cx, Field } from '@simrs/ui';
import Link from 'next/link';
import { useEffect, useId, useRef, useState } from 'react';
import { useStoreAction } from '@/lib/demo/store/client';
import type { IgdTriage } from '@/lib/klinis-igd-toko';
import { StatusFlag, ValueFlagBadge } from '@/components/klinis/status-flag';
import { TriageLevelPicker } from '@/components/rawat-inap/triage-level-picker';
import { taskDone, taskEnabled, useScenarioTask } from '@/components/rawat-inap/use-scenario-task';
import {
  edLosAlert,
  edVitalFlag,
  formatTimer,
  TRIAGE_GENERIC,
  TRIAGE_META,
  TRIAGE_ROLE_REASON,
  TRIAGE_SAVE_DISABLED,
  triageNeedsReason,
  triageSaveAllowed,
} from '@/lib/rawat-inap';
import type { ScenarioStepState } from '@/lib/rawat-inap-scenario';
import { saveTriageAction } from './actions-demo';
import { IdentifyBlock, VitalsEntry } from './scenario-intake';

/**
 * Panel triase pasien terpilih (mockup IGD): tanda vital, level 1–5, saran sistem, gerbang turun level, order.
 * Triase tersimpan di toko demo (`klinis-igd`) atas nama pengguna sesi; level di papan datang dari server.
 */
export function TriagePanel({
  item,
  addSeconds,
  stored,
  igdRev,
  kd,
  tr,
  rev,
  history,
  links,
  canTriage,
}: {
  item: EdTrackingItem;
  addSeconds: number;
  /** Triase tersimpan pasien ini (toko demo). */
  stored: IgdTriage | undefined;
  /** Revisi toko `klinis-igd`. */
  igdRev: number;
  kd: ScenarioStepState | undefined;
  tr: ScenarioStepState | undefined;
  rev: number;
  history: string;
  links: { bed: string | null; ranap: string | null };
  /** Posisi perawat/dokter; posisi lain melihat triase tanpa bisa menetapkannya. */
  canTriage: boolean;
}) {
  const { runTask, pending, error } = useScenarioTask(rev);
  const [chosen, setChosenState] = useState<TriageLevel>(
    stored?.level ?? item.triageLevel ?? item.suggestedLevel,
  );
  const [reason, setReason] = useState('');
  const [orders, setOrders] = useState<boolean[]>(() =>
    item.orders.map((o) => (stored ? stored.orders.includes(o.label) : o.defaultOn)),
  );
  const [cc, setCc] = useState(item.chiefComplaint);
  const [message, setMessage] = useState<{ ok: boolean; text: string } | null>(null);
  const { run, pending: busy } = useStoreAction(igdRev);
  const pendingReason = useRef<string | null>(null);
  const reasonId = useId();

  const scn = item.scenario;
  const identified = !scn || taskDone(kd, 'gelang');
  const ttvDone = !scn || taskDone(tr, 'ttv');
  const levelDone = scn ? taskDone(tr, 'level') : false;
  const alasanVisible = scn && !!tr?.tasks.alasan?.visible;
  const alasanOpen = scn && canTriage && taskEnabled(tr, 'alasan');
  const bedDone = scn && taskDone(tr, 'bed');
  const canPick = canTriage && (scn ? taskEnabled(tr, 'level') : true);
  const under = triageNeedsReason(item.suggestedLevel, chosen);
  const allowed = triageSaveAllowed(item.suggestedLevel, chosen, reason);
  const reasonOk = reason.trim().length >= SAFETY_REASON_MIN;
  const working = pending || busy;

  // Alasan override yang sudah diisi sebelum menyimpan level dikirim begitu tugasnya giliran (skenario).
  useEffect(() => {
    if (alasanOpen && pendingReason.current) {
      const r = pendingReason.current;
      pendingReason.current = null;
      runTask(tr, 'alasan', r);
    }
  }, [alasanOpen, tr, runTask]);

  const setChosen = (n: TriageLevel) => {
    setChosenState(n);
    setMessage(null);
  };

  const save = () => {
    if (!allowed || !canTriage) return;
    if (scn) {
      pendingReason.current = under ? reason.trim() : null;
      runTask(tr, 'level', String(chosen));
      return;
    }
    run(
      (r) =>
        saveTriageAction(
          {
            triage: {
              encounterId: item.encounterId,
              chosenLevel: chosen,
              overrideReason: under ? reason.trim() : null,
              orders: item.orders.filter((_, i) => orders[i]).map((o) => o.label),
            },
            chiefComplaint: cc.trim() || item.chiefComplaint,
          },
          r,
        ),
      (r) => setMessage(r.ok ? null : { ok: false, text: r.message || 'Triase belum tersimpan.' }),
    );
  };

  const secs = item.losMinutes * 60 + addSeconds;
  const losAlert = edLosAlert(item, Math.floor(secs / 60));
  const blocker = !canTriage
    ? `${TRIAGE_ROLE_REASON}; posisi ini mengerjakan identifikasi dan admisi.`
    : !identified
      ? 'Identifikasi pasien dan pasang gelang identitas dulu.'
      : !ttvDone
        ? 'Catat tanda vital dulu; saran sistem dihitung dari tanda vital.'
        : under && !reasonOk
          ? `Level ${chosen} di bawah saran sistem (triase ${item.suggestedLevel}): isi alasan klinis dulu.`
          : scn && !canPick && !levelDone
            ? 'Menunggu giliran langkah triase di simulasi.'
            : null;
  const saveDisabled = !allowed || !!blocker || working;
  const savedText = scn
    ? levelDone
      ? `Triase ${item.triageLevel ?? chosen} tersimpan${bedDone ? ' · bed R2 · monitor EKG, SpO2, dan TD terpasang' : ''}`
      : null
    : stored
      ? `Triase ${stored.level} tersimpan ${formatJam(stored.at)} · bed ${item.bed ?? 'area triase'} · ${stored.orders.length} order dikirim${stored.overrideReason ? ' · override beralasan tercatat di jejak audit' : ''} · ${stored.by}`
      : null;
  const advice =
    chosen === item.suggestedLevel
      ? item.recommendation
      : `${TRIAGE_GENERIC[chosen]}${under ? ` Sistem menyarankan triase ${item.suggestedLevel}.` : ''}`;

  return (
    <aside
      aria-label="Triase pasien"
      className="flex-[1_1_340px] overflow-hidden rounded-card border border-line bg-white lg:max-w-[420px]"
    >
      <div className="flex items-start justify-between gap-2.5 border-b border-line bg-[linear-gradient(100deg,rgba(196,50,10,0.08),#FFFFFF_60%)] px-4 py-3.5">
        <div className="flex min-w-0 flex-col gap-0.5">
          <span className="text-caption text-ink-500">
            Triase · tiba {formatJam(item.arrivedAt)} · {item.arrivalMode}
          </span>
          <h2 className="m-0 text-[17px] leading-snug font-bold">{item.patientName}</h2>
          {/* Jenis kelamin dan umur di baris sendiri: nama panjang (pasien anonim) tidak turun tiga baris. */}
          <span className="text-caption text-ink-700">
            {item.sex} · {item.ageLabel}
            {item.rm && (
              <>
                {' · '}
                <span className="font-mono">RM {item.rm}</span>
              </>
            )}
          </span>
        </div>
        <span className="flex flex-none flex-col items-end gap-1">
          <span role="timer" aria-label="Lama di IGD" className="flex flex-col items-end">
            <span className="text-[11px] text-ink-500">Lama di IGD</span>
            <span className={cx('font-mono font-semibold', losAlert ? 'text-danger' : 'text-ink-900')}>
              {formatTimer(secs)}
            </span>
          </span>
          {losAlert && <StatusFlag icon="clock">{losAlert}</StatusFlag>}
        </span>
      </div>
      <div className="flex flex-col gap-3 px-4 py-3.5">
        {scn && !identified && (
          <IdentifyBlock kd={kd} rm={item.rm} history={history} pending={pending} runTask={runTask} />
        )}
        <Field label="Keluhan utama" value={cc} onChange={(e) => setCc(e.target.value)} />
        {scn && identified && !ttvDone ? (
          <VitalsEntry tr={tr} pending={pending} runTask={runTask} />
        ) : (
          <ul aria-label="Tanda vital" className="m-0 grid list-none grid-cols-3 gap-2 p-0">
            {item.vitals.map((v) => {
              const flag = edVitalFlag(v);
              return (
                <li
                  key={v.label}
                  className={cx(
                    'flex min-w-0 flex-col rounded-control border px-2.5 py-2',
                    flag ? 'border-danger-border bg-koral-50' : 'border-line-soft bg-subtle',
                  )}
                >
                  <span className="flex flex-wrap items-center justify-between gap-1 text-[11.5px] text-ink-500">
                    {v.label}
                    {flag && <ValueFlagBadge flag={flag} />}
                  </span>
                  <span className={cx('font-bold', flag ? 'text-danger' : 'text-ink-900')}>{v.value}</span>
                </li>
              );
            })}
          </ul>
        )}
        <TriageLevelPicker
          value={chosen}
          suggested={item.suggestedLevel}
          maxLevel={item.maxLevel}
          disabled={!canPick || levelDone || working}
          lockReason="nyeri dada wajib minimal urgen sampai sindrom koroner disingkirkan"
          onChange={setChosen}
        />
        {/* Saran sistem berwarna sesuai level terpilih (mockup: 1–2 merah, 3 kuning, 4 hijau, 5 biru). */}
        <div
          role="status"
          className={cx(
            'flex gap-2.5 rounded-control border px-3 py-2.5 text-small',
            TRIAGE_META[chosen].advice.box,
          )}
        >
          <span className={cx('font-bold whitespace-nowrap', TRIAGE_META[chosen].advice.label)}>
            Saran sistem
          </span>
          <span className="text-ink-700">{advice}</span>
        </div>
        {under && !levelDone && (
          // Gerbang turun level (CLAUDE.md §4.9): alasan wajib ≥ SAFETY_REASON_MIN, simpan tetap nonaktif, server
          // memeriksa ulang (`triageBlocker`), dan alasan tercatat di jejak audit.
          <div className="flex flex-col gap-1">
            <label htmlFor={reasonId} className="text-small font-semibold text-ink-900">
              Alasan memilih level lebih rendah dari saran (triase {item.suggestedLevel})
            </label>
            <input
              id={reasonId}
              value={reason}
              maxLength={500}
              disabled={scn && !canPick}
              onChange={(e) => setReason(e.target.value)}
              placeholder="Contoh: nyeri dada atipikal, EKG awal normal"
              aria-describedby={`${reasonId}-info`}
              aria-invalid={!reasonOk}
              className={cx(
                'min-h-11 rounded-control border bg-white px-3 font-[inherit] text-body disabled:bg-muted',
                reasonOk ? 'border-line-strong' : 'border-[#F04438]',
              )}
            />
            <span
              id={`${reasonId}-info`}
              className={cx('text-caption', reasonOk ? 'text-ink-500' : 'font-semibold text-danger')}
            >
              {reasonOk
                ? 'Alasan tercatat di jejak audit triase.'
                : `Wajib diisi (minimal ${SAFETY_REASON_MIN} karakter) sebelum triase bisa disimpan.`}
            </span>
          </div>
        )}
        {scn && levelDone && alasanVisible && !taskDone(tr, 'alasan') && (
          <ReasonForm enabled={alasanOpen && !pending} onSubmit={(r) => runTask(tr, 'alasan', r)} />
        )}
        <fieldset className="m-0 flex flex-col gap-1 border-0 p-0">
          <legend className="mb-1 p-0 text-small font-semibold">{item.orderTitle}</legend>
          {item.orders.map((o, i) => (
            <label key={o.id} className="flex min-h-11 cursor-pointer items-center gap-2.5 text-small">
              <input
                type="checkbox"
                checked={!!orders[i]}
                onChange={() => setOrders((cur) => cur.map((x, j) => (j === i ? !x : x)))}
                className="size-[18px] accent-brand-600"
              />
              {o.label}
            </label>
          ))}
        </fieldset>
        {scn && levelDone ? null : (
          // Tombol simpan berwarna level (mockup), abu bila nonaktif.
          <button
            type="button"
            className={cx(
              'inline-flex h-12 items-center justify-center rounded-control border px-4 font-[inherit] font-bold',
              saveDisabled ? TRIAGE_SAVE_DISABLED : TRIAGE_META[chosen].save,
            )}
            disabled={saveDisabled}
            aria-describedby={blocker ? 'triase-blocker' : undefined}
            onClick={save}
          >
            Simpan triase {chosen}
            {item.bed ? ` dan tempatkan di bed ${item.bed}` : ''}
          </button>
        )}
        {blocker && !levelDone && (
          <span id="triase-blocker" className="text-caption font-semibold text-warning">
            {blocker}
          </span>
        )}
        {scn && levelDone && !bedDone && (!alasanVisible || taskDone(tr, 'alasan')) && (
          <Button
            variant="primary"
            disabled={!taskEnabled(tr, 'bed') || pending}
            onClick={() => runTask(tr, 'bed', true)}
          >
            Tempatkan di bed resusitasi 2 dan pasang monitor
          </Button>
        )}
        {savedText && (
          <span
            role="status"
            className="rounded-control border border-success-border bg-success-bg px-3 py-2 text-small font-semibold text-success"
          >
            ✓ {savedText}
          </span>
        )}
        {(message || error) && (
          <span role="alert" className="text-caption font-semibold text-danger">
            {message?.text ?? error?.message}
          </span>
        )}
        {(links.bed || links.ranap) && (
          <div className="grid grid-cols-2 gap-2">
            {links.bed && <PanelLink href={links.bed}>Minta bed</PanelLink>}
            {links.ranap && <PanelLink href={links.ranap}>Rawat inap</PanelLink>}
          </div>
        )}
      </div>
    </aside>
  );
}

function PanelLink({ href, children }: { href: string; children: string }) {
  return (
    <Link
      href={href}
      className="inline-flex min-h-11 items-center justify-center rounded-control border border-line-strong bg-white px-2.5 text-small font-semibold text-ink-900 no-underline"
    >
      {children}
    </Link>
  );
}

/** Alasan triase di bawah saran yang belum tercatat (mis. halaman dimuat ulang setelah level disimpan). */
function ReasonForm({ enabled, onSubmit }: { enabled: boolean; onSubmit: (r: string) => void }) {
  const [r, setR] = useState('');
  const short = r.trim().length < 10;
  return (
    <form
      className="flex flex-col gap-1.5 rounded-[12px] border border-danger-border bg-koral-50 p-3"
      onSubmit={(e) => {
        e.preventDefault();
        if (!short) onSubmit(r.trim());
      }}
    >
      <label htmlFor="alasan-triase" className="text-small font-semibold text-danger-strong">
        Triase di bawah saran sistem: tulis alasan klinis (wajib, minimal 10 karakter)
      </label>
      <textarea
        id="alasan-triase"
        rows={2}
        value={r}
        maxLength={120}
        onChange={(e) => setR(e.target.value)}
        className="rounded-control border border-line-strong bg-white px-3 py-2 font-[inherit]"
      />
      <Button type="submit" variant="danger" disabled={!enabled || short}>
        Simpan alasan
      </Button>
    </form>
  );
}
