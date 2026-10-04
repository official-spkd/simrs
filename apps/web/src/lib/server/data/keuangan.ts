import 'server-only';
import {
  type AccountingBoard,
  accountingBoardSchema,
  type ClaimBoard,
  claimBoardSchema,
  type KasirBoard,
  kasirBoardSchema,
} from '@simrs/shared';
import { demoAccountingBoard, demoClaimBoard, demoKasirBoard } from '../../keuangan-skenario';
import type { SessionView } from '../../session-view';
import { assertDemo } from '../demo-guard';
import { scenarioRuns } from '../demo/scenario-context';
import { webEnv } from '../web-env';
import { notImplemented } from './not-implemented';

/**
 * U02–U09 · Data keuangan. Satu-satunya pintu halaman Kasir, Klaim, dan Akuntansi: mode presentasi memakai data
 * dummy + proyeksi pasien skenario (divalidasi kontrak yang sama dengan API kelak), mode api menunggu backend
 * fase 5.
 */

export async function getKasirBoard(session: SessionView): Promise<KasirBoard> {
  if (webEnv().dataSource === 'demo') {
    assertDemo();
    const runs = await scenarioRuns(session);
    return kasirBoardSchema.parse(demoKasirBoard(runs.results));
  }
  return notImplemented('kasir');
}

export async function getClaimBoard(session: SessionView): Promise<ClaimBoard> {
  if (webEnv().dataSource === 'demo') {
    assertDemo();
    const runs = await scenarioRuns(session);
    return claimBoardSchema.parse(demoClaimBoard(runs.results));
  }
  return notImplemented('klaim');
}

export async function getAccountingBoard(session: SessionView): Promise<AccountingBoard> {
  if (webEnv().dataSource === 'demo') {
    assertDemo();
    const runs = await scenarioRuns(session);
    return accountingBoardSchema.parse(demoAccountingBoard(runs.results));
  }
  return notImplemented('akuntansi');
}
