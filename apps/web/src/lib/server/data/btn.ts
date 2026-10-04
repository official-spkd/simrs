import 'server-only';
import {
  type FinancingOverview,
  financingOverviewSchema,
  type OrSchedule,
  orScheduleSchema,
  type PaymentOverview,
  paymentOverviewSchema,
} from '@simrs/shared';
import {
  demoFinancingOverview,
  demoOrSchedule,
  demoPaymentOverview,
  type ScenarioHook,
} from '../../btn-skenario';
import { redirect } from 'next/navigation';
import { screenById, screenOpen } from '../../screens';
import { nextLoginStep, type SessionView } from '../../session-view';
import { type ScenarioRuns, scenarioRuns, scenariosHere } from '../demo/scenario-context';
import { assertDemo } from '../demo-guard';
import { getSession } from '../session';
import { webEnv } from '../web-env';
import { notImplemented } from './not-implemented';

/**
 * Untuk Server Action layar domain ini (endpoint POST publik): gerbang demo, sesi lengkap, dan posisi aktif yang
 * memakai layar itu. Action tidak menyimpan apa pun (mode presentasi).
 */
export async function btnActionSession(
  screenId: string,
): Promise<{ session: SessionView } | { error: string }> {
  assertDemo();
  const session = await getSession();
  if (!session || nextLoginStep(session, false) !== 'selesai') redirect('/masuk');
  const screen = screenById(screenId);
  if (!screen || !screenOpen(screen, { dataSource: 'demo', role: session.role?.code ?? null })) {
    return { error: 'Posisi aktif tidak memakai layar ini. Ganti posisi lebih dulu.' };
  }
  return { session };
}

/**
 * I05/U09/U04/S06 · Satu-satunya pintu data layar pembayaran digital, pembiayaan BTN, dan kamar operasi. Mode
 * presentasi: fixture + proyeksi pasien skenario elektif, divalidasi kontrak yang sama dengan API kelak; mode api
 * menunggu backend fase 4/6.
 */

export interface WithScenario<T> {
  data: T;
  /** Tugas skenario elektif yang sedang dibawakan di layar ini (null bila tidak ada). */
  hook: ScenarioHook | null;
}

function hookFor(runs: ScenarioRuns, screenId: string): ScenarioHook | null {
  const here = scenariosHere(runs, screenId).find((h) => h.scenario === 'elektif-btn');
  if (!here) return null;
  const step = runs.results['elektif-btn'].def.steps[here.step.index];
  if (!step) return null;
  return {
    rev: runs.rev,
    stepIndex: here.step.index,
    stepId: step.id,
    enabled: here.step.tasks.filter((t) => t.enabled).map((t) => t.id),
  };
}

export async function getPaymentOverview(session: SessionView): Promise<WithScenario<PaymentOverview>> {
  if (webEnv().dataSource === 'demo') {
    assertDemo();
    const runs = await scenarioRuns(session);
    const data = paymentOverviewSchema.parse(demoPaymentOverview(runs.results['elektif-btn']));
    return { data, hook: hookFor(runs, 'pembayaran') };
  }
  return notImplemented('pembayaran digital');
}

export async function getFinancingOverview(session: SessionView): Promise<WithScenario<FinancingOverview>> {
  if (webEnv().dataSource === 'demo') {
    assertDemo();
    const runs = await scenarioRuns(session);
    const data = financingOverviewSchema.parse(demoFinancingOverview(runs.results['elektif-btn']));
    return { data, hook: hookFor(runs, 'pembiayaan') };
  }
  return notImplemented('pembiayaan BTN');
}

export async function getOrSchedule(session: SessionView): Promise<WithScenario<OrSchedule>> {
  if (webEnv().dataSource === 'demo') {
    assertDemo();
    const runs = await scenarioRuns(session);
    const data = orScheduleSchema.parse(demoOrSchedule(runs.results['elektif-btn']));
    return { data, hook: hookFor(runs, 'ok') };
  }
  return notImplemented('kamar operasi');
}
