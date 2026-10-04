'use client';

import { type FinancingOverview, formatRupiah } from '@simrs/shared';
import { Button, cx } from '@simrs/ui';
import { useId } from 'react';
import type { FinancingState } from '@/app/(staf)/keuangan/pembiayaan/use-financing-state';
import { formatWhen } from '@/lib/btn';
import { formatRingkas } from '@/lib/btn-pembiayaan';

function Box({ title, sub, value, active }: { title: string; sub: string; value: string; active: boolean }) {
  return (
    <div
      className={cx(
        'flex flex-col gap-0.5 rounded-control border px-3 py-2',
        active ? 'border-[#9FD3C9] bg-[#F3FAF8]' : 'border-line bg-white',
      )}
    >
      <span className="font-semibold">{title}</span>
      <span className="text-caption text-ink-500">{sub}</span>
      <span className={cx('font-mono text-small', active ? 'text-brand-700' : 'text-ink-500')}>{value}</span>
    </div>
  );
}

/** Alur dana pelunasan: BPJS → penampungan → auto-debit pokok + margin ke BTN, sisa ke operasional RS. */
export function PiutangAside({ data, s }: { data: FinancingOverview; s: FinancingState }) {
  const id = useId();
  const f = data.facility;
  const p = s.lastPay;
  const t = s.target;
  return (
    <aside
      aria-label="Alur dana pelunasan"
      className="flex min-w-0 flex-col gap-3 rounded-card border border-line bg-white p-4"
    >
      <span className="flex justify-between gap-2">
        <span className="font-semibold">Alur dana pelunasan</span>
        <span className="text-caption text-ink-500">
          {p ? 'pembayaran terakhir' : 'belum ada pembayaran'}
        </span>
      </span>
      <div className="flex flex-col gap-1.5">
        <Box
          title="BPJS Kesehatan"
          sub="membayar klaim"
          value={p ? formatRingkas(p.claims) : 'menunggu'}
          active={!!p}
        />
        <span aria-hidden="true" className="text-center text-ink-500">
          ↓
        </span>
        <Box
          title="Rekening penampungan BTN"
          sub={`${f.claimAccount} · escrow klaim BPJS · auto-debit`}
          value={p ? formatRingkas(p.claims) : '—'}
          active={!!p}
        />
        <span aria-hidden="true" className="text-center text-ink-500">
          ↓ ↓
        </span>
        <div className="grid grid-cols-2 gap-1.5">
          <Box
            title="Pelunasan BTN"
            sub="pokok + margin"
            value={p ? formatRingkas(p.principal + p.margin) : 'auto-debit'}
            active={!!p}
          />
          <Box
            title="Sisa ke RS"
            sub={`operasional ${f.operationalAccount}`}
            value={p ? formatRingkas(p.forwarded) : 'diteruskan'}
            active={!!p}
          />
        </div>
      </div>
      <div className="flex flex-col gap-2 border-t border-line pt-3">
        <span className="font-semibold">Simulasi pembayaran BPJS</span>
        <span className="text-small text-ink-700">
          {t
            ? `Pembayaran berikutnya: klaim ${s.basisOf(t)} untuk ${t.id}. Dana masuk ${f.claimAccount}, pokok + margin didebit otomatis, sisanya diteruskan ke ${f.operationalAccount}.`
            : 'Tidak ada pencairan berjalan untuk dilunasi.'}
        </span>
        <Button
          variant="primary"
          disabled={!t || s.pending}
          aria-describedby={`${id}-bayar`}
          onClick={s.payBpjs}
        >
          BPJS membayar klaim
        </Button>
        <span id={`${id}-bayar`} className="text-caption text-ink-500">
          {t ? '' : 'Belum ada pencairan berstatus berjalan.'}
        </span>
        {p && (
          <div
            role="status"
            className="flex flex-col gap-1 rounded-control border border-[#B7DEC0] bg-[#F3FAF8] p-3 text-small"
          >
            <span className="font-semibold">
              Klaim {p.basis} dibayar BPJS · {formatWhen(p.at)}
            </span>
            <span className="flex justify-between gap-2">
              <span>Dana BPJS masuk {f.claimAccount}</span>
              <span className="font-mono font-semibold">{formatRupiah(p.claims)}</span>
            </span>
            <span className="flex justify-between gap-2">
              <span>Pelunasan pokok {p.drawdownId}</span>
              <span className="font-mono">− {formatRupiah(p.principal)}</span>
            </span>
            <span className="flex justify-between gap-2">
              <span>
                Margin {p.days} hari × {f.marginBps / 100}% p.a.{p.assumed ? ' (asumsi)' : ''}
              </span>
              <span className="font-mono">− {formatRupiah(p.margin)}</span>
            </span>
            <span className="flex justify-between gap-2 border-t border-[#B7DEC0] pt-1.5 font-bold">
              <span>Diteruskan ke operasional {f.operationalAccount}</span>
              <span className="font-mono">{formatRupiah(p.forwarded)}</span>
            </span>
          </div>
        )}
      </div>
      <div className="flex flex-col gap-1 border-t border-line pt-3 text-caption text-ink-700">
        <span className="text-small font-semibold text-ink-900">Parameter fasilitas (simulasi)</span>
        <span>• Advance rate {f.advanceRatePercent}% dari klaim layak bayar</span>
        <span>• Margin {f.marginBps / 100}% p.a., dihitung harian sejak cair</span>
        <span>
          • Dana cair ke operasional {f.operationalAccount}; BPJS membayar ke penampungan {f.claimAccount}
        </span>
      </div>
    </aside>
  );
}
