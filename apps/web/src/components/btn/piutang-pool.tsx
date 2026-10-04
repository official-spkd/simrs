'use client';

import { type FinancingOverview, formatRupiah, type ReceivableBatch } from '@simrs/shared';
import { Alert, Button, Chip, type ChipTone, cx } from '@simrs/ui';
import { useId } from 'react';
import type { FinancingState } from '@/app/(staf)/keuangan/pembiayaan/use-financing-state';
import { advanceAmount, formatRingkas } from '@/lib/btn-pembiayaan';

const BASE: Record<ReceivableBatch['status'], [string, ChipTone]> = {
  layak: ['Layak bayar', 'success'],
  pending: ['Pending', 'warning'],
  dispute: ['Dispute', 'danger'],
};

/** Pool klaim BPJS: pilih batch layak bayar → advance 90% (dibatasi sisa plafon) → ajukan pencairan ke BTN. */
export function PiutangPool({ data, s }: { data: FinancingOverview; s: FinancingState }) {
  const id = useId();
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
  const steps = a
    ? [
        { t: 'Diajukan ke BTN', done: true },
        { t: 'Disetujui BTN', done: a.stage !== 'diajukan' },
        {
          t: `Dana cair ke ${data.facility.operationalAccount}`,
          done: a.stage === 'cair' || a.stage === 'lunas',
        },
      ]
    : [];
  return (
    <section
      aria-label="Pool klaim BPJS"
      className="flex min-w-0 flex-col gap-3 rounded-card border border-line bg-white p-4"
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
            <li
              key={b.id}
              className={cx(
                'grid grid-cols-[44px_minmax(0,1fr)_auto] items-center gap-x-2 gap-y-1 border-b border-line py-1.5 md:grid-cols-[44px_minmax(0,1.5fr)_64px_minmax(0,1fr)_minmax(0,1.2fr)_minmax(0,1fr)]',
                chk && 'bg-[#F3FAF8]',
              )}
            >
              <span className="flex size-11 items-center justify-center">
                {can && (
                  <input
                    type="checkbox"
                    className="size-5 accent-brand-600"
                    checked={chk}
                    onChange={() => s.toggle(b.id)}
                    aria-label={`Pilih klaim ${b.period} ${b.kind} untuk dijaminkan`}
                  />
                )}
              </span>
              <span className="flex min-w-0 flex-col">
                <span className="font-semibold">
                  {b.period} · {b.kind}
                </span>
                <span className="text-caption text-ink-500">{b.note}</span>
              </span>
              <span className="text-right font-mono text-small text-ink-700 max-md:hidden">
                {b.files.toLocaleString('id-ID')}
              </span>
              <span className="text-right font-mono">{formatRingkas(BigInt(b.amount))}</span>
              <span className="col-start-2 md:col-start-auto">
                <Chip tone={chip[1]}>{chip[0]}</Chip>
              </span>
              <span
                className={cx('text-right font-mono text-small', chk ? 'text-brand-700' : 'text-ink-500')}
              >
                {can ? `adv. ${formatRingkas(advanceAmount(BigInt(b.amount), rate))}` : '—'}
              </span>
            </li>
          );
        })}
      </ul>
      <div className="flex flex-col gap-2 rounded-[12px] border border-line bg-[#F8FAFB] p-3">
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
          <span className="flex flex-wrap items-center gap-2">
            <span id={`${id}-alasan`} className="text-caption text-ink-700">
              {reason}
            </span>
            <Button
              variant="primary"
              disabled={!!reason || s.pending}
              aria-describedby={`${id}-alasan`}
              onClick={s.submitDrawdown}
            >
              Ajukan pencairan
            </Button>
          </span>
        </div>
        {a && a.stage !== 'lunas' && (
          <div
            role="status"
            className="flex flex-col gap-2 rounded-control border border-[#C9DDF7] bg-white p-3"
          >
            <span className="font-semibold">
              Pengajuan {a.id} · <span className="font-mono">{formatRupiah(BigInt(a.principal))}</span>
              <span className="font-normal text-ink-500"> · dasar: {s.basisOf(a)}</span>
            </span>
            <ol className="m-0 flex list-none flex-wrap gap-2 p-0">
              {steps.map((st, i) => (
                <li
                  key={st.t}
                  className={cx(
                    'flex items-center gap-1.5 text-small',
                    st.done ? 'text-ink-900' : 'text-ink-500',
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
                  {st.t}
                  <span className="sr-only">{st.done ? ' (selesai)' : ' (menunggu)'}</span>
                </li>
              ))}
            </ol>
            {a.stage === 'cair' ? (
              <span className="text-small font-semibold text-success">
                {formatRupiah(BigInt(a.principal))} masuk rekening operasional{' '}
                {data.facility.operationalAccount}. Outstanding dan sisa plafon diperbarui.
              </span>
            ) : (
              <Button className="self-start" disabled={s.pending} onClick={() => s.advanceDrawdown(a)}>
                {a.stage === 'diajukan' ? 'Simulasi: BTN menyetujui' : 'Simulasi: BTN mencairkan dana'}
              </Button>
            )}
          </div>
        )}
      </div>
    </section>
  );
}
