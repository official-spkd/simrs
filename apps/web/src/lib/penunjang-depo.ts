import { formatRupiah } from '@simrs/shared';

/**
 * S05 · Depo dan stok farmasi (mode presentasi, ADR-0023): saldo per depo × batch, kedaluwarsa, FEFO (batch ED
 * terdekat keluar dulu; memilih batch lain wajib alasan), batch kedaluwarsa tidak pernah keluar ke pasien, mutasi
 * antar depo dua langkah (kirim → terima oleh petugas lain), dan stok opname dengan alasan selisih. Logika murni
 * mengikuti keputusan fase 4 #9–#10 (ledger append-only; saldo tidak pernah negatif). Uang = rupiah bigint.
 */

export interface DepotDef {
  id: string;
  name: string;
  kind: 'gudang' | 'depo';
}

export interface StockItemDef {
  id: string;
  name: string;
  /** Kode KFA dari contoh seed, null = "KFA belum dipetakan". */
  kfa: string | null;
  unit: string;
  highAlert: boolean;
  /** Stok minimum per depo (peringatan di bawahnya). */
  minPerDepot: number;
}

export interface StockBatch {
  id: string;
  itemId: string;
  batchNo: string;
  /** `YYYY-MM-DD`. */
  expiry: string;
  /** Harga pokok per satuan, rupiah (digit, dibaca sebagai bigint). */
  unitCost: string;
  supplier: string;
}

export interface Balance {
  depotId: string;
  batchId: string;
  qty: number;
}

export type MovementKind = 'awal' | 'keluar' | 'mutasi-kirim' | 'mutasi-terima' | 'opname' | 'karantina';

export const MOVEMENT_LABEL: Record<MovementKind, string> = {
  awal: 'Saldo awal',
  keluar: 'Keluar ke pasien',
  'mutasi-kirim': 'Mutasi keluar',
  'mutasi-terima': 'Mutasi masuk',
  opname: 'Penyesuaian opname',
  karantina: 'Karantina kedaluwarsa',
};

export interface Movement {
  id: string;
  at: string;
  kind: MovementKind;
  depotId: string;
  batchId: string;
  /** Bertanda: keluar negatif, masuk positif. */
  qty: number;
  ref: string;
  by: string;
  reason?: string;
}

export interface Transfer {
  id: string;
  from: string;
  to: string;
  itemId: string;
  lines: ReadonlyArray<{ batchId: string; qty: number }>;
  status: 'dikirim' | 'diterima';
  sentAt: string;
  sentBy: string;
  receivedAt?: string;
  receivedBy?: string;
}

export interface DepoState {
  balances: readonly Balance[];
  movements: readonly Movement[];
  transfers: readonly Transfer[];
}

export interface DepoMaster {
  depots: readonly DepotDef[];
  items: readonly StockItemDef[];
  batches: readonly StockBatch[];
}

/** Batas "segera kedaluwarsa" (hari), sama dengan daftar FEFO logistik. */
export const NEAR_EXPIRY_DAYS = 90;

const dayMs = 86_400_000;
const dayNum = (iso: string) => Date.parse(`${iso}T00:00:00Z`) / dayMs;

export type ExpiryStatus = 'kedaluwarsa' | 'segera' | 'aman';

export function expiryStatus(expiry: string, today: string): { status: ExpiryStatus; days: number } {
  const days = Math.round(dayNum(expiry) - dayNum(today));
  return { status: days < 0 ? 'kedaluwarsa' : days <= NEAR_EXPIRY_DAYS ? 'segera' : 'aman', days };
}

export function expiryText(expiry: string, today: string): string {
  const { status, days } = expiryStatus(expiry, today);
  if (status === 'kedaluwarsa') return `kedaluwarsa ${-days} hari lalu`;
  if (days === 0) return 'kedaluwarsa hari ini';
  return `${days} hari lagi`;
}

export function qtyOf(state: DepoState, depotId: string, batchId: string): number {
  return state.balances.find((b) => b.depotId === depotId && b.batchId === batchId)?.qty ?? 0;
}

/** Batch item di depo (qty > 0), urut ED terdekat dulu. */
export function batchesIn(
  state: DepoState,
  master: Pick<DepoMaster, 'batches'>,
  depotId: string,
  itemId: string,
): Array<StockBatch & { qty: number }> {
  return master.batches
    .filter((b) => b.itemId === itemId)
    .map((b) => ({ ...b, qty: qtyOf(state, depotId, b.id) }))
    .filter((b) => b.qty > 0)
    .sort((a, b) => a.expiry.localeCompare(b.expiry) || a.batchNo.localeCompare(b.batchNo));
}

/** Stok yang boleh dipakai (tidak kedaluwarsa) untuk item di depo. */
export function usableStock(
  state: DepoState,
  master: Pick<DepoMaster, 'batches'>,
  depotId: string,
  itemId: string,
  today: string,
): number {
  return batchesIn(state, master, depotId, itemId)
    .filter((b) => expiryStatus(b.expiry, today).status !== 'kedaluwarsa')
    .reduce((a, b) => a + b.qty, 0);
}

export interface Allocation {
  batchId: string;
  qty: number;
}

/** Rencana FEFO: ambil dari batch ED terdekat yang belum kedaluwarsa sampai `qty` terpenuhi. */
export function fefoPlan(
  state: DepoState,
  master: Pick<DepoMaster, 'batches'>,
  depotId: string,
  itemId: string,
  qty: number,
  today: string,
): { allocations: Allocation[]; shortBy: number } {
  let left = qty;
  const allocations: Allocation[] = [];
  for (const b of batchesIn(state, master, depotId, itemId)) {
    if (left <= 0) break;
    if (expiryStatus(b.expiry, today).status === 'kedaluwarsa') continue;
    const take = Math.min(left, b.qty);
    allocations.push({ batchId: b.id, qty: take });
    left -= take;
  }
  return { allocations, shortBy: Math.max(0, left) };
}

export type DepoErrorCode =
  | 'QTY_INVALID'
  | 'STOCK_INSUFFICIENT'
  | 'BATCH_EXPIRED'
  | 'BATCH_UNKNOWN'
  | 'FEFO_OVERRIDE_REASON'
  | 'SAME_DEPOT'
  | 'TRANSFER_UNKNOWN'
  | 'RECEIVER_REQUIRED'
  | 'RECEIVER_SAME_AS_SENDER'
  | 'OPNAME_REASON'
  | 'NOT_EXPIRED';

export const DEPO_ERROR_TEXT: Record<DepoErrorCode, string> = {
  QTY_INVALID: 'Jumlah harus bilangan bulat lebih dari 0.',
  STOCK_INSUFFICIENT: 'Stok yang boleh dipakai di depo ini tidak cukup.',
  BATCH_EXPIRED: 'Batch kedaluwarsa tidak boleh dikeluarkan. Pindahkan ke karantina.',
  BATCH_UNKNOWN: 'Batch tidak ada di depo ini.',
  FEFO_OVERRIDE_REASON:
    'Memilih batch selain urutan FEFO wajib alasan (minimal 10 karakter) dan tercatat di kartu stok.',
  SAME_DEPOT: 'Depo asal dan tujuan tidak boleh sama.',
  TRANSFER_UNKNOWN: 'Mutasi tidak ditemukan atau sudah diterima.',
  RECEIVER_REQUIRED: 'Nama petugas penerima di depo tujuan wajib diisi (minimal 5 karakter).',
  RECEIVER_SAME_AS_SENDER: 'Penerima harus petugas lain, bukan pengirim mutasi.',
  OPNAME_REASON: 'Ada selisih opname: alasan wajib diisi (minimal 10 karakter).',
  NOT_EXPIRED: 'Hanya batch kedaluwarsa yang dipindahkan ke karantina.',
};

export type DepoAction =
  | {
      type: 'keluar';
      depotId: string;
      itemId: string;
      qty: number;
      ref: string;
      /** Batch pilihan manual (override FEFO); kosong = FEFO otomatis. */
      batchId?: string;
      reason?: string;
    }
  | { type: 'kirim'; from: string; to: string; itemId: string; qty: number }
  | { type: 'terima'; transferId: string; receiver: string }
  | { type: 'opname'; depotId: string; counts: Readonly<Record<string, number>>; reason: string }
  | { type: 'karantina'; depotId: string; batchId: string };

export interface DepoCtx {
  at: string;
  by: string;
  today: string;
  /** Pembangkit id deterministik (tes) atau berbasis waktu (layar). */
  nextId: (prefix: string) => string;
}

export type DepoResult =
  { ok: true; state: DepoState; message: string } | { ok: false; code: DepoErrorCode; message: string };

const fail = (code: DepoErrorCode): DepoResult => ({ ok: false, code, message: DEPO_ERROR_TEXT[code] });

function setQty(balances: readonly Balance[], depotId: string, batchId: string, delta: number): Balance[] {
  const found = balances.some((b) => b.depotId === depotId && b.batchId === batchId);
  const next = balances.map((b) =>
    b.depotId === depotId && b.batchId === batchId ? { ...b, qty: b.qty + delta } : b,
  );
  return found ? next : [...next, { depotId, batchId, qty: delta }];
}

const validQty = (n: number) => Number.isInteger(n) && n > 0;
const nameOf = <T extends { id: string; name: string }>(list: readonly T[], id: string) =>
  list.find((x) => x.id === id)?.name ?? id;

/**
 * Gerbang pengeluaran ke pasien: jumlah valid, stok cukup, batch kedaluwarsa ditolak tanpa override, dan memilih
 * batch selain urutan FEFO wajib alasan. Dipakai layar (umpan balik) dan Server Action.
 */
export function dispenseGate(
  state: DepoState,
  master: Pick<DepoMaster, 'batches'>,
  a: Extract<DepoAction, { type: 'keluar' }>,
  today: string,
): { code: DepoErrorCode } | { allocations: Allocation[]; overridden: boolean } {
  if (!validQty(a.qty)) return { code: 'QTY_INVALID' };
  if (a.batchId) {
    const batch = master.batches.find((b) => b.id === a.batchId && b.itemId === a.itemId);
    if (!batch) return { code: 'BATCH_UNKNOWN' };
    if (expiryStatus(batch.expiry, today).status === 'kedaluwarsa') return { code: 'BATCH_EXPIRED' };
    if (qtyOf(state, a.depotId, batch.id) < a.qty) return { code: 'STOCK_INSUFFICIENT' };
    const plan = fefoPlan(state, master, a.depotId, a.itemId, a.qty, today);
    const isFefo = plan.allocations.length === 1 && plan.allocations[0]?.batchId === batch.id;
    if (!isFefo && (a.reason ?? '').trim().length < 10) return { code: 'FEFO_OVERRIDE_REASON' };
    return { allocations: [{ batchId: batch.id, qty: a.qty }], overridden: !isFefo };
  }
  const plan = fefoPlan(state, master, a.depotId, a.itemId, a.qty, today);
  if (plan.shortBy > 0) return { code: 'STOCK_INSUFFICIENT' };
  return { allocations: plan.allocations, overridden: false };
}

/** Terapkan satu transaksi stok; saldo tidak pernah negatif, setiap perubahan tercatat di kartu stok. */
export function applyDepo(state: DepoState, master: DepoMaster, a: DepoAction, ctx: DepoCtx): DepoResult {
  const batchNo = (id: string) => master.batches.find((b) => b.id === id)?.batchNo ?? id;
  const itemName = (id: string) => nameOf(master.items, id);
  const depotName = (id: string) => nameOf(master.depots, id);

  switch (a.type) {
    case 'keluar': {
      const g = dispenseGate(state, master, a, ctx.today);
      if ('code' in g) return fail(g.code);
      let balances = [...state.balances];
      const moves: Movement[] = g.allocations.map((al) => {
        balances = setQty(balances, a.depotId, al.batchId, -al.qty);
        return {
          id: ctx.nextId('mv'),
          at: ctx.at,
          kind: 'keluar',
          depotId: a.depotId,
          batchId: al.batchId,
          qty: -al.qty,
          ref: a.ref,
          by: ctx.by,
          ...(g.overridden ? { reason: `Override FEFO: ${(a.reason ?? '').trim()}` } : {}),
        };
      });
      const detail = g.allocations.map((al) => `${al.qty} dari ${batchNo(al.batchId)}`).join(', ');
      return {
        ok: true,
        state: { ...state, balances, movements: [...moves, ...state.movements] },
        message: `${itemName(a.itemId)} ${a.qty} keluar (${detail})${g.overridden ? ' · override FEFO tercatat' : ' · FEFO'}`,
      };
    }
    case 'kirim': {
      if (a.from === a.to) return fail('SAME_DEPOT');
      if (!validQty(a.qty)) return fail('QTY_INVALID');
      const plan = fefoPlan(state, master, a.from, a.itemId, a.qty, ctx.today);
      if (plan.shortBy > 0) return fail('STOCK_INSUFFICIENT');
      const id = ctx.nextId('mt');
      let balances = [...state.balances];
      const moves: Movement[] = plan.allocations.map((al) => {
        balances = setQty(balances, a.from, al.batchId, -al.qty);
        return {
          id: ctx.nextId('mv'),
          at: ctx.at,
          kind: 'mutasi-kirim',
          depotId: a.from,
          batchId: al.batchId,
          qty: -al.qty,
          ref: `${id} → ${depotName(a.to)}`,
          by: ctx.by,
        };
      });
      const transfer: Transfer = {
        id,
        from: a.from,
        to: a.to,
        itemId: a.itemId,
        lines: plan.allocations,
        status: 'dikirim',
        sentAt: ctx.at,
        sentBy: ctx.by,
      };
      return {
        ok: true,
        state: {
          balances,
          movements: [...moves, ...state.movements],
          transfers: [transfer, ...state.transfers],
        },
        message: `Mutasi ${id}: ${itemName(a.itemId)} ${a.qty} dikirim ${depotName(a.from)} → ${depotName(a.to)}, menunggu diterima`,
      };
    }
    case 'terima': {
      const t = state.transfers.find((x) => x.id === a.transferId && x.status === 'dikirim');
      if (!t) return fail('TRANSFER_UNKNOWN');
      const receiver = a.receiver.trim();
      if (receiver.length < 5) return fail('RECEIVER_REQUIRED');
      if (receiver.toLowerCase() === t.sentBy.trim().toLowerCase()) return fail('RECEIVER_SAME_AS_SENDER');
      let balances = [...state.balances];
      const moves: Movement[] = t.lines.map((l) => {
        balances = setQty(balances, t.to, l.batchId, l.qty);
        return {
          id: ctx.nextId('mv'),
          at: ctx.at,
          kind: 'mutasi-terima',
          depotId: t.to,
          batchId: l.batchId,
          qty: l.qty,
          ref: `${t.id} ← ${depotName(t.from)}`,
          by: receiver,
        };
      });
      return {
        ok: true,
        state: {
          balances,
          movements: [...moves, ...state.movements],
          transfers: state.transfers.map((x) =>
            x.id === t.id ? { ...x, status: 'diterima', receivedAt: ctx.at, receivedBy: receiver } : x,
          ),
        },
        message: `Mutasi ${t.id} diterima di ${depotName(t.to)} oleh ${receiver}`,
      };
    }
    case 'opname': {
      const diffs = opnameDiffs(state, a.depotId, a.counts);
      const changed = diffs.filter((d) => d.diff !== 0);
      if (changed.length > 0 && a.reason.trim().length < 10) return fail('OPNAME_REASON');
      let balances = [...state.balances];
      const moves: Movement[] = changed.map((d) => {
        balances = setQty(balances, a.depotId, d.batchId, d.diff);
        return {
          id: ctx.nextId('mv'),
          at: ctx.at,
          kind: 'opname',
          depotId: a.depotId,
          batchId: d.batchId,
          qty: d.diff,
          ref: `Opname ${depotName(a.depotId)}`,
          by: ctx.by,
          reason: a.reason.trim(),
        };
      });
      return {
        ok: true,
        state: { ...state, balances, movements: [...moves, ...state.movements] },
        message:
          changed.length === 0
            ? `Opname ${depotName(a.depotId)} selesai: ${diffs.length} batch cocok, tanpa selisih`
            : `Opname ${depotName(a.depotId)} selesai: ${changed.length} batch disesuaikan (${changed
                .map((d) => `${batchNo(d.batchId)} ${d.diff > 0 ? '+' : ''}${d.diff}`)
                .join(', ')})`,
      };
    }
    case 'karantina': {
      const batch = master.batches.find((b) => b.id === a.batchId);
      const qty = qtyOf(state, a.depotId, a.batchId);
      if (!batch || qty <= 0) return fail('BATCH_UNKNOWN');
      if (expiryStatus(batch.expiry, ctx.today).status !== 'kedaluwarsa') return fail('NOT_EXPIRED');
      return {
        ok: true,
        state: {
          ...state,
          balances: setQty(state.balances, a.depotId, a.batchId, -qty),
          movements: [
            {
              id: ctx.nextId('mv'),
              at: ctx.at,
              kind: 'karantina',
              depotId: a.depotId,
              batchId: a.batchId,
              qty: -qty,
              ref: 'Karantina → retur pemasok / pemusnahan',
              by: ctx.by,
            },
            ...state.movements,
          ],
        },
        message: `${itemName(batch.itemId)} batch ${batch.batchNo} (${qty}) dipindahkan ke karantina`,
      };
    }
  }
}

/** Selisih opname per batch yang punya saldo atau dihitung (hitung fisik − sistem). */
export function opnameDiffs(
  state: DepoState,
  depotId: string,
  counts: Readonly<Record<string, number>>,
): Array<{ batchId: string; system: number; counted: number; diff: number }> {
  const ids = new Set([
    ...state.balances.filter((b) => b.depotId === depotId && b.qty > 0).map((b) => b.batchId),
    ...Object.keys(counts),
  ]);
  return [...ids].map((batchId) => {
    const system = qtyOf(state, depotId, batchId);
    const counted = counts[batchId] ?? system;
    return { batchId, system, counted, diff: counted - system };
  });
}

/** Nilai persediaan depo (rupiah, bigint): Σ qty × harga pokok batch. */
export function stockValue(state: DepoState, master: Pick<DepoMaster, 'batches'>, depotId: string): bigint {
  return state.balances
    .filter((b) => b.depotId === depotId && b.qty > 0)
    .reduce((sum, b) => {
      const cost = master.batches.find((x) => x.id === b.batchId)?.unitCost ?? '0';
      return sum + BigInt(cost) * BigInt(b.qty);
    }, 0n);
}

export function formatStockValue(v: bigint): string {
  return formatRupiah(v);
}

/** Ringkasan peringatan depo: batch kedaluwarsa (wajib karantina), segera ED, item di bawah minimum. */
export function depotAlerts(state: DepoState, master: DepoMaster, depotId: string, today: string) {
  const rows = state.balances
    .filter((b) => b.depotId === depotId && b.qty > 0)
    .flatMap((b) => {
      const batch = master.batches.find((x) => x.id === b.batchId);
      return batch ? [{ batch, qty: b.qty, ...expiryStatus(batch.expiry, today) }] : [];
    });
  const belowMin = master.items.filter((i) => {
    const has = master.batches.some((b) => b.itemId === i.id && qtyOf(state, depotId, b.id) > 0);
    return has && usableStock(state, master, depotId, i.id, today) < i.minPerDepot;
  });
  return {
    expired: rows.filter((r) => r.status === 'kedaluwarsa'),
    near: rows.filter((r) => r.status === 'segera'),
    belowMin,
  };
}

/** Saldo = Σ ledger (properti invarian; dipakai tes). */
export function ledgerBalance(state: DepoState, depotId: string, batchId: string): number {
  return state.movements
    .filter((m) => m.depotId === depotId && m.batchId === batchId)
    .reduce((a, m) => a + m.qty, 0);
}
