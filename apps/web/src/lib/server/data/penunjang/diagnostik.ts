import 'server-only';
import { DEMO_NOW } from '../../../demo/fixtures/waktu';
import type { DiagOrder } from '../../../penunjang-diagnostik';
import { readDomain } from '../../demo/state';
import { notImplemented } from '../not-implemented';
import { isDemoData } from './shared';

/** S10 · Data layar Diagnostik lain. Mode presentasi: dummy + toko demo `penunjang`; mode api diisi potongan 4.8. */

export async function getDiagOrders(): Promise<{ asOf: string; orders: DiagOrder[]; rev: number }> {
  if (!isDemoData()) return notImplemented('penunjang diagnostik lain');
  const { state, rev } = await readDomain('penunjang');
  return { asOf: DEMO_NOW, orders: state.diagnostics, rev };
}
