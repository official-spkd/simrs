import 'server-only';
import { DEPO_MASTER, DEPO_REQUESTS } from '../../../demo/fixtures/penunjang-depo';
import { DEMO_NOW, DEMO_TODAY } from '../../../demo/fixtures/waktu';
import type { SupportState } from '../../../penunjang-demo';
import type { DepoMaster, DepoState } from '../../../penunjang-depo';
import { readDomain } from '../../demo/state';
import { notImplemented } from '../not-implemented';
import { isDemoData } from './shared';

/** S05 · Data layar Depo dan stok farmasi. Mode presentasi: dummy + toko demo `penunjang`; mode api diisi 4.6a. */

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
  if (!isDemoData()) return notImplemented('stok depo farmasi');
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
