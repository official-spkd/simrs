import 'server-only';
import { type EdBoard, edBoardSchema, type EdTrackingItem } from '@simrs/shared';
import { demoEdBoardBase } from '../../../demo/fixtures/rawat-inap';
import { DEMO_NOW } from '../../../demo/fixtures/waktu';
import { walkInFromId } from '../../../rawat-inap';
import { hartonoEdItem } from '../../../rawat-inap-scenario';
import type { SessionView } from '../../../session-view';
import { scenarioRuns } from '../../demo/scenario-context';
import { assertDemo } from '../../demo-guard';
import { webEnv } from '../../web-env';
import { notImplemented } from '../not-implemented';

/**
 * K03 · Data layar IGD. Mode presentasi: papan fiktif + proyeksi pasien skenario IGD → rawat inap (Tn. Hartono),
 * divalidasi kontrak yang sama dengan API kelak; mode api menunggu backend fase 3 (potongan 3.3, layar W3; halaman
 * menampilkan "Belum tersambung").
 */

/** Papan pelacakan IGD (Tn. Hartono muncul sejak skenario IGD dimulai sampai serah terima ke ruang). */
export async function getEdBoard(session: SessionView): Promise<EdBoard> {
  if (webEnv().dataSource === 'demo') {
    assertDemo();
    const runs = await scenarioRuns(session);
    const board = demoEdBoardBase(DEMO_NOW);
    const hartono = hartonoEdItem(runs.results['igd-ranap'], board.asOf);
    if (hartono) board.items.splice(1, 0, hartono);
    return edBoardSchema.parse(board);
  }
  return notImplemented('IGD');
}

/**
 * Satu pasien IGD untuk gerbang triase sisi server: dari papan (data server), atau bawaan pasien datang sendiri
 * dari id sementaranya. Null = tidak dikenal.
 */
export async function getEdItem(session: SessionView, encounterId: string): Promise<EdTrackingItem | null> {
  const board = await getEdBoard(session);
  return board.items.find((p) => p.encounterId === encounterId) ?? walkInFromId(encounterId, board.asOf);
}
