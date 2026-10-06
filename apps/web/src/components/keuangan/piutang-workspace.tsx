'use client';

import { KpiCard, Tabs, cx } from '@simrs/ui';
import { useState } from 'react';
import { type PiutangActionInput, piutangAction } from '@/app/(staf)/keuangan/piutang/actions';
import { useStoreAction } from '@/lib/demo/store/client';
import { formatRupiah } from '@simrs/shared';
import { formatRupiahRingkas } from '@/lib/keuangan';
import { agingView } from '@/lib/keuangan-akuntansi';
import { outstanding } from '@/lib/keuangan-piutang';
import type { PiutangState } from '@/lib/keuangan-piutang-toko';
import type { ReceivablesBoard } from '@/lib/server/data/keuangan-lanjut';
import { PiutangPembagian } from './piutang-pembagian';
import { PiutangPenagihan } from './piutang-penagihan';
import { PiutangPenyesuaian } from './piutang-penyesuaian';

/**
 * U04 · Ruang kerja Penjaminan dan piutang: pembagian penjamin, umur piutang + batch penagihan + pelunasan
 * bereferensi, dan penyesuaian berpersetujuan. Setiap mutasi uang menampilkan jurnal berpasangan dan membentuk jurnal
 * otomatis di Akuntansi. Tersimpan di toko demo (domain `piutang`, ADR-0085) atas nama pengguna sesi.
 */
export function PiutangWorkspace({
  board,
  store,
  rev,
  today,
  viewer,
}: {
  board: ReceivablesBoard;
  /** Piutang, batch, dan penyesuaian setelah aksi tersimpan. */
  store: PiutangState;
  rev: number;
  today: string;
  viewer: { id: string; name: string; role: string | null };
}) {
  const [tab, setTab] = useState('penagihan');
  const [flash, setFlash] = useState<{ text: string; ok: boolean } | null>(null);
  const { items, batches, adjustments } = store;
  const { run } = useStoreAction(rev);
  const act = (input: PiutangActionInput) =>
    run(
      (r) => piutangAction({ ...input, rev: r }),
      (res) => setFlash({ text: res.message, ok: res.ok }),
    );

  const totalAll = board.aging.reduce((s, r) => s + agingView(r).total, 0n);
  const over90 = board.aging.reduce((s, r) => s + (agingView(r).amounts[3] ?? 0n), 0n);
  const unbilled = items.filter((i) => !i.batch && i.payerGroup !== 'umum' && outstanding(i) > 0n);
  const pendingAdj = adjustments.filter((a) => a.status === 'menunggu');

  return (
    <div className="flex flex-col gap-4">
      <div role="region" aria-label="Indikator piutang" className="grid grid-cols-2 gap-3.5 xl:grid-cols-4">
        <KpiCard label="Total piutang" value={formatRupiahRingkas(totalAll)} detail="semua penjamin" />
        <KpiCard
          label="Umur > 90 hari"
          value={formatRupiahRingkas(over90)}
          hint="prioritas penagihan"
          tone="danger"
          tinted
        />
        <KpiCard
          label="Belum ditagih (contoh)"
          value={unbilled.length}
          detail={formatRupiah(unbilled.reduce((s, i) => s + outstanding(i), 0n))}
        />
        <KpiCard
          label="Penyesuaian menunggu"
          value={pendingAdj.length}
          hint={pendingAdj.length ? 'perlu persetujuan manajemen' : 'tidak ada'}
          tone={pendingAdj.length ? 'warning' : 'success'}
          tinted
        />
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
      <Tabs
        label="Penjaminan dan piutang"
        variant="pil"
        value={tab}
        onChange={setTab}
        items={[
          {
            id: 'penagihan',
            label: 'Umur piutang & penagihan',
            content: (
              <div className="pt-3">
                <PiutangPenagihan
                  aging={board.aging}
                  items={items}
                  batches={batches}
                  today={today}
                  onCreateBatch={(ids) => act({ type: 'batch', itemIds: ids, rev: 0 })}
                  onSend={(number) => act({ type: 'kirim', number, rev: 0 })}
                  onPay={(number, amount, reference) =>
                    act({ type: 'bayar', number, amount: amount.toString(), reference, rev: 0 })
                  }
                />
              </div>
            ),
          },
          {
            id: 'pembagian',
            label: 'Pembagian penjamin',
            content: (
              <div className="pt-3">
                <PiutangPembagian examples={board.examples} />
              </div>
            ),
          },
          {
            id: 'penyesuaian',
            label: 'Penyesuaian',
            badge: pendingAdj.length ? String(pendingAdj.length) : undefined,
            content: (
              <div className="pt-3">
                <PiutangPenyesuaian
                  items={items}
                  adjustments={adjustments}
                  viewer={viewer}
                  onSubmit={(a) =>
                    act({
                      type: 'ajukan',
                      itemId: a.itemId,
                      kind: a.kind,
                      amount: a.amount.toString(),
                      reason: a.reason,
                      rev: 0,
                    })
                  }
                  onDecide={(a, approve, reason) =>
                    act({ type: 'putuskan', adjId: a.id, approve, reason, rev: 0 })
                  }
                />
              </div>
            ),
          },
        ]}
      />
    </div>
  );
}
