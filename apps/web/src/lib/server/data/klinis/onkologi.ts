import 'server-only';
import { patientById } from '../../../demo/fixtures/pasien';
import {
  CHEMO_PLAN,
  CHEMO_VERIFIERS,
  ONCOLOGY_PATIENT_ID,
  PRE_CHEMO_LABS,
} from '../../../demo/fixtures/onkologi';
import { readDomain } from '../../demo/state';

/**
 * B11 · Data layar Onkologi (mode presentasi, ADR-0023): rencana siklus fixture + keadaan siklus tersimpan di toko
 * demo `onkologi` (ADR-0085). `readDomain` menegakkan mode presentasi.
 */
export async function getOncologyView() {
  const { state, rev } = await readDomain('onkologi');
  const patient = patientById(ONCOLOGY_PATIENT_ID);
  if (!patient) throw new Error('pasien onkologi fixture tidak ada');
  return {
    patient,
    plan: CHEMO_PLAN,
    labs: PRE_CHEMO_LABS,
    verifiers: CHEMO_VERIFIERS,
    cycle: state.cycles[CHEMO_PLAN.cycle],
    rev,
  };
}
