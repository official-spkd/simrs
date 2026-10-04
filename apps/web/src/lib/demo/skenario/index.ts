import type { ScenarioDef, ScenarioId } from '../engine/types';
import { ELEKTIF_BTN } from './elektif-btn';
import { IGD_RANAP } from './igd-ranap';
import { RAWAT_JALAN } from './rawat-jalan';

/**
 * Versi definisi skenario. Naikkan setiap kali langkah/tugas berubah: keadaan tersimpan dengan versi lain
 * dimulai ulang, bukan diputar ulang terhadap definisi yang sudah berbeda.
 */
export const SCENARIO_DEF_VERSION = 1;

export const SCENARIOS: Readonly<Record<ScenarioId, ScenarioDef>> = {
  'rawat-jalan': RAWAT_JALAN,
  'igd-ranap': IGD_RANAP,
  'elektif-btn': ELEKTIF_BTN,
};

/** Urutan tab di layar Simulasi. */
export const SCENARIO_ORDER: readonly ScenarioId[] = ['rawat-jalan', 'igd-ranap', 'elektif-btn'];

export function isScenarioId(v: unknown): v is ScenarioId {
  return typeof v === 'string' && Object.hasOwn(SCENARIOS, v);
}
