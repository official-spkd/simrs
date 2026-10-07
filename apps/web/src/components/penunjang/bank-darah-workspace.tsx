'use client';

import { formatJam, formatTanggal, formatTanggalLahir } from '@simrs/shared';
import { Alert, Button, Chip, cx, PatientBanner } from '@simrs/ui';
import { useState } from 'react';
import { recordBloodAction, checkBloodAction } from '@/app/(staf)/penunjang/bank-darah/actions-demo';
import { useStoreAction } from '@/lib/demo/store/client';
import {
  type Abo,
  type BloodAction,
  BLOOD_GATE_TEXT,
  type BloodRequest,
  type BloodState,
  type BloodUnit,
  COMPONENT_LABEL,
  isExpired,
  stageOf,
  STAGES,
  unitGate,
} from '@/lib/penunjang-bank-darah';
import type { BloodBankData } from '@/lib/server/data/penunjang/bank-darah';
import { BedsidePanel, IssuePanel, MonitorPanel } from './bank-darah-panels';
import { StageSteps } from './stage-steps';

const STAGE_TONE = {
  permintaan: 'neutral',
  golongan: 'warning',
  crossmatch: 'warning',
  pengeluaran: 'brand',
  transfusi: 'info',
  selesai: 'success',
} as const;

export type BloodCheck = (input: Parameters<typeof checkBloodAction>[0]) => void;
export type BloodRun = (action: BloodAction, onDone?: () => void) => void;

/**
 * S08 · Bank darah: worklist permintaan → golongan darah → crossmatch → pengeluaran dengan cek ganda dua petugas →
 * pindai gelang + kantong di samping pasien → pemantauan reaksi transfusi. Keadaan tersimpan di toko demo; setiap
 * langkah diperiksa server dari sesi petugas.
 */
export function BloodBankWorkspace({
  data,
  userName,
  userId,
}: {
  data: BloodBankData;
  userName: string;
  userId: string;
}) {
  const state = data.state;
  const [selectedId, setSelectedId] = useState(data.state.requests[0]?.id ?? '');
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null);
  const { run: save, pending } = useStoreAction(data.rev);
  const sel = state.requests.find((r) => r.id === selectedId);

  const run: BloodRun = (action, onDone) => {
    const r = state.requests.find((x) => x.id === action.requestId);
    const group = { abo: r?.abo ?? 'O', rh: r?.rh ?? '+' };
    const payload =
      action.type === 'crossmatch' || action.type === 'keluarkan' ? { ...action, group } : action;
    save(
      (rev) => recordBloodAction(payload, rev),
      (result) => {
        setMsg({ ok: result.ok, text: result.message });
        if (result.ok) onDone?.();
      },
    );
  };
  const check: BloodCheck = (input) =>
    save(
      (rev) => checkBloodAction(input, rev),
      (result) => setMsg({ ok: result.ok, text: result.message }),
    );

  return (
    <div className="grid grid-cols-1 gap-4 lg:grid-cols-[minmax(0,0.85fr)_minmax(0,1.6fr)]">
      <div className="flex min-w-0 flex-col gap-4">
        <section
          aria-label="Permintaan darah"
          className="flex flex-col gap-2 rounded-card border border-white/95 bg-white/90 shadow-card p-4"
        >
          <h2 className="m-0 text-[15px] font-semibold">Permintaan darah</h2>
          <ul className="m-0 flex list-none flex-col gap-2 p-0">
            {state.requests.map((r) => {
              const st = stageOf(r);
              const label = STAGES.find((s) => s.id === st)?.label ?? st;
              return (
                <li key={r.id}>
                  <button
                    type="button"
                    aria-pressed={r.id === selectedId}
                    onClick={() => {
                      setSelectedId(r.id);
                      setMsg(null);
                    }}
                    className={cx(
                      'flex w-full cursor-pointer flex-col gap-1 rounded-[12px] border p-3 text-left font-[inherit] transition-colors',
                      r.id === selectedId
                        ? 'border-brand-300 bg-[linear-gradient(90deg,var(--color-brand-100),rgba(255,255,255,0.4))]'
                        : 'border-line bg-white/80 hover:bg-brand-50/60',
                    )}
                  >
                    <span className="flex flex-wrap items-center justify-between gap-2">
                      <span className="font-semibold">{r.patient.name}</span>
                      <Chip tone={r.transfusion?.reaction ? 'danger' : STAGE_TONE[st]}>
                        {r.transfusion?.reaction ? 'Reaksi transfusi' : label}
                      </Chip>
                    </span>
                    <span className="text-small text-ink-700">
                      {r.component} {r.units} kantong · {r.urgency === 'cito' ? 'CITO' : 'rutin'} · minta{' '}
                      {formatJam(r.requestedAt)}
                    </span>
                    <span className="text-caption text-ink-500">{r.location}</span>
                  </button>
                </li>
              );
            })}
          </ul>
        </section>
        <StockPanel units={state.units} today={data.today} />
      </div>
      <section
        aria-label="Detail permintaan darah"
        className="flex min-w-0 flex-col gap-3 rounded-card border border-white/95 bg-white/90 shadow-card p-4"
      >
        {sel ? (
          <RequestDetail
            key={sel.id}
            r={sel}
            state={state}
            today={data.today}
            busy={pending}
            run={run}
            check={check}
            checks={data.checks}
            userId={userId}
            userName={userName}
            msg={msg}
          />
        ) : (
          <p className="m-0 text-small">Pilih permintaan di daftar.</p>
        )}
      </section>
    </div>
  );
}

function RequestDetail({
  r,
  state,
  today,
  busy,
  run,
  userName,
  userId,
  check,
  checks,
  msg,
}: {
  r: BloodRequest;
  state: BloodState;
  today: string;
  busy: boolean;
  run: BloodRun;
  userName: string;
  userId: string;
  check: BloodCheck;
  checks: BloodBankData['checks'];
  msg: { ok: boolean; text: string } | null;
}) {
  const st = stageOf(r);
  const [abo, setAbo] = useState<Abo>('O');
  const [rh, setRh] = useState<'+' | '-'>('+');
  const okCount = r.crossmatches.filter((c) => c.result === 'kompatibel').length;
  return (
    <>
      <div className="flex flex-wrap items-start justify-between gap-2">
        <span className="flex flex-col">
          <h2 className="m-0 text-[15px] font-semibold">
            {COMPONENT_LABEL[r.component]} · {r.units} kantong
          </h2>
          <span className="text-small text-ink-700">
            {r.indication} · {r.urgency === 'cito' ? 'CITO' : 'rutin'} · diminta {formatJam(r.requestedAt)}{' '}
            oleh {r.dpjp}
          </span>
        </span>
        {r.abo && r.rh && (
          <Chip tone="info" mono>
            Golongan pasien {r.abo} Rh{r.rh === '+' ? '+' : '−'}
          </Chip>
        )}
      </div>
      <PatientBanner
        name={r.patient.name}
        sex={r.patient.sex}
        ageYears={r.patient.ageYears}
        birthDate={formatTanggalLahir(r.patient.birthDate)}
        mrn={r.patient.rm}
        allergies={r.patient.allergies}
        guarantor={r.patient.guarantor}
        attending={r.dpjp}
      />
      <StageSteps steps={STAGES} current={st} label="Tahap permintaan darah" />
      {msg && <Alert level={msg.ok ? 'success' : 'critical'}>{msg.text}</Alert>}

      {st === 'permintaan' && (
        <div className="flex flex-col gap-2">
          <span className="text-small text-ink-700">
            Cocokkan label sampel (nama, RM, tanggal lahir, jam ambil) dengan formulir permintaan sebelum
            diterima.
          </span>
          <Button
            variant="primary"
            className="self-start"
            disabled={busy}
            onClick={() => run({ type: 'terima', requestId: r.id })}
          >
            Terima permintaan & sampel
          </Button>
        </div>
      )}

      {st === 'golongan' && (
        <form
          aria-label="Golongan darah pasien"
          className="flex flex-wrap items-end gap-3"
          onSubmit={(e) => {
            e.preventDefault();
            run({ type: 'golongan', requestId: r.id, abo, rh });
          }}
        >
          <label className="flex flex-col gap-1 text-small font-semibold text-ink-700">
            ABO (forward + reverse)
            <select
              value={abo}
              onChange={(e) => setAbo(e.target.value as Abo)}
              className="h-11 rounded-control border border-line-strong bg-white px-3 font-[inherit]"
            >
              {(['O', 'A', 'B', 'AB'] as const).map((g) => (
                <option key={g}>{g}</option>
              ))}
            </select>
          </label>
          <label className="flex flex-col gap-1 text-small font-semibold text-ink-700">
            Rhesus
            <select
              value={rh}
              onChange={(e) => setRh(e.target.value as '+' | '-')}
              className="h-11 rounded-control border border-line-strong bg-white px-3 font-[inherit]"
            >
              <option value="+">Positif</option>
              <option value="-">Negatif</option>
            </select>
          </label>
          <Button type="submit" variant="primary" disabled={busy}>
            Simpan golongan
          </Button>
        </form>
      )}

      {r.groupSource && <span className="text-caption text-ink-500">Golongan: {r.groupSource}</span>}

      {(st === 'crossmatch' || st === 'pengeluaran') && (
        <CrossmatchPanel r={r} units={state.units} today={today} busy={busy} run={run} okCount={okCount} />
      )}
      {r.issued.length < r.units &&
        r.crossmatches.some(
          (c) => c.result === 'kompatibel' && !r.issued.some((i) => i.unitId === c.unitId),
        ) && (
          <IssuePanel
            r={r}
            units={state.units}
            busy={busy}
            run={run}
            userId={userId}
            userName={userName}
            check={check}
            checks={checks}
          />
        )}
      {st === 'transfusi' && (!r.transfusion || !!r.transfusion.finishedAt) && (
        <BedsidePanel r={r} units={state.units} busy={busy} run={run} check={check} checks={checks} />
      )}
      {r.transfusion && <MonitorPanel r={r} units={state.units} busy={busy} run={run} />}
    </>
  );
}

function CrossmatchPanel({
  r,
  units,
  today,
  busy,
  run,
  okCount,
}: {
  r: BloodRequest;
  units: readonly BloodUnit[];
  today: string;
  busy: boolean;
  run: BloodRun;
  okCount: number;
}) {
  const candidates = units.filter(
    (u) => u.component === r.component && (u.status === 'tersedia' || u.requestId === r.id),
  );
  return (
    <section
      aria-label="Crossmatch"
      className="flex flex-col gap-2 rounded-[12px] border border-white/95 bg-[linear-gradient(135deg,var(--color-brand-50),var(--color-batu-50))] p-3"
    >
      <span className="flex flex-wrap items-center justify-between gap-2">
        <span className="font-semibold">Crossmatch</span>
        <Chip tone={okCount >= r.units ? 'success' : 'warning'}>
          {okCount} dari {r.units} kantong kompatibel
        </Chip>
      </span>
      <ul className="m-0 flex list-none flex-col gap-1.5 p-0">
        {candidates.map((u) => {
          const gate = unitGate(r, u, today);
          const done = r.crossmatches.find((c) => c.unitId === u.id);
          return (
            <li
              key={u.id}
              className={cx(
                'flex flex-wrap items-center justify-between gap-2 rounded-control border p-2.5 text-small',
                gate ? 'border-line bg-batu-100' : 'border-line',
              )}
            >
              <span className="min-w-0">
                <span className="font-mono font-semibold">{u.bagNo}</span> · {u.abo} Rh
                {u.rh === '+' ? '+' : '−'} · {u.volumeMl} mL · ED{' '}
                {formatTanggal(`${u.expiry}T00:00:00+07:00`)}
              </span>
              {done ? (
                <Chip tone={done.result === 'kompatibel' ? 'success' : 'danger'}>
                  {done.result === 'kompatibel' ? 'Kompatibel' : 'Inkompatibel'} · {formatJam(done.at)}
                </Chip>
              ) : gate ? (
                <Chip tone="danger">
                  {gate === 'BAG_EXPIRED'
                    ? 'Kedaluwarsa'
                    : gate === 'ABO_INCOMPATIBLE'
                      ? 'Golongan tidak kompatibel'
                      : 'Tidak bisa dipakai'}
                </Chip>
              ) : okCount >= r.units ? (
                <span className="text-caption text-ink-500">kebutuhan terpenuhi</span>
              ) : (
                <span className="flex flex-wrap gap-2">
                  <Button
                    size="sm"
                    disabled={busy}
                    onClick={() =>
                      run({ type: 'crossmatch', requestId: r.id, unitId: u.id, result: 'kompatibel' })
                    }
                  >
                    Hasil kompatibel
                  </Button>
                  <Button
                    size="sm"
                    variant="ghost"
                    disabled={busy}
                    onClick={() =>
                      run({ type: 'crossmatch', requestId: r.id, unitId: u.id, result: 'inkompatibel' })
                    }
                  >
                    Inkompatibel
                  </Button>
                </span>
              )}
            </li>
          );
        })}
      </ul>
      <span className="text-caption text-ink-500">{BLOOD_GATE_TEXT.ABO_INCOMPATIBLE}</span>
    </section>
  );
}

function StockPanel({ units, today }: { units: readonly BloodUnit[]; today: string }) {
  const groups = ['PRC', 'TC', 'FFP'] as const;
  return (
    <section
      aria-label="Stok kantong darah"
      className="flex flex-col gap-2 rounded-card border border-white/95 bg-white/90 shadow-card p-4"
    >
      <h2 className="m-0 text-[15px] font-semibold">Stok kantong</h2>
      <ul className="m-0 flex list-none flex-col gap-1.5 p-0 text-small">
        {groups.map((c) => {
          const list = units.filter((u) => u.component === c);
          const free = list.filter((u) => u.status === 'tersedia' && !isExpired(u, today));
          const byGroup = new Map<string, number>();
          for (const u of free) byGroup.set(`${u.abo}${u.rh}`, (byGroup.get(`${u.abo}${u.rh}`) ?? 0) + 1);
          return (
            <li key={c} className="flex flex-col gap-0.5">
              <span className="font-semibold">
                {c} · tersedia {free.length}
                {list.some((u) => u.status === 'dicadangkan') &&
                  ` · dicadangkan ${list.filter((u) => u.status === 'dicadangkan').length}`}
              </span>
              <span className="text-ink-700">
                {[...byGroup.entries()].map(([g, n]) => `${g} ${n}`).join(' · ') || 'kosong'}
              </span>
            </li>
          );
        })}
      </ul>
      {units.some((u) => isExpired(u, today) && u.status === 'tersedia') && (
        <Chip tone="danger" className="self-start">
          {units.filter((u) => isExpired(u, today) && u.status === 'tersedia').length} kantong kedaluwarsa ·
          pisahkan untuk dimusnahkan
        </Chip>
      )}
    </section>
  );
}
