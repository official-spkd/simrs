'use client';

import { formatRupiah, type LogisticsOverview, type PurchaseOrderDraft } from '@simrs/shared';
import { Alert, Button, cx, FilterChip } from '@simrs/ui';
import { type ReactNode, useState } from 'react';
import { GatedButton } from '@/components/gated-button';
import { ExpiryPanel } from '@/components/manajemen/expiry-panel';
import { GoodsReceiptPanel } from '@/components/manajemen/goods-receipt-panel';
import { PoDraftPanel } from '@/components/manajemen/po-draft-panel';
import { ProcurementList } from '@/components/manajemen/procurement-list';
import { ReorderRow } from '@/components/manajemen/reorder-row';
import { STALE_TEXT } from '@/components/backoffice/use-toko';
import { demoStamp } from '@/lib/backoffice-toko';
import { useStoreAction } from '@/lib/demo/store/client';
import type { ReceiptLine } from '@/lib/logistik-terima';
import type { PoView } from '@/lib/logistik-toko';
import { buildPoDraft, needsReorder } from '@/lib/manajemen';
import {
  expiryAction,
  type LogisticsActionResult,
  poStepAction,
  receiveGoodsAction,
  submitPoAction,
} from './actions';

type ClassFilter = 'semua' | 'A' | 'V';
const FILTERS: Array<{ id: ClassFilter; label: string }> = [
  { id: 'semua', label: 'Semua kelas' },
  { id: 'A', label: 'ABC-A' },
  { id: 'V', label: 'VEN-V' },
];

/**
 * B01 · Stok perlu tindakan → draf usulan PO → ajukan → setujui (Manajemen, pengusul ≠ penyetuju) → terbit PO →
 * dikirim → penerimaan barang (stok bertambah, kejadian ke Hutang usaha), kedaluwarsa FEFO (mockup Logistik). Semua
 * aksi tersimpan di toko demo (domain `logistik`, ADR-0085); "Buat usulan PO" nonaktif beralasan sampai ada item
 * tercentang.
 */
export function LogisticsBoard({
  data,
  today,
  canApprove,
  viewerId,
  rev,
  orders,
  expiryDone,
  receiptLines,
  suppliers,
  openPo,
  heading,
  kpis,
  banner,
}: {
  /** Judul halaman; tombol Stok opname dan Buat usulan PO tampil sebaris di kanannya (mockup Logistik). */
  heading?: ReactNode;
  kpis?: ReactNode;
  banner?: ReactNode;
  /** Item yang sudah masuk PO terbuka (id item -> nomor PO): terkunci agar tidak dipesan ganda. */
  openPo: Record<string, string>;
  data: LogisticsOverview;
  today: string;
  canApprove: boolean;
  viewerId: string;
  /** Revisi domain toko `logistik` yang dilihat layar ini. */
  rev: number;
  orders: readonly PoView[];
  /** Teks tindakan kedaluwarsa tersimpan per batch. */
  expiryDone: Record<string, string>;
  /** Baris PO yang bisa diterima (menambah stok dan utang penerimaan). */
  receiptLines: Record<string, readonly ReceiptLine[]>;
  suppliers: Record<string, string>;
}) {
  const [cls, setCls] = useState<ClassFilter>('semua');
  // Mockup: semua item yang bisa diusulkan sudah tercentang saat layar dibuka (kecuali yang sudah ada di PO terbuka).
  const [unpicked, setUnpicked] = useState<Set<string>>(() => new Set());
  const [draft, setDraft] = useState<PurchaseOrderDraft | null>(null);
  const [flash, setFlash] = useState<{ ok: boolean; text: string } | null>(null);
  const [opname, setOpname] = useState(false);
  const [receiving, setReceiving] = useState<string | null>(null);
  const { run, pending } = useStoreAction(rev);
  const done = (after?: () => void) => (r: LogisticsActionResult) => {
    setFlash({ ok: r.ok, text: r.stale ? STALE_TEXT : r.message });
    if (r.ok) after?.();
  };
  // Stok sudah termasuk penerimaan barang (toko); item yang tidak lagi di bawah ROP keluar dari daftar.
  const reorder = data.reorder.filter(needsReorder);

  const visible = reorder.filter((i) => cls === 'semua' || (cls === 'A' ? i.abc === 'A' : i.ven === 'V'));
  const pickable = visible.filter((i) => !openPo[i.id]);
  const chosen = pickable.filter((i) => !unpicked.has(i.id));
  const allOn = pickable.length > 0 && chosen.length === pickable.length;
  const reason = draft
    ? 'Selesaikan draf yang terbuka dulu.'
    : chosen.length === 0
      ? 'Centang item dulu untuk membuat usulan.'
      : null;

  const toggle = (id: string) =>
    setUnpicked((cur) => {
      const next = new Set(cur);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  const toggleAll = () =>
    setUnpicked((cur) => {
      const next = new Set(cur);
      for (const i of pickable) {
        if (allOn) next.add(i.id);
        else next.delete(i.id);
      }
      return next;
    });

  const makeDraft = () => {
    setFlash(null);
    setDraft(buildPoDraft(reorder, new Set(chosen.map((i) => i.id)), data.nextPoNumber));
  };
  const submit = () => {
    if (!draft) return;
    const lines = draft.lines.map((l) => ({ itemId: l.itemId, qty: l.qty }));
    run(
      (r) => submitPoAction({ lines, jam: demoStamp().jam, rev: r }),
      done(() => setDraft(null)),
    );
  };
  const step = (po: string, type: 'po.disetujui' | 'po.diterbitkan' | 'po.dikirim') =>
    run((r) => poStepAction({ type, po, jam: demoStamp().jam, rev: r }), done());
  const actExpiry = (id: string, action: 'pindah' | 'retur') =>
    run((r) => expiryAction({ id, action, jam: demoStamp().jam, rev: r }), done());

  const estimate = buildPoDraft(reorder, new Set(chosen.map((i) => i.id)), data.nextPoNumber);
  const critical = reorder.filter((i) => i.daysOfCover < 7);

  return (
    <div className="flex flex-col gap-4">
      <header className="flex flex-wrap items-center justify-between gap-3">
        {heading}
        <span className="flex flex-col items-end gap-1">
          <span className="flex flex-wrap items-center justify-end gap-2">
            {reason && (
              <span id="po-alasan" className="text-caption font-medium text-warning">
                {reason}
              </span>
            )}
            <Button aria-expanded={opname} onClick={() => setOpname((o) => !o)}>
              Stok opname
            </Button>
            <GatedButton
              variant="primary"
              enabled={reason === null}
              aria-describedby={reason ? 'po-alasan' : undefined}
              onClick={makeDraft}
            >
              Buat usulan PO ({chosen.length})
            </GatedButton>
          </span>
          {estimate && (
            <span className="text-caption text-ink-500">
              {chosen.length} item dipilih · estimasi {formatRupiah(BigInt(estimate.total))}
              {critical.length > 0 && ` · ${critical.length} kritis (< 7 hari)`}
            </span>
          )}
        </span>
      </header>
      {kpis}
      {banner}

      {opname && (
        <Alert level="info" title="Stok opname">
          Opname terakhir 30 Sep dengan akurasi {String(data.kpi.opnameAccuracy).replace('.', ',')}%. Opname
          berikutnya 31 Okt (gudang farmasi dan depo); lembar hitung dibuka saat jadwal dimulai.
        </Alert>
      )}
      {receiving && receiptLines[receiving] && (
        <GoodsReceiptPanel
          key={receiving}
          poId={receiving}
          supplier={suppliers[receiving] ?? 'Pemasok'}
          lines={receiptLines[receiving] ?? []}
          today={today}
          pending={pending}
          onCancel={() => setReceiving(null)}
          onConfirm={(inputs, coldChainOk) => {
            const po = receiving;
            run(
              (r) => receiveGoodsAction({ po, inputs, coldChainOk, jam: demoStamp().jam, rev: r }),
              done(() => setReceiving(null)),
            );
          }}
        />
      )}
      {draft && (
        <PoDraftPanel draft={draft} pending={pending} onCancel={() => setDraft(null)} onSubmit={submit} />
      )}

      <div className="flex flex-wrap items-start gap-4">
        <section
          aria-labelledby="rop-judul"
          className="flex min-w-0 flex-[999_1_560px] flex-col overflow-hidden rounded-card border border-white/95 bg-white/90 shadow-card"
        >
          <div className="flex flex-wrap items-center justify-between gap-3 border-b border-line px-4 py-3">
            <span className="flex min-w-0 flex-[1_1_260px] flex-col">
              <h2 id="rop-judul" className="m-0 text-[15px] font-semibold">
                Item di bawah titik pesan ulang
              </h2>
              <span className="text-[12.5px] text-ink-500">
                ROP = pemakaian harian rata-rata 90 hari × lead time + stok pengaman
              </span>
            </span>
            <span className="flex flex-wrap gap-2" role="group" aria-label="Saring kelas">
              {FILTERS.map((f) => (
                <FilterChip key={f.id} selected={cls === f.id} onClick={() => setCls(f.id)}>
                  {f.label}
                </FilterChip>
              ))}
            </span>
          </div>
          {flash && (
            <div
              role="status"
              className={cx(
                'border-b px-4 py-2.5 text-small font-medium',
                flash.ok
                  ? 'border-zamrud-200 bg-zamrud-50 text-success'
                  : 'border-kunyit-200 bg-warning-bg text-warning',
              )}
            >
              {flash.text}
            </div>
          )}
          <div className="grid grid-cols-[44px_minmax(0,1fr)] items-center gap-x-2 border-b border-[rgba(23,32,46,0.08)] pr-4 text-caption font-semibold text-ink-500 xl:grid-cols-[44px_minmax(0,2.2fr)_64px_minmax(0,1fr)_72px_120px_minmax(0,1.7fr)]">
            <label className="flex h-11 w-11 cursor-pointer items-center justify-center has-[:disabled]:cursor-not-allowed">
              <input
                type="checkbox"
                checked={allOn}
                onChange={toggleAll}
                disabled={pickable.length === 0}
                className="h-4 w-4 accent-brand-600"
              />
              <span className="sr-only">Pilih semua item yang tampil untuk usulan PO</span>
            </label>
            <span>Item</span>
            <span className="hidden xl:block">Kelas</span>
            <span className="hidden text-right xl:block">Stok</span>
            <span className="hidden text-right xl:block">ROP</span>
            <span className="hidden text-right xl:block">Cukup</span>
            <span className="hidden xl:block">Usulan</span>
          </div>
          {visible.map((i) => (
            <ReorderRow
              key={i.id}
              item={i}
              checked={!openPo[i.id] && !unpicked.has(i.id)}
              inPo={openPo[i.id] ?? null}
              onToggle={() => toggle(i.id)}
            />
          ))}
          {visible.length === 0 && (
            <p className="m-0 px-4 py-4 text-small text-ink-500">
              Tidak ada item kelas ini di bawah titik pesan ulang.
            </p>
          )}
        </section>
        <aside
          aria-label="Kedaluwarsa dan pengadaan"
          className="flex min-w-0 flex-[1_1_320px] flex-col gap-4 xl:max-w-[400px]"
        >
          <ExpiryPanel
            items={data.expiring}
            today={today}
            done={expiryDone}
            pending={pending}
            onAct={actExpiry}
          />
          <ProcurementList
            orders={orders}
            canApprove={canApprove}
            viewerId={viewerId}
            pending={pending}
            onStep={step}
            onReceive={(id) => {
              setFlash(null);
              setReceiving(id);
            }}
          />
        </aside>
      </div>
    </div>
  );
}
