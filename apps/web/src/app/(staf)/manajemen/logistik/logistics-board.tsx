'use client';

import { formatJam, formatRupiah, type LogisticsOverview, type PurchaseOrderDraft } from '@simrs/shared';
import { Alert, Button, cx, FilterChip } from '@simrs/ui';
import { useState, useTransition } from 'react';
import { ExpiryPanel } from '@/components/manajemen/expiry-panel';
import { PoDraftPanel } from '@/components/manajemen/po-draft-panel';
import { ProcurementList, type ProcurementRow } from '@/components/manajemen/procurement-list';
import { ReorderRow } from '@/components/manajemen/reorder-row';
import { buildPoDraft, formatDays } from '@/lib/manajemen';
import { submitPoAction } from './actions';

type ClassFilter = 'semua' | 'A' | 'V';
const FILTERS: Array<{ id: ClassFilter; label: string }> = [
  { id: 'semua', label: 'Semua kelas' },
  { id: 'A', label: 'ABC-A' },
  { id: 'V', label: 'VEN-V' },
];
const poNumber = (n: number) => `PO-2610-${String(n).padStart(3, '0')}`;

/**
 * B01 · Stok perlu tindakan → draf usulan PO → ajukan (Server Action simulasi), kedaluwarsa FEFO, dan
 * pengadaan berjalan (mockup Logistik). "Buat usulan PO" nonaktif beralasan sampai ada item tercentang.
 */
export function LogisticsBoard({
  data,
  today,
  canApprove,
}: {
  data: LogisticsOverview;
  today: string;
  canApprove: boolean;
}) {
  const [cls, setCls] = useState<ClassFilter>('semua');
  const [picked, setPicked] = useState<Set<string>>(new Set());
  const [inPo, setInPo] = useState<Record<string, string>>({});
  const [draft, setDraft] = useState<PurchaseOrderDraft | null>(null);
  const [newPos, setNewPos] = useState<ProcurementRow[]>([]);
  const [approved, setApproved] = useState<Record<string, string>>({});
  const [nextNo, setNextNo] = useState(() => Number(data.nextPoNumber.slice(-3)));
  const [flash, setFlash] = useState<{ ok: boolean; text: string } | null>(null);
  const [opname, setOpname] = useState(false);
  const [pending, startTransition] = useTransition();

  const visible = data.reorder.filter(
    (i) => cls === 'semua' || (cls === 'A' ? i.abc === 'A' : i.ven === 'V'),
  );
  const pickable = visible.filter((i) => !inPo[i.id]);
  const chosen = pickable.filter((i) => picked.has(i.id));
  const allOn = pickable.length > 0 && chosen.length === pickable.length;
  const reason = draft
    ? 'Selesaikan draf yang terbuka dulu.'
    : chosen.length === 0
      ? 'Centang item dulu untuk membuat usulan.'
      : null;

  const toggle = (id: string) =>
    setPicked((cur) => {
      const next = new Set(cur);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  const toggleAll = () =>
    setPicked((cur) => {
      const next = new Set(cur);
      for (const i of pickable) {
        if (allOn) next.delete(i.id);
        else next.add(i.id);
      }
      return next;
    });

  const makeDraft = () => {
    setFlash(null);
    setDraft(buildPoDraft(data.reorder, new Set(chosen.map((i) => i.id)), poNumber(nextNo)));
  };
  const submit = () => {
    if (!draft) return;
    const d = draft;
    startTransition(async () => {
      const r = await submitPoAction({
        number: d.number,
        lines: d.lines.map((l) => ({ itemId: l.itemId, qty: l.qty })),
      });
      setFlash({ ok: r.ok, text: r.message });
      if (!r.ok) return;
      const first = d.lines[0]?.name ?? 'Item';
      setInPo((cur) => ({ ...cur, ...Object.fromEntries(d.lines.map((l) => [l.itemId, d.number])) }));
      setPicked((cur) => new Set([...cur].filter((id) => !d.lines.some((l) => l.itemId === id))));
      setNewPos((cur) => [
        {
          id: d.number,
          title: d.lines.length > 1 ? `${first} +${d.lines.length - 1} item` : first,
          total: r.total ?? d.total,
          stage: 1,
          statusText: 'Menunggu persetujuan direktur',
        },
        ...cur,
      ]);
      setNextNo((n) => n + 1);
      setDraft(null);
    });
  };
  const approve = (id: string) =>
    setApproved((cur) => ({
      ...cur,
      [id]: `Disetujui direktur ${formatJam(new Date())} · siap diproses PO / e-katalog (simulasi, tidak disimpan)`,
    }));

  const orders: ProcurementRow[] = [...newPos, ...data.purchaseOrders].map((p) => ({
    ...p,
    approvedText: approved[p.id],
  }));
  const estimate = buildPoDraft(data.reorder, new Set(chosen.map((i) => i.id)), poNumber(nextNo));
  const critical = data.reorder.filter((i) => i.daysOfCover < 7);

  return (
    <div className="flex flex-col gap-4">
      <div
        role="group"
        aria-label="Usulan PO"
        className="flex flex-wrap items-center justify-between gap-3 rounded-card border border-line bg-white px-4 py-3"
      >
        <span className="flex min-w-0 flex-[1_1_240px] flex-col text-small text-ink-700">
          <span className="font-semibold text-ink-900">
            {chosen.length} item dipilih
            {estimate ? ` · estimasi ${formatRupiah(BigInt(estimate.total))}` : ''}
          </span>
          <span className="text-caption text-ink-500">
            {critical.length} item kritis (&lt; 7 hari):{' '}
            {critical.map((i) => `${i.name} ${formatDays(i.daysOfCover)}`).join(', ')}
          </span>
        </span>
        <span className="flex flex-col items-end gap-1">
          <span className="flex flex-wrap justify-end gap-2">
            <Button size="sm" aria-expanded={opname} onClick={() => setOpname((o) => !o)}>
              Stok opname
            </Button>
            <Button
              size="sm"
              variant="primary"
              disabled={reason !== null}
              aria-describedby={reason ? 'po-alasan' : undefined}
              onClick={makeDraft}
            >
              Buat usulan PO ({chosen.length})
            </Button>
          </span>
          {reason && (
            <span id="po-alasan" className="text-caption text-ink-500">
              {reason}
            </span>
          )}
        </span>
      </div>

      {opname && (
        <Alert level="info" title="Stok opname">
          Opname terakhir 30 Sep dengan akurasi {String(data.kpi.opnameAccuracy).replace('.', ',')}%. Opname
          berikutnya 31 Okt (gudang farmasi dan depo); lembar hitung dibuka saat jadwal dimulai.
        </Alert>
      )}
      {flash && (
        <div
          role="status"
          className={cx(
            'rounded-card border px-4 py-2.5 text-small font-medium',
            flash.ok
              ? 'border-[#BFE0C7] bg-[#EAF5EC] text-success'
              : 'border-[#F5D9A8] bg-warning-bg text-warning',
          )}
        >
          {flash.text}
        </div>
      )}
      {draft && (
        <PoDraftPanel draft={draft} pending={pending} onCancel={() => setDraft(null)} onSubmit={submit} />
      )}

      <div className="flex flex-wrap items-start gap-4">
        <section
          aria-labelledby="rop-judul"
          className="flex min-w-0 flex-[999_1_560px] flex-col overflow-hidden rounded-card border border-line bg-white"
        >
          <div className="flex flex-wrap items-center justify-between gap-3 border-b border-line px-4 py-3">
            <span className="flex min-w-0 flex-[1_1_260px] flex-col">
              <h2 id="rop-judul" className="m-0 text-base font-semibold">
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
          <div className="grid grid-cols-[44px_minmax(0,1fr)] items-center gap-x-2 border-b border-line bg-[#F8FAFB] pr-4 text-caption font-semibold text-ink-500 xl:grid-cols-[44px_minmax(0,2.2fr)_64px_minmax(0,1fr)_72px_120px_minmax(0,1.7fr)]">
            <span className="flex h-11 items-center justify-center">
              <input
                type="checkbox"
                checked={allOn}
                onChange={toggleAll}
                disabled={pickable.length === 0}
                aria-label="Pilih semua item yang tampil untuk usulan PO"
                className="h-4 w-4 accent-brand-600"
              />
            </span>
            <span>Item</span>
            <span className="hidden xl:block">Kelas</span>
            <span className="hidden xl:block">Stok</span>
            <span className="hidden xl:block">ROP</span>
            <span className="hidden xl:block">Cukup</span>
            <span className="hidden xl:block">Usulan</span>
          </div>
          {visible.map((i) => (
            <ReorderRow
              key={i.id}
              item={i}
              checked={!inPo[i.id] && picked.has(i.id)}
              inPo={inPo[i.id] ?? null}
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
          <ExpiryPanel items={data.expiring} today={today} />
          <ProcurementList orders={orders} canApprove={canApprove} onApprove={approve} />
        </aside>
      </div>
    </div>
  );
}
