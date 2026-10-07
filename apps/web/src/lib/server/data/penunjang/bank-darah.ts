import 'server-only';
import { DEMO_NOW, DEMO_TODAY } from '../../../demo/fixtures/waktu';
import type { BloodState } from '../../../penunjang-bank-darah';
import type { SupportState } from '../../../penunjang-demo';
import { readDomain } from '../../demo/state';
import { notImplemented } from '../not-implemented';
import { isDemoData } from './shared';

/** S08 · Data layar Bank darah. Mode presentasi: dummy + toko demo `penunjang`; mode api diisi potongan 4.9. */

export interface BloodBankData {
  rev: number;
  checks: SupportState['checks'];
  asOf: string;
  today: string;
  state: BloodState;
}

export async function getBloodBank(): Promise<BloodBankData> {
  if (!isDemoData()) return notImplemented('bank darah');
  const { state, rev } = await readDomain('penunjang');
  return {
    asOf: DEMO_NOW,
    today: DEMO_TODAY,
    state: state.blood,
    rev,
    checks: state.checks,
  };
}
