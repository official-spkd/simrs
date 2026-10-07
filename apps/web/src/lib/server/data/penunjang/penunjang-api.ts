import 'server-only';
import {
  type BloodBoard,
  bloodBoardSchema,
  type DietOrderRecord,
  dietOrderRecordSchema,
  type DietTypeOption,
  dietTypeOptionSchema,
  type MealList,
  mealListSchema,
  type MealListQuery,
} from '@simrs/shared';
import { z } from 'zod';
import { api } from '../../api';

/**
 * S07 Gizi + S08 Bank darah · bacaan mode api (fase 4 · 4.9, ADR-0105). Satu pintu ke API: izin, ABAC (tampilan
 * layanan vs ruangan), dan audit ditegakkan API.
 */

export function mealList(q: MealListQuery): Promise<MealList> {
  const p = new URLSearchParams({ date: q.date, meal: q.meal });
  if (q.unitId) p.set('unitId', q.unitId);
  return api(`/api/v1/nutrition/meal-list?${p.toString()}`, { schema: mealListSchema });
}

export function dietTypes(): Promise<DietTypeOption[]> {
  return api('/api/v1/nutrition/diet-types', { schema: dietTypeOptionSchema.array() });
}

export function encounterDietOrders(encounterId: string): Promise<DietOrderRecord[]> {
  return api(`/api/v1/encounters/${z.uuid().parse(encounterId)}/diet-orders`, {
    schema: dietOrderRecordSchema.array(),
  });
}

export function bloodBoard(encounterId?: string | null): Promise<BloodBoard> {
  const q = encounterId ? `?encounterId=${z.uuid().parse(encounterId)}` : '';
  return api(`/api/v1/blood/board${q}`, { schema: bloodBoardSchema });
}
