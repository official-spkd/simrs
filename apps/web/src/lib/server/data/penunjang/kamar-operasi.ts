import 'server-only';
import { type OrSchedule, orScheduleSchema, type SurgeryBoard, surgeryBoardSchema } from '@simrs/shared';
import { api } from '../../api';
import { demoOrSchedule } from '../../../btn-skenario';
import type { SessionView } from '../../../session-view';
import { scenarioRuns } from '../../demo/scenario-context';
import { hookFor, type WithScenario } from '../btn';
import { notImplemented } from '../not-implemented';
import { isDemoData } from './shared';

/**
 * S06 · Data layar Kamar operasi (jadwal kamar, daftar tilik WHO, hitung kasa). Mode presentasi: fixture + kasus pasien
 * skenario elektif (Ny. Ratna Sari) dengan kait tugas skenario. Mode api (4.7): `getSurgeryBoardLive`.
 */

/** S06 · Papan kamar operasi API per tanggal (WIB); galat API (`ApiError`) diteruskan ke halaman. */
export async function getSurgeryBoardLive(date: string): Promise<SurgeryBoard> {
  return api(`/api/v1/surgery/board?date=${date}`, { schema: surgeryBoardSchema });
}
export async function getOrSchedule(session: SessionView): Promise<WithScenario<OrSchedule>> {
  if (isDemoData()) {
    const runs = await scenarioRuns(session);
    const data = orScheduleSchema.parse(demoOrSchedule(runs.results['elektif-btn']));
    return { data, hook: hookFor(runs, 'ok') };
  }
  return notImplemented('kamar operasi');
}
