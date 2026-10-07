import { type FefoPick, pickFefo, type StockBalance, type StockMovementKind } from '@simrs/shared';

/**
 * S05 · Logika murni layar Depo mode api (potongan 4.6a): ringkasan saldo, rencana mutasi FEFO (aturan `pickFefo`
 * bersama API), dan label bertulisan. Status kedaluwarsa selalu dari server (`expired`, `expiringSoon`).
 */

export const MOVEMENT_KIND_LABEL: Record<StockMovementKind, string> = {
  receipt: 'Penerimaan',
  transfer_out: 'Mutasi keluar',
  transfer_in: 'Mutasi masuk',
  dispense: 'Keluar ke pasien',
  return: 'Retur pasien',
  adjustment: 'Penyesuaian',
  usage: 'Pemakaian (OK/ruang)',
  write_off: 'Hapus buku kedaluwarsa',
};

export interface DepoSummary {
  batches: number;
  expired: number;
  expiringSoon: number;
  drugs: number;
}

export function depoSummary(balances: readonly StockBalance[]): DepoSummary {
  return {
    batches: balances.length,
    expired: balances.filter((b) => b.expired).length,
    expiringSoon: balances.filter((b) => b.expiringSoon && !b.expired).length,
    drugs: new Set(balances.map((b) => b.drugId)).size,
  };
}

/** Obat yang punya stok layak (tidak kedaluwarsa) di depo ini, untuk dipilih saat mutasi. */
export function transferableDrugs(
  balances: readonly StockBalance[],
): Array<{ drugId: string; drugName: string; usable: number }> {
  const map = new Map<string, { drugId: string; drugName: string; usable: number }>();
  for (const b of balances) {
    if (b.expired) continue;
    const cur = map.get(b.drugId) ?? { drugId: b.drugId, drugName: b.drugName, usable: 0 };
    cur.usable += b.quantity;
    map.set(b.drugId, cur);
  }
  return [...map.values()].sort((a, b) => a.drugName.localeCompare(b.drugName, 'id'));
}

export type TransferPlan =
  | { ok: true; picks: Array<FefoPick & { batchNo: string; expiryDate: string }> }
  | { ok: false; message: string };

/** Rencana mutasi FEFO: batch ED terdekat (tidak kedaluwarsa) dulu, dipecah lintas batch bila perlu. */
export function transferPlan(
  balances: readonly StockBalance[],
  drugId: string,
  quantity: number,
  today: string,
): TransferPlan {
  if (!Number.isInteger(quantity) || quantity <= 0)
    return { ok: false, message: 'Jumlah harus bilangan bulat > 0.' };
  const rows = balances.filter((b) => b.drugId === drugId);
  const r = pickFefo(
    rows.map((b) => ({ id: b.stockBatchId, expiryDate: b.expiryDate, quantity: b.quantity })),
    quantity,
    today,
  );
  if (!r.ok) {
    const usable = rows.filter((b) => !b.expired).reduce((s, b) => s + b.quantity, 0);
    return { ok: false, message: `Stok layak hanya ${usable}; batch kedaluwarsa tidak bisa dimutasi.` };
  }
  return {
    ok: true,
    picks: r.picks.map((p) => {
      const b = rows.find((x) => x.stockBatchId === p.batchId);
      return { ...p, batchNo: b?.batchNo ?? '', expiryDate: b?.expiryDate ?? '' };
    }),
  };
}

/** Status ED bertulisan (tidak hanya warna). */
export function expiryLabel(b: Pick<StockBalance, 'expired' | 'expiringSoon'>): string {
  return b.expired ? 'Kedaluwarsa' : b.expiringSoon ? 'Segera kedaluwarsa' : 'Aman';
}
