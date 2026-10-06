'use client';

import { formatJam, formatRupiah } from '@simrs/shared';
import { Button, Chip, cx, KpiCard, RadioSegmented } from '@simrs/ui';
import { useState } from 'react';
import { useDemoDispatch } from '@/lib/demo/store/client';
import { formatRupiahRingkas } from '@/lib/keuangan';
import {
  costShares,
  hari,
  type KasusCosting,
  losVariance,
  marginBy,
  TELAAH_REASON_MIN,
  totalView,
  unitCost,
} from '@/lib/keuangan-costing';
import type { CostingState } from '@/lib/keuangan-costing-toko';
import type { CostingBoard } from '@/lib/server/data/keuangan-lanjut';
import { AlasanForm } from './alasan-form';

const signed = (v: bigint) => (v < 0n ? `−${formatRupiah(-v)}` : formatRupiah(v));
const BAR = ['bg-brand-700', 'bg-brand-500', 'bg-[#6E8BC7]', 'bg-[#C7A23A]', 'bg-ink-500'];

/**
 * I10 · Costing dan case-mix: biaya per kasus berbasis aktivitas vs tarif INA-CBG, margin per kelompok kasus dan per
 * DPJP, komposisi biaya, dan varians lama rawat terhadap clinical pathway. Telaah dikirim ke komite medik dengan
 * alasan (tersimpan di toko demo, domain `costing`). Data kuartal tertutup (hanya baca).
 */
export function CostingWorkspace({
  board,
  reviews,
  rev,
}: {
  board: CostingBoard;
  /** Telaah tersimpan per kasus (domain `costing`). */
  reviews: CostingState['reviews'];
  rev: number;
}) {
  const [by, setBy] = useState<'cbg' | 'dpjp'>('cbg');
  const [sel, setSel] = useState(board.cases[0]?.id ?? '');
  const [reviewing, setReviewing] = useState(false);
  const [flash, setFlash] = useState<string | null>(null);
  const { dispatch, error } = useDemoDispatch('costing', rev);
  const rows = marginBy(board.cases, by);
  const total = totalView(board.cases);
  const losers = marginBy(board.cases, 'cbg').filter((r) => r.margin < 0n);
  const k = board.cases.find((c) => c.id === sel) ?? board.cases[0];

  return (
    <div className="flex flex-col gap-4">
      <div role="region" aria-label="Indikator costing" className="grid grid-cols-2 gap-3.5 xl:grid-cols-4">
        <KpiCard
          label="Pendapatan INA-CBG"
          value={formatRupiahRingkas(total.revenue)}
          detail={`${total.cases.toLocaleString('id-ID')} kasus`}
        />
        <KpiCard
          label="Biaya pelayanan"
          value={formatRupiahRingkas(total.cost)}
          detail="berbasis aktivitas"
        />
        <KpiCard
          label="Margin"
          value={formatRupiahRingkas(total.margin)}
          hint={total.marginPct}
          tone={total.margin < 0n ? 'danger' : 'success'}
          tinted
        />
        <KpiCard
          label="Kelompok kasus merugi"
          value={losers.length}
          hint={losers.map((l) => l.key.split(' ')[0]).join(', ') || 'tidak ada'}
          tone={losers.length ? 'warning' : 'success'}
          tinted
        />
      </div>
      {flash && (
        <div
          role="status"
          className="rounded-control border border-[#B7DEC0] bg-[#EAF5EC] px-3 py-2 text-small text-success"
        >
          ✓ {flash}
        </div>
      )}
      {error && (
        <div
          role="alert"
          className="rounded-control border border-danger-border bg-danger-bg px-3 py-2 text-small text-danger"
        >
          {error}
        </div>
      )}
      <div className="flex flex-wrap items-center justify-between gap-3">
        <RadioSegmented
          label="Kelompokkan margin"
          items={[
            { id: 'cbg', label: 'Per kelompok INA-CBG' },
            { id: 'dpjp', label: 'Per DPJP' },
          ]}
          value={by}
          onChange={(v) => setBy(v as 'cbg' | 'dpjp')}
        />
        <span className="text-caption text-ink-500">{board.period}</span>
      </div>
      <div className="flex flex-wrap items-start gap-4">
        <section
          aria-label="Margin kasus"
          className="flex min-w-0 flex-[999_1_560px] flex-col overflow-hidden rounded-card border border-line bg-white"
        >
          <div className="overflow-x-auto">
            <table className="w-full min-w-[620px] border-collapse text-[13px]">
              <thead>
                <tr className="bg-[#F8FAFB] text-left text-caption text-ink-500">
                  <th scope="col" className="px-4 py-2 font-semibold">
                    {by === 'cbg' ? 'Kelompok INA-CBG' : 'DPJP'}
                  </th>
                  <th scope="col" className="py-2 pr-3 text-right font-semibold">
                    Kasus
                  </th>
                  <th scope="col" className="py-2 pr-3 text-right font-semibold">
                    Pendapatan
                  </th>
                  <th scope="col" className="py-2 pr-3 text-right font-semibold">
                    Biaya
                  </th>
                  <th scope="col" className="py-2 pr-4 text-right font-semibold">
                    Margin
                  </th>
                </tr>
              </thead>
              <tbody>
                {rows.map((r) => (
                  <tr key={r.key} className="border-t border-line">
                    <td className="px-4 py-1.5">
                      <span className="flex flex-col">
                        <span className="font-semibold">{r.label}</span>
                        <span className="text-caption text-ink-500">{r.sub}</span>
                      </span>
                    </td>
                    <td className="py-1.5 pr-3 text-right font-mono whitespace-nowrap">{r.cases}</td>
                    <td className="py-1.5 pr-3 text-right font-mono whitespace-nowrap">
                      {formatRupiahRingkas(r.revenue)}
                    </td>
                    <td className="py-1.5 pr-3 text-right font-mono whitespace-nowrap">
                      {formatRupiahRingkas(r.cost)}
                    </td>
                    <td
                      className={cx(
                        'py-1.5 pr-4 text-right font-mono font-semibold',
                        r.margin < 0n ? 'text-danger' : 'text-success',
                      )}
                    >
                      {r.margin < 0n ? '▼ ' : '▲ '}
                      {formatRupiahRingkas(r.margin)}
                      <span className="block text-caption font-normal">
                        {r.marginPct} · {signed(r.perCase)}/kasus
                      </span>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <div className="flex flex-col gap-1.5 border-t border-line px-4 py-3">
            <span className="text-small font-semibold">
              Rincian per kasus (pilih untuk melihat komposisi biaya)
            </span>
            <div role="group" aria-label="Pilih kasus" className="flex flex-wrap gap-1.5">
              {board.cases.map((c) => (
                <button
                  key={c.id}
                  type="button"
                  aria-pressed={c.id === k?.id}
                  onClick={() => {
                    setSel(c.id);
                    setReviewing(false);
                  }}
                  className={cx(
                    'min-h-11 cursor-pointer rounded-full border px-3 text-small font-[inherit]',
                    c.id === k?.id
                      ? 'border-brand-600 bg-brand-50 font-semibold text-brand-700'
                      : 'border-line-strong bg-white text-ink-700',
                  )}
                >
                  {c.cbg.code} · {c.dpjp.split(',')[0]}
                </button>
              ))}
            </div>
          </div>
        </section>
        {k && (
          <CaseDetail
            k={k}
            drivers={board.drivers}
            reviewing={reviewing}
            sentAt={
              reviews[k.id] ? `${formatJam(reviews[k.id]?.at ?? '')} oleh ${reviews[k.id]?.by ?? ''}` : null
            }
            onReview={() => setReviewing(true)}
            onCancel={() => setReviewing(false)}
            onSend={(note) =>
              dispatch({ type: 'telaah.dikirim', caseId: k.id, note }, (ok) => {
                if (!ok) return;
                setReviewing(false);
                setFlash(`Telaah clinical pathway ${k.cbg.code} (${k.dpjp}) dikirim ke komite medik`);
              })
            }
          />
        )}
      </div>
    </div>
  );
}

function CaseDetail({
  k,
  drivers,
  reviewing,
  sentAt,
  onReview,
  onCancel,
  onSend,
}: {
  k: KasusCosting;
  drivers: readonly string[];
  reviewing: boolean;
  sentAt: string | null;
  onReview: () => void;
  onCancel: () => void;
  onSend: (note: string) => void;
}) {
  const cost = unitCost(k);
  const margin = k.tariff - cost;
  const shares = costShares(k);
  const v = losVariance(k);
  return (
    <aside
      aria-label="Komposisi biaya kasus"
      className="flex min-w-0 flex-[1_1_340px] flex-col gap-3 rounded-card border border-line bg-white p-4 xl:max-w-[440px]"
    >
      <span className="flex flex-col">
        <span className="font-semibold">
          {k.cbg.code} · {k.cbg.name}
        </span>
        <span className="text-caption text-ink-500">
          {k.cbg.classLabel} · {k.dpjp} · {k.cases} kasus
        </span>
      </span>
      <dl className="m-0 grid grid-cols-3 gap-2 text-small">
        <div className="flex flex-col">
          <dt className="text-caption text-ink-500">Biaya/kasus</dt>
          <dd className="m-0 font-mono font-semibold">{formatRupiah(cost)}</dd>
        </div>
        <div className="flex flex-col">
          <dt className="text-caption text-ink-500">INA-CBG</dt>
          <dd className="m-0 font-mono font-semibold">{formatRupiah(k.tariff)}</dd>
        </div>
        <div className="flex flex-col">
          <dt className="text-caption text-ink-500">Margin/kasus</dt>
          <dd
            className={cx('m-0 font-mono font-semibold', margin < 0n ? 'text-danger' : 'text-success')}
            data-margin={margin.toString()}
          >
            {signed(margin)}
          </dd>
        </div>
      </dl>
      <div className="flex h-3 overflow-hidden rounded-full" aria-hidden="true">
        {shares.map((s, i) => (
          <span key={s.id} className={BAR[i]} style={{ width: `${s.pct}%` }} />
        ))}
      </div>
      <ul className="m-0 flex list-none flex-col gap-1 p-0 text-small">
        {shares.map((s, i) => (
          <li key={s.id} className="flex items-center justify-between gap-2">
            <span className="flex items-center gap-2">
              <span aria-hidden="true" className={cx('size-3 rounded-sm', BAR[i])} />
              {s.label}
            </span>
            <span className="font-mono">
              {formatRupiah(s.amount)} · {s.pct}%
            </span>
          </li>
        ))}
      </ul>
      {k.pathwayTenths > 0 && (
        <div
          className={cx(
            'rounded-control border px-3 py-2 text-small',
            v ? 'border-warning-border bg-[#FFFAF2]' : 'border-[#B7DEC0] bg-[#F2FAF4]',
          )}
        >
          {v ? (
            <>
              <span className="font-semibold text-warning">! {v.text}</span>
              <span className="block text-ink-700">
                Kelebihan {hari(v.extraTenths)} ≈ {formatRupiah(v.avoidablePerCase)} biaya akomodasi per kasus
                yang bisa dihindari.
              </span>
            </>
          ) : (
            <span className="text-success">
              ✓ Lama rawat {hari(k.losTenths)} sesuai clinical pathway ({hari(k.pathwayTenths)})
            </span>
          )}
        </div>
      )}
      {sentAt ? (
        <Chip tone="info">Telaah dikirim ke komite medik {sentAt}</Chip>
      ) : reviewing ? (
        <AlasanForm
          label="Catatan telaah untuk komite medik (wajib)"
          submitLabel="Kirim ke komite medik"
          min={TELAAH_REASON_MIN}
          placeholder="mis. LOS di atas pathway; tinjau kriteria pulang dan switch antibiotik oral"
          onCancel={onCancel}
          onSubmit={onSend}
        />
      ) : (
        <span>
          <Button onClick={onReview}>Ajukan telaah clinical pathway…</Button>
        </span>
      )}
      <details className="text-caption text-ink-500">
        <summary className="min-h-11 cursor-pointer font-semibold text-brand-700">
          Dasar alokasi overhead
        </summary>
        <ul className="m-0 mt-1 flex flex-col gap-0.5 pl-4">
          {drivers.map((d) => (
            <li key={d}>{d}</li>
          ))}
        </ul>
      </details>
    </aside>
  );
}
