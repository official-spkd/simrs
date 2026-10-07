import 'server-only';
import { type OrSchedule, orScheduleSchema } from '@simrs/shared';
import { demoOrSchedule } from '../../../btn-skenario';
import type { SessionView } from '../../../session-view';
import { scenarioRuns } from '../../demo/scenario-context';
import { hookFor, type WithScenario } from '../btn';
import { notImplemented } from '../not-implemented';
import { isDemoData } from './shared';

/**
 * S06 · Data layar Kamar operasi (jadwal kamar, daftar tilik WHO, hitung kasa). Mode presentasi: fixture + kasus pasien
 * skenario elektif (Ny. Ratna Sari) dengan kait tugas skenario; mode api diisi potongan 4.7.
 */
export async function getOrSchedule(session: SessionView): Promise<WithScenario<OrSchedule>> {
  if (isDemoData()) {
    const runs = await scenarioRuns(session);
    const data = orScheduleSchema.parse(demoOrSchedule(runs.results['elektif-btn']));
    return { data, hook: hookFor(runs, 'ok') };
  }
  return notImplemented('kamar operasi');
}
