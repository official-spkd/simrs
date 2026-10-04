import 'server-only';
import { redirect } from 'next/navigation';
import type { FrontOfficeProgress } from '../../../demo/fixtures/front-office';
import { frontOfficeProgress } from '../../../front-office';
import { screenById, screenOpen } from '../../../screens';
import { nextLoginStep, type SessionView } from '../../../session-view';
import { scenarioRuns } from '../../demo/scenario-context';
import { assertDemo } from '../../demo-guard';
import { getSession } from '../../session';

/**
 * Bagian bersama data front office (F01–F06) untuk modul per layar (`jadwal`, `antrean`, `pendaftaran`, `kiosk`):
 * gerbang Server Action mode presentasi dan kemajuan Tn. Suryo (skenario rawat jalan) yang diproyeksikan ke layar.
 */

/**
 * Gerbang Server Action front office mode presentasi (endpoint POST publik): mode presentasi, sesi lengkap (pola
 * `simulasi/actions.ts`), dan posisi yang memakai layar `screenId`. Tidak menyimpan apa pun.
 */
export async function frontOfficeActionSession(screenId: string): Promise<SessionView | null> {
  assertDemo();
  const s = await getSession();
  if (!s || nextLoginStep(s, false) !== 'selesai') redirect('/masuk');
  const screen = screenById(screenId);
  if (!screen || !screenOpen(screen, { dataSource: 'demo', role: s.role?.code ?? null })) return null;
  return s;
}

/** Kemajuan skenario rawat jalan yang tampak di layar front office (mode presentasi saja). */
export async function demoProgress(session: SessionView): Promise<FrontOfficeProgress> {
  assertDemo();
  const runs = await scenarioRuns(session);
  return frontOfficeProgress(runs.results['rawat-jalan']);
}
