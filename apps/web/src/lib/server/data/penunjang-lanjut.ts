import 'server-only';
import {
  CRITICAL_HISTORY_7D,
  CRITICAL_RULES,
  criticalFromLab,
  demoOtherCriticals,
} from '../../demo/fixtures/penunjang-kritis';
import { DEFAULT_MEAL } from '../../demo/fixtures/penunjang-gizi';
import { DEPO_MASTER, DEPO_REQUESTS } from '../../demo/fixtures/penunjang-depo';
import { DEMO_NOW, DEMO_TODAY } from '../../demo/fixtures/waktu';
import type { SupportState } from '../../penunjang-demo';
import type { BloodState } from '../../penunjang-bank-darah';
import type { DepoMaster, DepoState } from '../../penunjang-depo';
import type { Delivery, DietOrder, MealTime } from '../../penunjang-gizi';
import type { CultureCase, PaCase } from '../../penunjang-mikro';
import type { DiagOrder } from '../../penunjang-diagnostik';
import { applyStoredReports, type CriticalItem, sortCritical } from '../../penunjang-kritis';
import type { SessionView } from '../../session-view';
import { scenarioRuns } from '../demo/scenario-context';
import { readDomain } from '../demo/state';
import { assertDemo } from '../demo-guard';
import { webEnv } from '../web-env';
import { notImplemented } from './not-implemented';
import { getLabWorklist } from './penunjang';

/**
 * S02, S05, S07–S10 · Pintu data layar penunjang lanjutan (pusat hasil kritis, depo, bank darah, gizi,
 * mikrobiologi/PA, diagnostik lain). Mode presentasi: data dummy fiktif (ADR-0023); mode api menunggu backend fase 4.
 * Server Action mencari rekaman lewat fungsi `find*` di sini (klien hanya mengirim id).
 */

const isDemo = () => {
  if (webEnv().dataSource !== 'demo') return false;
  assertDemo();
  return true;
};

// ─── S09 · Pusat hasil kritis ─────────────────────────────────────────────────────────────────────────────────

export interface CriticalCenter {
  asOf: string;
  items: CriticalItem[];
  history7d: readonly number[];
  rules: typeof CRITICAL_RULES;
}

/** Pusat hasil kritis: fixture + nilai kritis worklist Lab + laporan tersimpan di toko demo (ADR-0085). */
export async function getCriticalCenter(session: SessionView): Promise<CriticalCenter> {
  if (!isDemo()) return notImplemented('pusat hasil kritis');
  const { results } = await scenarioRuns(session);
  const lab = await getLabWorklist(results);
  const fromLab = lab.samples.flatMap((s) => {
    const c = criticalFromLab(s);
    return c ? [c] : [];
  });
  const { state } = await readDomain('hasil-kritis');
  const support = await readDomain('penunjang');
  return {
    asOf: DEMO_NOW,
    items: sortCritical(
      applyStoredReports(
        [
          ...fromLab,
          ...demoOtherCriticals().filter((i) => !support.state.criticals.some((x) => x.id === i.id)),
          ...support.state.criticals,
        ],
        state,
      ),
    ),
    history7d: CRITICAL_HISTORY_7D,
    rules: CRITICAL_RULES,
  };
}

export async function findCriticalItem(session: SessionView, id: string): Promise<CriticalItem | undefined> {
  return (await getCriticalCenter(session)).items.find((i) => i.id === id);
}

// ─── S05 · Depo dan stok farmasi ─────────────────────────────────────────────────────────────────────────────

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
  if (!isDemo()) return notImplemented('stok depo farmasi');
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

// ─── S08 · Bank darah ────────────────────────────────────────────────────────────────────────────────────────

export interface BloodBankData {
  rev: number;
  checks: SupportState['checks'];
  asOf: string;
  today: string;
  state: BloodState;
}

export async function getBloodBank(): Promise<BloodBankData> {
  if (!isDemo()) return notImplemented('bank darah');
  const { state, rev } = await readDomain('penunjang');
  return {
    asOf: DEMO_NOW,
    today: DEMO_TODAY,
    state: state.blood,
    rev,
    checks: state.checks,
  };
}

// ─── S07 · Gizi ──────────────────────────────────────────────────────────────────────────────────────────────

export interface NutritionData {
  rev: number;
  asOf: string;
  orders: DietOrder[];
  deliveries: Record<string, Delivery>;
  meal: MealTime;
}

export async function getNutrition(): Promise<NutritionData> {
  if (!isDemo()) return notImplemented('gizi');
  const { state, rev } = await readDomain('penunjang');
  return { asOf: DEMO_NOW, orders: state.diets, deliveries: state.deliveries, meal: DEFAULT_MEAL, rev };
}

// ─── S02 · Mikrobiologi dan patologi anatomi ─────────────────────────────────────────────────────────────────

export interface MicroData {
  rev: number;
  asOf: string;
  cultures: CultureCase[];
  pa: PaCase[];
}

export async function getMicroPa(): Promise<MicroData> {
  if (!isDemo()) return notImplemented('mikrobiologi dan patologi anatomi');
  const { state, rev } = await readDomain('penunjang');
  return { asOf: DEMO_NOW, cultures: state.cultures, pa: state.pa, rev };
}

// ─── S10 · Penunjang diagnostik lain ─────────────────────────────────────────────────────────────────────────

export async function getDiagOrders(): Promise<{ asOf: string; orders: DiagOrder[]; rev: number }> {
  if (!isDemo()) return notImplemented('penunjang diagnostik lain');
  const { state, rev } = await readDomain('penunjang');
  return { asOf: DEMO_NOW, orders: state.diagnostics, rev };
}
