import 'server-only';
import { type PharmacyPrescription, type PharmacyQueue, pharmacyQueueSchema } from '@simrs/shared';
import { demoPharmacyQueue } from '../../../demo/fixtures/penunjang';
import { prescriptionsWithStock, type SupportState } from '../../../penunjang-demo';
import type { ScenarioResults } from '../../../penunjang-skenario';
import { scenarioPrescriptions } from '../../../penunjang-skenario-farmasi';
import type { SessionView } from '../../../session-view';
import { scenarioRuns } from '../../demo/scenario-context';
import { readDomain } from '../../demo/state';
import { notImplemented } from '../not-implemented';
import { isDemoData } from './shared';

/**
 * S04/S05 · Data layar Farmasi (telaah, penyiapan, serah terima). Mode presentasi: antrean dummy + resep pasien
 * skenario + keadaan tersimpan di toko demo `penunjang`. Mode api diisi potongan 4.5 dan 4.6b.
 */

export type StoredPharmacyQueue = PharmacyQueue & {
  rev: number;
  stored: SupportState['rx'];
  incoming: SupportState['incomingOrders'];
};

/** Antrean resep farmasi (telaah, penyiapan, serah terima) termasuk resep pasien skenario. */
export async function getPharmacyQueue(scenario: ScenarioResults): Promise<StoredPharmacyQueue> {
  if (isDemoData()) {
    const base = demoPharmacyQueue(scenarioPrescriptions(scenario));
    const { state, rev } = await readDomain('penunjang');
    const persisted = new Map(prescriptionsWithStock(state).map((rx) => [rx.id, rx]));
    return {
      ...pharmacyQueueSchema.parse({
        ...base,
        prescriptions: [
          ...base.prescriptions.map((rx) => persisted.get(rx.id) ?? rx),
          ...state.prescriptions.filter((rx) => !base.prescriptions.some((x) => x.id === rx.id)),
        ],
      }),
      rev,
      stored: state.rx,
      incoming: state.incomingOrders,
    };
  }
  return notImplemented('farmasi');
}

/** Rekaman resep untuk Server Action (klien hanya mengirim id; id tidak dikenal → undefined). */
export async function findPrescription(
  session: SessionView,
  id: string,
): Promise<PharmacyPrescription | undefined> {
  const { results } = await scenarioRuns(session);
  return (await getPharmacyQueue(results)).prescriptions.find((rx) => rx.id === id);
}
