import 'server-only';
import {
  type StockBalance,
  stockBalanceSchema,
  type StockLocationView,
  stockLocationViewSchema,
  type StockMovementView,
  stockMovementViewSchema,
  type StockTransferView,
  stockTransferViewSchema,
  type SupplierView,
  supplierViewSchema,
} from '@simrs/shared';
import { z } from 'zod';
import { DEPO_MASTER, DEPO_REQUESTS } from '../../../demo/fixtures/penunjang-depo';
import { DEMO_NOW, DEMO_TODAY } from '../../../demo/fixtures/waktu';
import type { SupportState } from '../../../penunjang-demo';
import type { DepoMaster, DepoState } from '../../../penunjang-depo';
import { api } from '../../api';
import { readDomain } from '../../demo/state';
import { notImplemented } from '../not-implemented';
import { isDemoData } from './shared';

/**
 * S05 · Data layar Depo dan stok farmasi. Mode presentasi: dummy + toko demo `penunjang`. Mode api (potongan 4.6a):
 * `/api/v1/stock/*` (izin `stock.*`; lingkup unit penugasan ditegakkan API).
 */

export interface DepoData {
  rev: number;
  checks: SupportState['checks'];
  asOf: string;
  today: string;
  master: DepoMaster;
  state: DepoState;
  requests: typeof DEPO_REQUESTS;
}

export async function getDepoData(): Promise<DepoData> {
  if (!isDemoData()) return notImplemented('stok depo farmasi');
  const { state, rev } = await readDomain('penunjang');
  return {
    asOf: DEMO_NOW,
    today: DEMO_TODAY,
    master: DEPO_MASTER,
    state: state.depo,
    rev,
    checks: state.checks,
    requests: DEPO_REQUESTS,
  };
}

// ─── Mode api (potongan 4.6a) ────────────────────────────────────────────────────────────────────────────────────

/** Depo/gudang yang boleh dibuka sesi ini (lingkup `stock.read`); `destination` = semua tujuan mutasi aktif. */
export function getStockLocationsApi(purpose: 'own' | 'destination' = 'own'): Promise<StockLocationView[]> {
  return api(`/api/v1/stock/locations?purpose=${purpose}`, { schema: z.array(stockLocationViewSchema) });
}

/** Saldo per batch satu lokasi (qty > 0), urut obat lalu ED terdekat; tanda ED lewat/dekat dari server. */
export function getStockBalancesApi(stockLocationId: string): Promise<StockBalance[]> {
  return api(`/api/v1/stock/balances?stockLocationId=${stockLocationId}`, {
    schema: z.array(stockBalanceSchema),
  });
}

/** Kartu stok satu lokasi, terbaru dulu. */
export function getStockMovementsApi(stockLocationId: string): Promise<StockMovementView[]> {
  return api(`/api/v1/stock/movements?stockLocationId=${stockLocationId}&limit=100`, {
    schema: z.array(stockMovementViewSchema),
  });
}

/** Mutasi yang menyentuh lokasi dalam lingkup (asal/tujuan), terbaru dulu. */
export function getStockTransfersApi(): Promise<StockTransferView[]> {
  return api('/api/v1/stock/transfers', { schema: z.array(stockTransferViewSchema) });
}

/** Pemasok aktif (hanya untuk pemegang `stock.receive`). */
export function getSuppliersApi(): Promise<SupplierView[]> {
  return api('/api/v1/stock/suppliers', { schema: z.array(supplierViewSchema) });
}
