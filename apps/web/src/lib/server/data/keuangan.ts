import 'server-only';
import {
  type AccountingBoard,
  accountingBoardSchema,
  type ClaimBoard,
  claimBoardSchema,
  type KasirBoard,
  kasirBoardSchema,
} from '@simrs/shared';
import { CAPTURE_EVENTS } from '../../demo/fixtures/charge-capture';
import { type AkuntansiState, applyAkuntansi } from '../../keuangan-akuntansi-toko';
import { demoAccountingBoard, demoClaimBoard, demoKasirBoard } from '../../keuangan-skenario';
import {
  applyCaptures,
  applyTagihan,
  heldByRm,
  resolvedFixtureCaptures,
  type TagihanState,
} from '../../keuangan-tagihan-toko';
import type { SessionView } from '../../session-view';
import { assertDemo } from '../demo-guard';
import { readDomain } from '../demo/state';
import { scenarioRuns } from '../demo/scenario-context';
import { webEnv } from '../web-env';
import { notImplemented } from './not-implemented';

/**
 * U02–U09 · Data keuangan. Satu-satunya pintu halaman Kasir, Klaim, dan Akuntansi: mode presentasi memakai data
 * dummy + proyeksi pasien skenario + toko demo bersama (ADR-0085; divalidasi kontrak yang sama dengan API kelak),
 * mode api menunggu backend fase 5. Halaman, Server Action, dan layar lain membaca jalur yang sama.
 */

export interface KasirStore {
  board: KasirBoard;
  /** Revisi domain `tagihan` (dikirim bersama aksi). */
  rev: number;
  state: TagihanState;
  /** Event charge capture tertahan per RM (finalisasi ditahan). */
  held: Map<string, number>;
}

export async function getKasirStore(session: SessionView): Promise<KasirStore> {
  if (webEnv().dataSource !== 'demo') return notImplemented('kasir');
  assertDemo();
  const [runs, tg] = await Promise.all([scenarioRuns(session), readDomain('tagihan')]);
  const board = kasirBoardSchema.parse(
    applyTagihan(demoKasirBoard(runs.results), tg.state, resolvedFixtureCaptures(CAPTURE_EVENTS, tg.state)),
  );
  return { board, rev: tg.rev, state: tg.state, held: heldByRm(applyCaptures(CAPTURE_EVENTS, tg.state)) };
}

export async function getKasirBoard(session: SessionView): Promise<KasirBoard> {
  return (await getKasirStore(session)).board;
}

export async function getClaimBoard(session: SessionView): Promise<ClaimBoard> {
  if (webEnv().dataSource === 'demo') {
    assertDemo();
    const runs = await scenarioRuns(session);
    return claimBoardSchema.parse(demoClaimBoard(runs.results));
  }
  return notImplemented('klaim');
}

export interface AccountingStore {
  board: AccountingBoard;
  rev: number;
  state: AkuntansiState;
}

export async function getAccountingStore(session: SessionView): Promise<AccountingStore> {
  if (webEnv().dataSource !== 'demo') return notImplemented('akuntansi');
  assertDemo();
  const [runs, ak] = await Promise.all([scenarioRuns(session), readDomain('akuntansi')]);
  const board = accountingBoardSchema.parse(applyAkuntansi(demoAccountingBoard(runs.results), ak.state));
  return { board, rev: ak.rev, state: ak.state };
}

export async function getAccountingBoard(session: SessionView): Promise<AccountingBoard> {
  return (await getAccountingStore(session)).board;
}
