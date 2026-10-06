import 'server-only';
import {
  CRITICAL_HISTORY_7D,
  CRITICAL_RULES,
  criticalFromLab,
  demoOtherCriticals,
} from '../../demo/fixtures/penunjang-kritis';
import { demoBloodRequests, demoBloodUnits } from '../../demo/fixtures/penunjang-bank-darah';
import { demoCultures, demoPaCases } from '../../demo/fixtures/penunjang-mikro';
import { demoDiagOrders } from '../../demo/fixtures/penunjang-diagnostik';
import { DEFAULT_MEAL, demoDeliveries, demoDietOrders } from '../../demo/fixtures/penunjang-gizi';
import { DEPO_MASTER, DEPO_REQUESTS, demoDepoState } from '../../demo/fixtures/penunjang-depo';
import { DEMO_NOW, DEMO_TODAY } from '../../demo/fixtures/waktu';
import type { BloodState } from '../../penunjang-bank-darah';
import type { DepoMaster, DepoState } from '../../penunjang-depo';
import type { Delivery, DietOrder, MealTime } from '../../penunjang-gizi';
import type { CultureCase, PaCase } from '../../penunjang-mikro';
import type { DiagOrder } from '../../penunjang-diagnostik';
import { type CriticalItem, sortCritical } from '../../penunjang-kritis';
import type { SessionView } from '../../session-view';
import { scenarioRuns } from '../demo/scenario-context';
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

export async function getCriticalCenter(session: SessionView): Promise<CriticalCenter> {
  if (!isDemo()) return notImplemented('pusat hasil kritis');
  const { results } = await scenarioRuns(session);
  const lab = await getLabWorklist(results);
  const fromLab = lab.samples.flatMap((s) => {
    const c = criticalFromLab(s);
    return c ? [c] : [];
  });
  return {
    asOf: DEMO_NOW,
    items: sortCritical([...fromLab, ...demoOtherCriticals()]),
    history7d: CRITICAL_HISTORY_7D,
    rules: CRITICAL_RULES,
  };
}

export async function findCriticalItem(session: SessionView, id: string): Promise<CriticalItem | undefined> {
  return (await getCriticalCenter(session)).items.find((i) => i.id === id);
}

// ─── S05 · Depo dan stok farmasi ─────────────────────────────────────────────────────────────────────────────

export interface DepoData {
  asOf: string;
  today: string;
  master: DepoMaster;
  state: DepoState;
  requests: typeof DEPO_REQUESTS;
}

export async function getDepoData(): Promise<DepoData> {
  if (!isDemo()) return notImplemented('stok depo farmasi');
  return {
    asOf: DEMO_NOW,
    today: DEMO_TODAY,
    master: DEPO_MASTER,
    state: demoDepoState(),
    requests: DEPO_REQUESTS,
  };
}

// ─── S08 · Bank darah ────────────────────────────────────────────────────────────────────────────────────────

export interface BloodBankData {
  asOf: string;
  today: string;
  state: BloodState;
}

export async function getBloodBank(): Promise<BloodBankData> {
  if (!isDemo()) return notImplemented('bank darah');
  return {
    asOf: DEMO_NOW,
    today: DEMO_TODAY,
    state: { requests: demoBloodRequests(), units: demoBloodUnits() },
  };
}

// ─── S07 · Gizi ──────────────────────────────────────────────────────────────────────────────────────────────

export interface NutritionData {
  asOf: string;
  orders: DietOrder[];
  deliveries: Record<string, Delivery>;
  meal: MealTime;
}

export async function getNutrition(): Promise<NutritionData> {
  if (!isDemo()) return notImplemented('gizi');
  return { asOf: DEMO_NOW, orders: demoDietOrders(), deliveries: demoDeliveries(), meal: DEFAULT_MEAL };
}

// ─── S02 · Mikrobiologi dan patologi anatomi ─────────────────────────────────────────────────────────────────

export interface MicroData {
  asOf: string;
  cultures: CultureCase[];
  pa: PaCase[];
}

export async function getMicroPa(): Promise<MicroData> {
  if (!isDemo()) return notImplemented('mikrobiologi dan patologi anatomi');
  return { asOf: DEMO_NOW, cultures: demoCultures(), pa: demoPaCases() };
}

// ─── S10 · Penunjang diagnostik lain ─────────────────────────────────────────────────────────────────────────

export async function getDiagOrders(): Promise<{ asOf: string; orders: DiagOrder[] }> {
  if (!isDemo()) return notImplemented('penunjang diagnostik lain');
  return { asOf: DEMO_NOW, orders: demoDiagOrders() };
}
