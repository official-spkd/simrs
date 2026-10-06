'use client';

import { type FinancingOverview, formatRupiah, type ReceivableBatch } from '@simrs/shared';
import { Alert, Button, Chip, type ChipTone, cx } from '@simrs/ui';
import { GatedButton } from '@/components/gated-button';
import type { FinancingState } from '@/app/(staf)/keuangan/pembiayaan/use-financing-state';
import { advanceAmount, formatRingkas } from '@/lib/btn-pembiayaan';

const BASE: Record<ReceivableBatch['status'], [string, ChipTone]> = {
  layak: ['Layak bayar', 'success'],
  pending: ['Pending', 'warning'],
  dispute: ['Dispute', 'danger'],
};

/** Pool klaim BPJS: pilih batch layak bayar → advance 90% (dibatasi sisa plafon) → ajukan pencairan ke BTN. */
export function PiutangPool({ data, s }: { data: FinancingOverview; s: FinancingState }) {
  const rate = data.facility.advanceRatePercent;
  const freeIds = new Set(s.free.map((b) => b.id));
  const allPicked = s.free.length > 0 && s.free.every((b) => s.selected[b.id]);
  const reason = s.inProcess
    ? `Selesaikan pengajuan ${s.inProcess.id} dulu.`
    : s.picked.length === 0
      ? 'Pilih minimal satu batch layak bayar.'
      : s.position.available <= 0n
        ? 'Plafon fasilitas sudah terpakai penuh.'
        : '';
  const a = s.active;
  const at: { aju?: string; ok?: string; cair?: string } = a ? s.stampsOf(a.id) : {};
  const steps = a
    ? [
        { t: 'Diajukan ke BTN', done: true, at: at.aju },
        { t: 'Disetujui BTN', done: a.stage !== 'diajukan', at: at.ok },
        {
          t: `Dana cair ke ${data.facility.operationalAccount}`,
          done: a.stage === 'cair' || a.stage === 'lunas',
          at: at.cair,
        },
      ]
    : [];
  const nextStep = steps.findIndex((st) => !st.done);
  const GRID =
    'grid grid-cols-[44px_minmax(0,1fr)_auto] items-center gap-x-2 gap-y-1 @2xl:grid-cols-[44px_minmax(0,1.5fr)_64px_minmax(0,1fr)_minmax(0,1.2fr)_minmax(0,1fr)]';
  return (
    <section
      aria-label="Pool klaim BPJS"
      className="@container flex min-w-0 flex-col gap-3 rounded-card border border-white/95 bg-white/90 shadow-card p-4"
    >
      <div className="flex flex-wrap items-start justify-between gap-2">
        <span className="flex min-w-0 flex-col">
          <span className="font-semibold">Pool klaim BPJS</span>
          <span className="text-caption text-ink-500">
            Hanya batch berstatus layak bayar (BA verifikasi BPJS terbit) yang bisa dijaminkan
          </span>
        </span>
        <Button
          size="sm"
          className="min-h-11"
          disabled={s.free.length === 0}
          onClick={() => s.selectAll(!allPicked)}
        >
          {allPicked ? 'Kosongkan pilihan' : 'Pilih semua layak bayar'}
        </Button>
      </div>
      <div
        aria-hidden="true"
        className={cx(
          GRID,
          'hidden border-b border-line bg-subtle py-1.5 text-caption font-semibold text-ink-500 @2xl:grid',
        )}
      >
        <span />
        <span>Bulan pelayanan · jenis</span>
        <span className="text-right">Berkas</span>
        <span className="text-right">Nilai klaim</span>
        <span>Status</span>
        <span className="text-right">Advance {rate}%</span>
      </div>
      <ul className="m-0 flex list-none flex-col p-0">
        {data.pool.map((b) => {
          const draw = s.draws.find((d) => d.batchIds.includes(b.id));
          const can = freeIds.has(b.id);
          const chk = can && !!s.selected[b.id];
          let chip: [string, ChipTone] = BASE[b.status];
          if (draw?.stage === 'lunas') chip = ['Dibayar BPJS · lunas', 'neutral'];
          else if (draw?.stage === 'cair') chip = [`Dibiayai · ${draw.id}`, 'brand'];
          else if (draw) chip = [`Diajukan · ${draw.id}`, 'info'];
          return (
            <li key={b.id} className={cx(GRID, 'border-b border-line py-1.5', chk && 'bg-brand-50')}>
              {can ? (
                // Seluruh sel 44 × 44 px menjadi target sentuh kotak centang.
                <label className="flex size-11 cursor-pointer items-center justify-center">
                  <input
                    type="checkbox"
                    className="size-5 cursor-pointer accent-brand-600"
                    checked={chk}
                    onChange={() => s.toggle(b.id)}
                    aria-label={`Pilih klaim ${b.period} ${b.kind} untuk dijaminkan`}
                  />
                </label>
              ) : (
                <span
                  aria-hidden="true"
                  className="m-auto size-5 rounded-[5px] border border-dashed border-line-strong"
                />
              )}
              <span className="flex min-w-0 flex-col">
                <span className="font-semibold">
                  {b.period} · {b.kind}
                </span>
                <span className="text-caption text-ink-500">{b.note}</span>
              </span>
              <span className="text-right font-mono text-small text-ink-700 @max-2xl:hidden">
                {b.files.toLocaleString('id-ID')}
                <span className="sr-only"> berkas</span>
              </span>
              <span className="text-right font-mono whitespace-nowrap">
                {formatRingkas(BigInt(b.amount))}
              </span>
              <span className="col-start-2 @2xl:col-start-auto">
                <Chip tone={chip[1]}>{chip[0]}</Chip>
              </span>
              <span
                className={cx(
                  'text-right font-mono text-small whitespace-nowrap',
                  chk ? 'text-brand-700' : 'text-ink-500',
                )}
              >
                {can ? (
                  <>
                    <span className="@2xl:sr-only">adv. </span>
                    {formatRingkas(advanceAmount(BigInt(b.amount), rate))}
                  </>
                ) : (
                  '—'
                )}
              </span>
            </li>
          );
        })}
      </ul>
      <div className="flex flex-col gap-2 rounded-[12px] border border-line bg-subtle p-3">
        <span className="flex flex-wrap gap-x-4 gap-y-1 text-small">
          <span>
            Terpilih <b>{s.picked.length} batch</b> · nilai klaim{' '}
            <span className="font-mono">{formatRupiah(s.quote.claims)}</span>
          </span>
          <span>
            × advance rate {rate}% = <span className="font-mono">{formatRupiah(s.quote.advance)}</span>
          </span>
          <span>
            Sisa plafon <span className="font-mono">{formatRupiah(s.position.available)}</span>
          </span>
        </span>
        {s.quote.cappedByLimit && (
          <Alert level="warning">
            Advance {rate}% ({formatRingkas(s.quote.advance)}) melebihi sisa plafon{' '}
            {formatRingkas(s.position.available)}. Nilai pencairan dibatasi ke sisa plafon; kurangi pilihan
            agar klaim tidak terikat berlebih.
          </Alert>
        )}
        <div className="flex flex-wrap items-center justify-between gap-3">
          <span className="flex flex-col">
            <span className="text-caption text-ink-500">
              Nilai pencairan ke rekening operasional {data.facility.operationalAccount}
            </span>
            <span className="font-mono text-h2 font-bold">{formatRupiah(s.quote.disburse)}</span>
          </span>
          <span className="flex flex-col items-end gap-1">
            <GatedButton
              variant="primary"
              enabled={!reason && !s.pending}
              reason={reason}
              onClick={s.submitDrawdown}
            >
              Ajukan pencairan
            </GatedButton>
          </span>
        </div>
        {a && a.stage !== 'lunas' && (
          <div
            role="status"
            className="flex flex-col gap-2 rounded-control border border-samudra-100 bg-white p-3"
          >
            <span className="font-semibold">
              Pengajuan {a.id} · <span className="font-mono">{formatRupiah(BigInt(a.principal))}</span>
              <span className="font-normal text-ink-500">
                {' '}
                · dasar: {s.basisOf(a)} · {formatRingkas(s.basisTotalOf(a))}
              </span>
            </span>
            <ol className="m-0 grid list-none grid-cols-1 gap-2 p-0 sm:grid-cols-3">
              {steps.map((st, i) => (
                <li
                  key={st.t}
                  aria-current={i === nextStep ? 'step' : undefined}
                  className={cx(
                    'flex items-center gap-1.5 rounded-control border px-2.5 py-2 text-small',
                    st.done
                      ? 'border-line bg-white text-ink-900'
                      : i === nextStep
                        ? 'border-samudra-300 bg-samudra-50 text-info'
                        : 'border-line bg-white text-ink-500',
                  )}
                >
                  <span
                    aria-hidden="true"
                    className={cx(
                      'flex size-6 items-center justify-center rounded-full text-caption font-bold',
                      st.done ? 'bg-success text-white' : 'bg-muted',
                    )}
                  >
                    {st.done ? '✓' : i + 1}
                  </span>
                  <span className="flex min-w-0 flex-col">
                    <span>{st.t}</span>
                    <span className="text-caption text-ink-500">
                      {st.done ? (st.at ? `pukul ${st.at}` : 'selesai') : i === nextStep ? 'menunggu' : '—'}
                    </span>
                  </span>
                </li>
              ))}
            </ol>
            {a.stage === 'cair' ? (
              <span className="text-small font-semibold text-success">
                {formatRupiah(BigInt(a.principal))} masuk rekening operasional{' '}
                {data.facility.operationalAccount}
                {at.cair ? ` pukul ${at.cair}` : ''}. Outstanding dan sisa plafon diperbarui.
              </span>
            ) : (
              <Button
                className="self-start border-dashed border-samudra-300 text-info"
                disabled={s.pending}
                onClick={() => s.advanceDrawdown(a)}
              >
                {a.stage === 'diajukan' ? 'Simulasi: BTN menyetujui' : 'Simulasi: BTN mencairkan dana'}
              </Button>
            )}
          </div>
        )}
      </div>
    </section>
  );
}
