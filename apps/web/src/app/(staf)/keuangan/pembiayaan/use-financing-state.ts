'use client';

import { type Drawdown, type FinancingOverview, formatJam, type InstalmentApplication } from '@simrs/shared';
import { useState, useTransition } from 'react';
import { useDemoClock } from '@/components/btn/use-scenario-task';
import {
  addDays,
  type BpjsPayment,
  eligibleBatches,
  facilityPosition,
  nextInstalmentStage,
  quoteDrawdown,
  simulateBpjsPayment,
} from '@/lib/btn-pembiayaan';
import { DEMO_TODAY } from '@/lib/demo/fixtures/waktu';
import { type FinancingEventInput, recordFinancingEventAction } from './actions';

type AppPatch = Pick<InstalmentApplication, 'stage' | 'history' | 'rejectReason'>;

/**
 * Keadaan layar pembiayaan di atas data server (mode presentasi, tidak disimpan): pilihan batch, pengajuan dan
 * pencairan piutang, simulasi pembayaran BPJS, serta tahap cicilan pasien. Pasien skenario selalu dari server.
 */
export function useFinancingState(data: FinancingOverview) {
  const clock = useDemoClock(data.asOf);
  const [pending, startTransition] = useTransition();
  const [msg, setMsg] = useState<{ text: string; ok: boolean } | null>(null);
  const [selected, setSelected] = useState<Record<string, boolean>>({ p3: true, p4: true });
  const [draws, setDraws] = useState<Drawdown[]>(data.drawdowns);
  const [activeId, setActiveId] = useState<string | null>(null);
  const [lastPay, setLastPay] = useState<(BpjsPayment & { at: string; basis: string }) | null>(null);
  const [apps, setApps] = useState<Record<string, AppPatch>>({});
  /** Jam tiap tahap pencairan yang diajukan di layar ini (mockup: "pukul HH.MM" per langkah). */
  const [stamps, setStamps] = useState<Record<string, { aju?: string; ok?: string; cair?: string }>>({});
  const stamp = (id: string, k: 'aju' | 'ok' | 'cair') =>
    setStamps((cur) => ({ ...cur, [id]: { ...cur[id], [k]: formatJam(clock()) } }));

  const position = facilityPosition(data.facility, draws, DEMO_TODAY);
  const free = eligibleBatches(data.pool, draws);
  const picked = free.filter((b) => selected[b.id]);
  const quote = quoteDrawdown(picked, data.facility.advanceRatePercent, position.available);
  const inProcess = draws.find((d) => d.stage === 'diajukan' || d.stage === 'disetujui') ?? null;
  const target = draws.find((d) => d.stage === 'cair') ?? null;
  const applications = data.applications.map((a) => (a.scenario ? a : { ...a, ...apps[a.id] }));
  const basisOf = (d: Drawdown) =>
    data.pool
      .filter((b) => d.batchIds.includes(b.id))
      .map((b) => `${b.period.replace(' 2026', '')} ${b.kind}`)
      .join(', ');
  /** Nilai klaim dasar suatu pencairan (bigint). */
  const basisTotalOf = (d: Drawdown) =>
    data.pool.filter((b) => d.batchIds.includes(b.id)).reduce((sum, b) => sum + BigInt(b.amount), 0n);

  const record = (input: FinancingEventInput, label: string): Promise<boolean> =>
    new Promise((resolve) => {
      startTransition(async () => {
        const r = await recordFinancingEventAction(input);
        if (r.error) {
          setMsg({ text: r.error, ok: false });
          resolve(false);
          return;
        }
        setMsg({ text: `${label} · ${formatJam(clock())} (simulasi, tidak disimpan)`, ok: true });
        resolve(true);
      });
    });

  const submitDrawdown = async () => {
    if (inProcess || picked.length === 0 || quote.disburse <= 0n) return;
    const seq = draws.filter((d) => d.id.startsWith('PCR-2610-')).length + 1;
    const id = `PCR-2610-${String(seq).padStart(2, '0')}`;
    const principal = quote.disburse.toString();
    const batchIds = picked.map((b) => b.id);
    if (!(await record({ kind: 'ajukan-pencairan', batchIds, principal }, `Pengajuan ${id} dikirim ke BTN`)))
      return;
    setDraws((cur) => [
      ...cur,
      {
        id,
        batchIds,
        principal,
        stage: 'diajukan',
        disbursedOn: null,
        dueOn: null,
        settledOn: null,
        marginPaid: null,
      },
    ]);
    setActiveId(id);
    stamp(id, 'aju');
    setSelected({});
  };

  const advanceDrawdown = async (d: Drawdown) => {
    const label =
      d.stage === 'diajukan' ? `${d.id} disetujui BTN` : `${d.id} dicairkan ke rekening operasional`;
    if (!(await record({ kind: 'pencairan-lanjut', drawdownId: d.id }, label))) return;
    stamp(d.id, d.stage === 'diajukan' ? 'ok' : 'cair');
    setDraws((cur) =>
      cur.map((x) => {
        if (x.id !== d.id) return x;
        if (x.stage === 'diajukan') return { ...x, stage: 'disetujui' };
        if (x.stage === 'disetujui') {
          return {
            ...x,
            stage: 'cair',
            disbursedOn: DEMO_TODAY,
            dueOn: addDays(DEMO_TODAY, data.facility.maxTenorDays),
          };
        }
        return x;
      }),
    );
  };

  const payBpjs = async () => {
    if (!target) return;
    const pay = simulateBpjsPayment(data.facility, target, data.pool, DEMO_TODAY);
    if (
      !(await record({ kind: 'bayar-bpjs', drawdownId: target.id }, `BPJS membayar klaim dasar ${target.id}`))
    )
      return;
    setDraws((cur) =>
      cur.map((x) =>
        x.id === target.id
          ? { ...x, stage: 'lunas', settledOn: DEMO_TODAY, marginPaid: pay.margin.toString() }
          : x,
      ),
    );
    setLastPay({ ...pay, at: clock(), basis: basisOf(target) });
  };

  const advanceApp = async (a: InstalmentApplication) => {
    const next = nextInstalmentStage(a.stage);
    if (!next || a.scenario) return;
    if (
      !(await record(
        { kind: 'cicilan-lanjut', applicationId: a.id, stage: a.stage },
        `${a.reference}: tahap berikutnya`,
      ))
    )
      return;
    setApps((cur) => ({
      ...cur,
      [a.id]: { stage: next, history: [...a.history, { stage: next, at: clock() }], rejectReason: null },
    }));
  };

  const rejectApp = async (a: InstalmentApplication, reason: string): Promise<boolean> => {
    if (a.scenario) return false;
    if (!(await record({ kind: 'cicilan-tolak', applicationId: a.id, reason }, `${a.reference} ditolak BTN`)))
      return false;
    setApps((cur) => ({
      ...cur,
      [a.id]: {
        stage: 'ditolak',
        history: [...a.history, { stage: 'ditolak', at: clock() }],
        rejectReason: reason.trim(),
      },
    }));
    return true;
  };

  return {
    pending,
    msg,
    position,
    free,
    selected,
    toggle: (id: string) => setSelected((cur) => ({ ...cur, [id]: !cur[id] })),
    selectAll: (on: boolean) => setSelected(on ? Object.fromEntries(free.map((b) => [b.id, true])) : {}),
    picked,
    quote,
    draws,
    inProcess,
    active: draws.find((d) => d.id === activeId) ?? null,
    target,
    lastPay,
    basisOf,
    basisTotalOf,
    stampsOf: (id: string) => stamps[id] ?? {},
    applications,
    submitDrawdown,
    advanceDrawdown,
    payBpjs,
    advanceApp,
    rejectApp,
  };
}

export type FinancingState = ReturnType<typeof useFinancingState>;
