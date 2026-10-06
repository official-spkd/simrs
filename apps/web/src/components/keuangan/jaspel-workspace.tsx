'use client';

import { formatJam, formatRupiah, formatTanggalWaktu } from '@simrs/shared';
import { Alert, Button, Chip, cx, KpiCard, RadioSegmented } from '@simrs/ui';
import { useState } from 'react';
import { type JaspelActionInput, jaspelAction } from '@/app/(staf)/keuangan/jasa-pelayanan/actions';
import { useStoreAction } from '@/lib/demo/store/client';
import { formatRupiahRingkas } from '@/lib/keuangan';
import {
  accrualJournal,
  paymentJournal,
  realizedFee,
  rekap,
  rekapCsv,
  stepProblem,
  TAHAP_JASPEL,
  type TahapJaspel,
} from '@/lib/keuangan-jaspel';
import { tanggalPendek } from '@/lib/keuangan-jurnal';
import type { JaspelState } from '@/lib/keuangan-jaspel-toko';
import type { FeeSharingBoard } from '@/lib/server/data/keuangan-lanjut';
import { JurnalPasangan } from './jurnal-pasangan';

const PAYER = { bpjs: 'BPJS', asuransi: 'Asuransi', umum: 'Umum' } as const;
const NEXT_LABEL: Record<TahapJaspel, string> = {
  dihitung: 'Verifikasi rekap',
  diverifikasi: 'Setujui rekap dan posting akrual',
  disetujui: 'Posting pembayaran jasa',
  dibayar: 'Sudah dibayar',
};

/**
 * U08 · Jasa pelayanan: rekap per PPA dari komponen jasa tarif menurut aturan berversi, realisasi BPJS saat klaim
 * dibayar, tahapan verifikasi → persetujuan (pembuat ≠ penyetuju) → bayar dengan jurnal, dan ekspor CSV aman.
 * Periode tertutup hanya baca. Tahap dan ekspor tersimpan di toko demo (domain `jasa-pelayanan`, ADR-0085).
 */
export function JaspelWorkspace({
  board,
  store,
  rev,
  viewer,
}: {
  board: FeeSharingBoard;
  /** Tahap rekap dan riwayat tersimpan. */
  store: JaspelState;
  rev: number;
  viewer: { id: string; name: string; role: string | null };
}) {
  const [period, setPeriod] = useState('2026-10');
  const [flash, setFlash] = useState<{ text: string; ok: boolean } | null>(null);
  const { stage, log } = store;
  const csv = store.exported ? rekapCsv(rekap(board.items, board.rule)) : null;
  const r = rekap(board.items, board.rule);
  const pools = r.pools.reduce((s, p) => s + p.amount, 0n);
  const sep = board.september;
  const problem = stepProblem(stage, viewer, log.diverifikasi?.by ?? null, log.diverifikasi?.byId ?? null);
  const { run, pending } = useStoreAction(rev);
  const act = (input: JaspelActionInput) =>
    run(
      (rv) => jaspelAction({ ...input, rev: rv }),
      (res) => setFlash({ text: res.message, ok: res.ok }),
    );
  const stageIdx = TAHAP_JASPEL.findIndex((x) => x.id === stage);
  const advance = () => {
    if (!problem) act({ type: 'maju', rev: 0 });
  };

  return (
    <div className="flex flex-col gap-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <RadioSegmented
          label="Periode jasa"
          items={[
            { id: '2026-10', label: 'Oktober 2026 · berjalan' },
            { id: '2026-09', label: 'September 2026 · ditutup' },
          ]}
          value={period}
          onChange={setPeriod}
        />
        <span className="text-caption text-ink-500">
          Aturan {board.rule.version} · berlaku {tanggalPendek(board.rule.validFrom)}
        </span>
      </div>
      {flash && (
        <div
          role="status"
          className={cx(
            'rounded-control border px-3 py-2 text-small',
            flash.ok
              ? 'border-zamrud-200 bg-zamrud-50 text-success'
              : 'border-danger-border bg-danger-bg text-danger',
          )}
        >
          {flash.ok ? '✓ ' : ''}
          {flash.text}
        </div>
      )}

      {period === '2026-09' ? (
        <section
          aria-label="Rekap September"
          className="flex flex-col gap-3 rounded-card border border-line bg-white p-4"
        >
          <Alert level="info" title="Periode ditutup">
            Rekap jasa {sep.period} dibayar {formatTanggalWaktu(sep.paidAt)} dan periodenya sudah ditutup.
            Rekap tidak bisa dihitung ulang; koreksi masuk sebagai penyesuaian di periode berjalan.
          </Alert>
          <dl className="m-0 grid grid-cols-2 gap-3 md:grid-cols-4">
            {(
              [
                ['Bruto', formatRupiah(sep.gross)],
                ['PPh 21', formatRupiah(sep.pph)],
                ['Neto dibayar', formatRupiah(sep.gross - sep.pph)],
                ['PPA', `${sep.ppaCount} orang`],
              ] as const
            ).map(([k, v]) => (
              <div key={k} className="flex flex-col">
                <dt className="text-caption text-ink-500">{k}</dt>
                <dd className="m-0 font-mono font-semibold">{v}</dd>
              </div>
            ))}
          </dl>
          <span className="flex flex-wrap items-center gap-2">
            <Button disabled aria-describedby="sep-lock">
              Hitung ulang
            </Button>
            <span id="sep-lock" className="text-caption font-medium text-ink-500">
              Terkunci: periode September 2026 ditutup.
            </span>
          </span>
        </section>
      ) : (
        <>
          <div role="region" aria-label="Indikator jasa" className="grid grid-cols-2 gap-3.5 xl:grid-cols-4">
            <KpiCard
              label="Jasa terealisasi"
              value={formatRupiahRingkas(r.realized)}
              detail="1–5 Okt · contoh tindakan"
            />
            <KpiCard
              label="Bruto PPA"
              value={formatRupiahRingkas(r.totalGross)}
              detail={`${r.rows.length} PPA`}
            />
            <KpiCard
              label="Ditahan (klaim BPJS belum dibayar)"
              value={formatRupiahRingkas(r.held)}
              hint="direalisasikan saat klaim dibayar"
              tone="warning"
              tinted
            />
            <KpiCard
              label="Pos kebersamaan + manajemen"
              value={formatRupiahRingkas(pools)}
              detail="dibagi per aturan unit"
            />
          </div>

          <ol aria-label="Tahapan rekap" className="m-0 flex list-none flex-wrap gap-2 p-0">
            {TAHAP_JASPEL.map((s, i) => {
              const at = i === 0 ? null : log[s.id];
              const doneStep = i <= stageIdx;
              return (
                <li
                  key={s.id}
                  aria-current={i === stageIdx ? 'step' : undefined}
                  className={cx(
                    'flex min-w-0 flex-[1_1_150px] flex-col rounded-control border px-3 py-2 text-small',
                    doneStep ? 'border-zamrud-200 bg-zamrud-50' : 'border-line bg-white',
                  )}
                >
                  <span className="font-semibold">
                    {doneStep ? '✓ ' : `${i + 1}. `}
                    {s.label}
                  </span>
                  <span className="text-caption text-ink-500">
                    {i === 0
                      ? 'otomatis dari tagihan final'
                      : at
                        ? `${at.by} · ${formatJam(at.at)}`
                        : 'belum'}
                  </span>
                </li>
              );
            })}
          </ol>

          <div className="flex flex-wrap items-start gap-4">
            <section
              aria-label="Rekap per PPA"
              className="flex min-w-0 flex-[999_1_520px] flex-col overflow-hidden rounded-card border border-line bg-white"
            >
              <div className="border-b border-line px-4 py-3">
                <span className="font-semibold">Rekap per PPA · Oktober 2026 (berjalan)</span>
              </div>
              <div className="overflow-x-auto">
                <table className="w-full min-w-[560px] border-collapse text-[13px]">
                  <thead>
                    <tr className="bg-subtle text-left text-caption text-ink-500">
                      <th scope="col" className="px-4 py-2 font-semibold">
                        PPA
                      </th>
                      <th scope="col" className="py-2 pr-3 text-right font-semibold">
                        Tindakan
                      </th>
                      <th scope="col" className="py-2 pr-3 text-right font-semibold">
                        Bruto
                      </th>
                      <th scope="col" className="py-2 pr-3 text-right font-semibold">
                        PPh 21
                      </th>
                      <th scope="col" className="py-2 pr-4 text-right font-semibold">
                        Neto
                      </th>
                    </tr>
                  </thead>
                  <tbody>
                    {r.rows.map((x) => (
                      <tr key={x.name} className="border-t border-line">
                        <td className="px-4 py-1.5">{x.name}</td>
                        <td className="py-1.5 pr-3 text-right font-mono">{x.count}</td>
                        <td className="py-1.5 pr-3 text-right font-mono">{formatRupiah(x.gross)}</td>
                        <td className="py-1.5 pr-3 text-right font-mono">{formatRupiah(x.pph)}</td>
                        <td className="py-1.5 pr-4 text-right font-mono font-semibold">
                          {formatRupiah(x.net)}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                  <tfoot>
                    <tr className="border-t border-line-strong font-semibold">
                      <th scope="row" colSpan={2} className="px-4 py-1.5 text-left">
                        Total PPA
                      </th>
                      <td
                        className="py-1.5 pr-3 text-right font-mono"
                        data-total-gross={r.totalGross.toString()}
                      >
                        {formatRupiah(r.totalGross)}
                      </td>
                      <td className="py-1.5 pr-3 text-right font-mono">{formatRupiah(r.totalPph)}</td>
                      <td className="py-1.5 pr-4 text-right font-mono">
                        {formatRupiah(r.totalGross - r.totalPph)}
                      </td>
                    </tr>
                    {r.pools.map((p) => (
                      <tr key={p.id} className="text-ink-700">
                        <th scope="row" colSpan={2} className="px-4 py-1 text-left font-normal">
                          {p.label}
                        </th>
                        <td className="py-1 pr-3 text-right font-mono">{formatRupiah(p.amount)}</td>
                        <td colSpan={2} />
                      </tr>
                    ))}
                  </tfoot>
                </table>
              </div>
              <details className="border-t border-line px-4 py-3 text-small">
                <summary className="min-h-11 cursor-pointer font-semibold text-brand-700">
                  Rincian {board.items.length} tindakan sumber
                </summary>
                <ul className="m-0 mt-2 flex list-none flex-col gap-1.5 p-0">
                  {board.items.map((t) => {
                    const real = realizedFee(t);
                    return (
                      <li
                        key={t.id}
                        className="flex flex-wrap justify-between gap-2 border-t border-line pt-1.5"
                      >
                        <span className="flex min-w-0 flex-col">
                          <span>
                            {t.service} · {t.patient}
                          </span>
                          <span className="text-caption text-ink-500">
                            {tanggalPendek(t.date)} · {PAYER[t.payer]} · pelaksana {t.ppa}
                            {t.claim ? ` · ${t.claim.number}` : ''}
                          </span>
                        </span>
                        <span className="flex flex-col items-end">
                          <span className="font-mono">{formatRupiah(t.fee)}</span>
                          {real === 0n ? (
                            <Chip tone="warning">Ditahan</Chip>
                          ) : real < t.fee ? (
                            <span className="text-caption text-ink-500">
                              terealisasi {formatRupiah(real)}
                            </span>
                          ) : (
                            <span className="text-caption text-success">terealisasi penuh</span>
                          )}
                        </span>
                      </li>
                    );
                  })}
                </ul>
              </details>
            </section>

            <aside
              aria-label="Persetujuan dan jurnal"
              className="flex min-w-0 flex-[1_1_340px] flex-col gap-3 xl:max-w-[460px]"
            >
              <section className="flex flex-col gap-2 rounded-card border border-line bg-white p-4 text-small">
                <span className="font-semibold">Aturan pembagian</span>
                <ul className="m-0 flex list-none flex-col gap-1 p-0">
                  {board.rule.shares.map((s) => (
                    <li key={s.id} className="flex justify-between gap-2">
                      <span className="text-ink-700">{s.label}</span>
                      <span className="font-mono">{s.bp / 100}%</span>
                    </li>
                  ))}
                </ul>
                <span className="text-caption text-ink-500">
                  BPJS: direalisasikan saat klaim dibayar, rasio INA-CBG dibayar ÷ tarif RS · PPh 21 simulasi{' '}
                  {board.rule.pphBp / 100}%
                </span>
              </section>
              <section className="flex flex-col gap-2 rounded-card border border-line bg-white p-4">
                {stage !== 'dibayar' && (
                  <span className="flex flex-col gap-1">
                    <Button
                      variant="primary"
                      disabled={!!problem || pending}
                      aria-describedby={problem ? 'jaspel-gate' : undefined}
                      onClick={advance}
                    >
                      {NEXT_LABEL[stage]}
                    </Button>
                    {problem && (
                      <span id="jaspel-gate" className="text-caption font-medium text-warning">
                        {problem}
                      </span>
                    )}
                  </span>
                )}
                {(stage === 'disetujui' || stage === 'dibayar') && (
                  <Button disabled={pending} onClick={() => act({ type: 'ekspor', rev: 0 })}>
                    Ekspor CSV
                  </Button>
                )}
                {csv && (
                  <pre
                    aria-label="Pratinjau CSV"
                    className="m-0 max-h-40 overflow-auto rounded-control bg-subtle p-2 text-[11.5px]"
                  >
                    {csv}
                  </pre>
                )}
                <JurnalPasangan
                  jurnal={accrualJournal(r, 'Oktober 2026')}
                  status={
                    log.disetujui ? `terposting ${formatJam(log.disetujui.at)}` : 'diposting saat disetujui'
                  }
                />
                <JurnalPasangan
                  jurnal={paymentJournal(r, 'Oktober 2026')}
                  status={log.dibayar ? `terposting ${formatJam(log.dibayar.at)}` : 'diposting saat dibayar'}
                />
              </section>
            </aside>
          </div>
        </>
      )}
    </div>
  );
}
