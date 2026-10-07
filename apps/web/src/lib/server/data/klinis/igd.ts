import 'server-only';
import {
  type EdBoard,
  type EdBoardApi,
  edBoardApiSchema,
  edBoardSchema,
  type EdTrackingItem,
} from '@simrs/shared';
import { demoBedRequests, demoBeds, demoEdBoardBase } from '../../../demo/fixtures/rawat-inap';
import { BANGSAL } from '../../../demo/fixtures/rs';
import { DEMO_NOW } from '../../../demo/fixtures/waktu';
import { applyIgd, type IgdDeath, type IgdState, walkInItems } from '../../../klinis-igd-toko';
import { admissionFlows, type BedState } from '../../../rawat-inap-bed-toko';
import { hartonoEdItem } from '../../../rawat-inap-scenario';
import { can, type SessionView } from '../../../session-view';
import { scenarioRuns } from '../../demo/scenario-context';
import { readDomain } from '../../demo/state';
import { api } from '../../api';
import { assertDemo } from '../../demo-guard';
import { webEnv } from '../../web-env';
import { notImplemented } from '../not-implemented';

/**
 * K03 · Data layar IGD. Mode presentasi: papan fiktif + keadaan toko demo (`klinis-igd`: pasien datang sendiri,
 * triase, dokter penanggung jawab, permintaan bed, disposisi meninggal; `tempat-tidur`: bed yang dialokasikan) +
 * proyeksi pasien skenario IGD → rawat inap (Tn. Hartono), divalidasi kontrak yang sama dengan API kelak. Mode api
 * (layar W3): `getEdBoardLive` = papan IGD API (`GET /triage/board`, unit penugasan; diaudit per pasien oleh API).
 */

/**
 * K03 · Papan IGD mode api (layar W3, ADR-0104). Peran tanpa `clinical.read` (loket pendaftaran IGD) memakai papan
 * administratif tanpa isi triase (ADR-0109). Galat API (`ApiError`) diteruskan ke halaman.
 */
export async function getEdBoardLive(session: SessionView): Promise<EdBoardApi> {
  const path = can(session, 'clinical', 'read') ? '/api/v1/triage/board' : '/api/v1/triage/board/admission';
  return api(path, { schema: edBoardApiSchema });
}

/** Papan IGD + toko (tanpa yang sudah tiba di bangsal atau meninggal). */
function boardWith(base: EdBoard, igd: IgdState, bed: BedState): EdBoard {
  const arrived = new Set(
    admissionFlows(bed)
      .filter((f) => f.status === 'terisi')
      .map((f) => f.encounterId),
  );
  const items = applyIgd([...base.items, ...walkInItems(igd)], igd).filter(
    (p) => !arrived.has(p.encounterId),
  );
  return { ...base, items };
}

/** Papan pelacakan IGD (Tn. Hartono muncul sejak skenario IGD dimulai sampai serah terima ke ruang). */
export async function getEdBoard(session: SessionView): Promise<EdBoard> {
  if (webEnv().dataSource === 'demo') {
    assertDemo();
    const [runs, igd, bed] = await Promise.all([
      scenarioRuns(session),
      readDomain('klinis-igd'),
      readDomain('tempat-tidur'),
    ]);
    const board = demoEdBoardBase(DEMO_NOW);
    const hartono = hartonoEdItem(runs.results['igd-ranap'], board.asOf);
    if (hartono) board.items.splice(1, 0, hartono);
    return edBoardSchema.parse(boardWith(board, igd.state, bed.state));
  }
  return notImplemented('IGD');
}

/** Satu pasien IGD untuk gerbang sisi server (dari papan server, termasuk pasien datang sendiri tersimpan). */
export async function getEdItem(session: SessionView, encounterId: string): Promise<EdTrackingItem | null> {
  const board = await getEdBoard(session);
  return board.items.find((p) => p.encounterId === encounterId) ?? null;
}

export interface IgdDisposition {
  /** Permintaan bed sudah ada (fixture papan bed atau dari layar ini). */
  bedRequested: boolean;
  /** Bed yang dialokasikan, mis. "M-205 · Bangsal Melati · dipesan 11.02". */
  placement: string | null;
}

export interface IgdView {
  board: EdBoard;
  rev: number;
  state: IgdState;
  /** Disposisi per kunjungan papan. */
  dispositions: Record<string, IgdDisposition>;
  deaths: Array<IgdDeath & { encounterId: string }>;
}

/** Papan + keadaan toko untuk halaman IGD. */
export async function getIgdView(session: SessionView): Promise<IgdView> {
  const board = await getEdBoard(session);
  const [igd, bed] = await Promise.all([readDomain('klinis-igd'), readDomain('tempat-tidur')]);
  const fixtureRms = new Set(demoBedRequests(demoBeds()).map((r) => r.rm));
  const flows = admissionFlows(bed.state);
  const dispositions = Object.fromEntries(
    board.items.map((p) => {
      const f = flows.find((x) => x.encounterId === p.encounterId);
      const ward = f ? BANGSAL.find((w) => w.code === f.wardCode)?.name : null;
      return [
        p.encounterId,
        {
          bedRequested: !!igd.state.admission[p.encounterId] || (!!p.rm && fixtureRms.has(p.rm)),
          placement: f ? `${f.bedCode}${ward ? ` · ${ward}` : ''} · dipesan` : null,
        },
      ];
    }),
  );
  return {
    board,
    rev: igd.rev,
    state: igd.state,
    dispositions,
    deaths: Object.entries(igd.state.death).map(([encounterId, d]) => ({ ...d, encounterId })),
  };
}
