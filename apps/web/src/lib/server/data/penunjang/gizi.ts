import 'server-only';
import { DEFAULT_MEAL } from '../../../demo/fixtures/penunjang-gizi';
import { DEMO_NOW } from '../../../demo/fixtures/waktu';
import type { Delivery, DietOrder, MealTime } from '../../../penunjang-gizi';
import { readDomain } from '../../demo/state';
import { notImplemented } from '../not-implemented';
import { isDemoData } from './shared';

/** S07 · Data layar Gizi. Mode presentasi: dummy + toko demo `penunjang`; mode api diisi potongan 4.9. */

export interface NutritionData {
  rev: number;
  asOf: string;
  orders: DietOrder[];
  deliveries: Record<string, Delivery>;
  meal: MealTime;
}

export async function getNutrition(): Promise<NutritionData> {
  if (!isDemoData()) return notImplemented('gizi');
  const { state, rev } = await readDomain('penunjang');
  return { asOf: DEMO_NOW, orders: state.diets, deliveries: state.deliveries, meal: DEFAULT_MEAL, rev };
}
