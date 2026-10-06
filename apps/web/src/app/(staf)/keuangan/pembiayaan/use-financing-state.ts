'use client';

import type { Drawdown, FinancingOverview, InstalmentApplication } from '@simrs/shared';
import { useCallback, useState } from 'react';
import { eligibleBatches, facilityPosition, nextInstalmentStage, quoteDrawdown } from '@/lib/btn-pembiayaan';
import type { PembiayaanState } from '@/lib/btn-pembiayaan-toko';
import { useStoreAction } from '@/lib/demo/store/client';
import { DEMO_TODAY } from '@/lib/demo/fixtures/waktu';
import { type FinancingEventInput, recordFinancingEventAction } from './actions';

type Input = FinancingEventInput extends infer E ? (E extends unknown ? Omit<E, 'rev'> : never) : never;

/**
 * Keadaan layar pembiayaan di atas data server yang sudah memuat toko demo (domain `pembiayaan-btn`, ADR-0085):
 * pengajuan, pencairan, pembayaran BPJS, dan tahap cicilan tersimpan di server. Hanya pilihan batch yang lokal (isian
 * layar sebelum diajukan). Pasien skenario selalu dari server.
 */
export function useFinancingState(
  data: FinancingOverview,
  opts: { rev: number; stamps: PembiayaanState['stamps']; lastPay: PembiayaanState['lastPay'] },
) {
  const { run, pending } = useStoreAction(opts.rev);
  const [msg, setMsg] = useState<{ text: string; ok: boolean } | null>(null);
  const [selected, setSelected] = useState<Record<string, boolean>>({ p3: true, p4: true });

  const draws = data.drawdowns;
  const position = facilityPosition(data.facility, draws, DEMO_TODAY);
  const free = eligibleBatches(data.pool, draws);
  const picked = free.filter((b) => selected[b.id]);
  const quote = quoteDrawdown(picked, data.facility.advanceRatePercent, position.available);
  const inProcess = draws.find((d) => d.stage === 'diajukan' || d.stage === 'disetujui') ?? null;
  const target = draws.find((d) => d.stage === 'cair') ?? null;
  const applications = data.applications;
  const basisOf = (d: Drawdown) =>
    data.pool
      .filter((b) => d.batchIds.includes(b.id))
      .map((b) => `${b.period.replace(' 2026', '')} ${b.kind}`)
      .join(', ');
  /** Nilai klaim dasar suatu pencairan (bigint). */
  const basisTotalOf = (d: Drawdown) =>
    data.pool.filter((b) => d.batchIds.includes(b.id)).reduce((sum, b) => sum + BigInt(b.amount), 0n);
  // Pengajuan terakhir yang dibuat di layar ini (urutan id) yang masih tampil di kartu pengajuan.
  const active =
    [...draws].reverse().find((d) => d.id.startsWith('PCR-2610-') && opts.stamps[d.id]?.aju) ?? null;

  const record = useCallback(
    (input: Input): Promise<boolean> =>
      new Promise((resolve) => {
        run(
          async (r) => {
            const res = await recordFinancingEventAction({ ...input, rev: r } as FinancingEventInput);
            return { ...res, ok: !!res.ok };
          },
          (res) => {
            setMsg(
              res.ok
                ? { text: res.message ?? 'Tersimpan', ok: true }
                : { text: res.error ?? 'Ditolak.', ok: false },
            );
            resolve(res.ok);
          },
        );
      }),
    [run],
  );

  const lp = opts.lastPay;
  const lastPay = lp
    ? {
        drawdownId: lp.drawdownId,
        claims: BigInt(lp.claims),
        principal: BigInt(lp.principal),
        margin: BigInt(lp.margin),
        days: lp.days,
        assumed: false,
        forwarded: BigInt(lp.forwarded),
        at: lp.at,
        basis: lp.basis,
      }
    : null;

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
    active,
    target,
    lastPay,
    basisOf,
    basisTotalOf,
    stampsOf: (id: string) => {
      const st = opts.stamps[id] ?? {};
      const hm = (v?: string) => (v ? v.slice(11, 16).replace(':', '.') : undefined);
      return { aju: hm(st.aju), ok: hm(st.ok), cair: hm(st.cair) };
    },
    applications,
    submitDrawdown: async () => {
      if (inProcess || picked.length === 0 || quote.disburse <= 0n) return;
      if (
        await record({
          kind: 'ajukan-pencairan',
          batchIds: picked.map((b) => b.id),
          principal: quote.disburse.toString(),
        })
      ) {
        setSelected({});
      }
    },
    advanceDrawdown: async (d: Drawdown) => {
      await record({ kind: 'pencairan-lanjut', drawdownId: d.id });
    },
    payBpjs: async () => {
      if (target) await record({ kind: 'bayar-bpjs', drawdownId: target.id });
    },
    advanceApp: async (a: InstalmentApplication) => {
      if (!nextInstalmentStage(a.stage) || a.scenario) return;
      await record({ kind: 'cicilan-lanjut', applicationId: a.id, stage: a.stage });
    },
    rejectApp: async (a: InstalmentApplication, reason: string): Promise<boolean> => {
      if (a.scenario) return false;
      return record({ kind: 'cicilan-tolak', applicationId: a.id, reason });
    },
  };
}

export type FinancingState = ReturnType<typeof useFinancingState>;
