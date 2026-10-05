'use client';

import { type EdTrackingItem, formatJam, type TriageLevel } from '@simrs/shared';
import { Button, cx, Field, SafetyGate } from '@simrs/ui';
import Link from 'next/link';
import { useEffect, useRef, useState, useTransition } from 'react';
import { StatusFlag, ValueFlagBadge } from '@/components/klinis/status-flag';
import { TriageLevelPicker } from '@/components/rawat-inap/triage-level-picker';
import { taskDone, taskEnabled, useScenarioTask } from '@/components/rawat-inap/use-scenario-task';
import {
  edLosAlert,
  edVitalFlag,
  formatTimer,
  TRIAGE_GENERIC,
  TRIAGE_ROLE_REASON,
  triageNeedsReason,
  triageSaveAllowed,
} from '@/lib/rawat-inap';
import type { ScenarioStepState } from '@/lib/rawat-inap-scenario';
import { saveTriageAction } from './actions-demo';
import { IdentifyBlock, VitalsEntry } from './scenario-intake';

export interface SavedTriage {
  level: TriageLevel;
  message: string;
}

/** Panel triase pasien terpilih (mockup IGD): tanda vital, level 1–5, saran sistem, gerbang turun level, order. */
export function TriagePanel({
  item,
  addSeconds,
  saved,
  onSaved,
  kd,
  tr,
  rev,
  history,
  links,
  canTriage,
}: {
  item: EdTrackingItem;
  addSeconds: number;
  saved: SavedTriage | undefined;
  onSaved: (id: string, s: SavedTriage) => void;
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
    saved?.level ?? item.triageLevel ?? item.suggestedLevel,
  );
  const [reason, setReason] = useState<string | null>(null);
  const [orders, setOrders] = useState<boolean[]>(() => item.orders.map((o) => o.defaultOn));
  const [cc, setCc] = useState(item.chiefComplaint);
  const [message, setMessage] = useState<{ ok: boolean; text: string } | null>(null);
  const [busy, startTransition] = useTransition();
  const pendingReason = useRef<string | null>(null);

  const scn = item.scenario;
  const identified = !scn || taskDone(kd, 'gelang');
  const ttvDone = !scn || taskDone(tr, 'ttv');
  const levelDone = scn ? taskDone(tr, 'level') : false;
  const alasanVisible = scn && !!tr?.tasks.alasan?.visible;
  const alasanOpen = scn && canTriage && taskEnabled(tr, 'alasan');
  const bedDone = scn && taskDone(tr, 'bed');
  const canPick = canTriage && (scn ? taskEnabled(tr, 'level') : true);
  const under = triageNeedsReason(item.suggestedLevel, chosen);
  const allowed = triageSaveAllowed(item.suggestedLevel, chosen, reason ?? '');
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
    setReason(null);
    setMessage(null);
  };

  const save = () => {
    if (!allowed || !canTriage) return;
    if (scn) {
      pendingReason.current = under ? reason : null;
      runTask(tr, 'level', String(chosen));
      return;
    }
    startTransition(async () => {
      const r = await saveTriageAction({
        encounterId: item.encounterId,
        chosenLevel: chosen,
        overrideReason: under ? reason : null,
        orders: item.orders.filter((_, i) => orders[i]).map((o) => o.label),
      });
      if (r.ok) {
        const audit = r.ok.override ? ' · override beralasan tercatat di jejak audit' : '';
        onSaved(item.encounterId, {
          level: chosen,
          message: `Triase ${chosen} tersimpan ${r.ok.at} · bed ${item.bed ?? 'area triase'} · ${r.ok.orders} order dikirim${audit} (simulasi, tidak disimpan)`,
        });
        setMessage(null);
      } else setMessage({ ok: false, text: r.error ?? 'Triase belum tersimpan.' });
    });
  };

  const secs = item.losMinutes * 60 + addSeconds;
  const losAlert = edLosAlert(item, Math.floor(secs / 60));
  const blocker = !canTriage
    ? `${TRIAGE_ROLE_REASON}; posisi ini mengerjakan identifikasi dan admisi.`
    : !identified
      ? 'Identifikasi pasien dan pasang gelang identitas dulu.'
      : !ttvDone
        ? 'Catat tanda vital dulu; saran sistem dihitung dari tanda vital.'
        : under && !reason
          ? `Level ${chosen} di bawah saran sistem: isi alasan klinis di gerbang keselamatan.`
          : scn && !canPick && !levelDone
            ? 'Menunggu giliran langkah triase di simulasi.'
            : null;
  const savedText = scn
    ? levelDone
      ? `Triase ${item.triageLevel ?? chosen} tersimpan${bedDone ? ' · bed R2 · monitor EKG, SpO2, dan TD terpasang' : ''}`
      : null
    : (saved?.message ?? null);
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
                    flag ? 'border-danger-border bg-[#FFFBFA]' : 'border-line-soft bg-subtle',
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
        <div
          role="status"
          className="flex gap-2.5 rounded-control border border-line bg-subtle px-3 py-2.5 text-small"
        >
          <span className="font-bold whitespace-nowrap text-brand-700">Saran sistem</span>
          <span className="text-ink-700">{advice}</span>
        </div>
        {under && !levelDone && (
          <SafetyGate
            title={`Level ${chosen} di bawah saran sistem (triase ${item.suggestedLevel})`}
            recommendation={`Kembali ke level ${item.suggestedLevel} (saran sistem)`}
            onFollow={() => setChosen(item.suggestedLevel)}
            onOverride={(r) => setReason(r)}
            resolved={reason ? { kind: 'override', text: reason } : null}
            disabled={!canPick && scn}
          >
            Menurunkan level menunda penanganan. Alasan klinis wajib, tercatat di jejak audit, dan ditinjau
            komite mutu.
          </SafetyGate>
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
          <Button
            variant={chosen <= 2 ? 'danger' : 'primary'}
            className="h-12 font-bold"
            disabled={!allowed || !!blocker || working}
            aria-describedby={blocker ? 'triase-blocker' : undefined}
            onClick={save}
          >
            Simpan triase {chosen}
            {!scn && item.bed ? ` dan tempatkan di bed ${item.bed}` : ''}
          </Button>
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
      className="flex flex-col gap-1.5 rounded-[12px] border border-danger-border bg-[#FFF8F7] p-3"
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
