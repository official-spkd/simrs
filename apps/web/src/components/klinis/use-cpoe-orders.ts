'use client';

import type { CpoeContext, CpoeOrderSet } from '@simrs/shared';
import { useState } from 'react';
import { type CdsFix, type OrderLine, shortDrugName } from '@/lib/klinis-cds';

/** Baris order awal dari kontrak (item katalog + aturan pakai kunjungan + override tercatat). */
function initialLines(ctx: CpoeContext): OrderLine[] {
  return ctx.orders.flatMap((o) => {
    const item = ctx.catalog.find((c) => c.id === o.catalogId);
    return item
      ? [{ lineId: o.id, item: { ...item, detail: o.detail }, status: o.status, override: o.override }]
      : [];
  });
}

let seq = 0;
const newLineId = (catalogId: string) => `baru-${catalogId}-${++seq}`;

/**
 * State daftar order CPOE di peramban (draf sebelum dikirim): tambah dari katalog/order set dengan pencegahan
 * duplikasi, hapus, ganti alternatif, dan override CDS beralasan. `readOnly` = kunjungan pasien skenario: daftar
 * order mengikuti langkah skenario (tidak bisa ditambah/dihapus/diubah lokal; gerbang CDS lewat tugas skenario).
 */
export function useCpoeOrders(ctx: CpoeContext, signer: string, readOnly: boolean) {
  const [lines, setLines] = useState<OrderLine[]>(() => initialLines(ctx));
  const [note, setNote] = useState<string | null>(null);
  const name = (catalogId: string) => ctx.catalog.find((c) => c.id === catalogId)?.name ?? catalogId;

  const add = (ids: readonly string[], label: string | null) => {
    if (readOnly) return;
    const have = new Set(lines.map((l) => l.item.id));
    const fresh = ids.filter((id) => !have.has(id));
    const items = fresh.flatMap((id) => ctx.catalog.filter((c) => c.id === id));
    setLines((cur) => [
      ...cur,
      ...items.map((item) => ({ lineId: newLineId(item.id), item, status: 'draf' as const, override: null })),
    ]);
    const dup = ids.length - fresh.length;
    if (!label) {
      setNote(
        fresh.length
          ? `Ditambahkan: ${name(ids[0] ?? '')}.`
          : `${name(ids[0] ?? '')} sudah ada di daftar order (duplikasi dicegah).`,
      );
    } else {
      setNote(
        `${label} diterapkan: ${fresh.length} item ditambahkan${dup ? `, ${dup} sudah ada (duplikasi dicegah).` : '.'}`,
      );
    }
  };

  const applySet = (set: CpoeOrderSet) => add(set.itemIds, `Order set "${set.name}"`);

  const remove = (lineId: string) => {
    const line = lines.find((l) => l.lineId === lineId);
    if (readOnly || !line || line.status !== 'draf') return;
    setLines((cur) => cur.filter((l) => l.lineId !== lineId));
    setNote(`Dihapus: ${line.item.name}.`);
  };

  const fix = (f: CdsFix) => {
    const line = lines.find((l) => l.lineId === f.lineId);
    if (readOnly || !line || line.status !== 'draf') return;
    if (f.kind === 'remove') return remove(f.lineId);
    const to = ctx.catalog.find((c) => c.id === f.toId);
    if (!to) return;
    setLines((cur) =>
      cur.map((l) =>
        l.lineId === f.lineId ? { lineId: newLineId(to.id), item: to, status: 'draf', override: null } : l,
      ),
    );
    setNote(`${shortDrugName(line.item.name)} diganti ${shortDrugName(to.name)}; CDS diperiksa ulang.`);
  };

  const override = (lineId: string, reason: string) => {
    if (readOnly) return;
    setLines((cur) => cur.map((l) => (l.lineId === lineId ? { ...l, override: reason } : l)));
    setNote(`Override tercatat atas nama ${signer} (simulasi, tidak disimpan).`);
  };

  const markSent = () => setLines((cur) => cur.map((l) => ({ ...l, status: 'terkirim' })));

  return { lines, note, clearNote: () => setNote(null), add, applySet, remove, fix, override, markSent };
}
