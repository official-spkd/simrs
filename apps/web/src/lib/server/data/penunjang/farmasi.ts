import 'server-only';
import {
  type DispenseView,
  dispenseViewSchema,
  type PharmacyIncoming,
  pharmacyIncomingSchema,
  type PharmacyPrescription,
  type PharmacyPrescriptionView,
  pharmacyPrescriptionViewSchema,
  type PharmacyQueue,
  type PharmacyQueueRow,
  pharmacyQueueRowSchema,
  pharmacyQueueSchema,
} from '@simrs/shared';
import { z } from 'zod';
import { demoPharmacyQueue } from '../../../demo/fixtures/penunjang';
import { prescriptionsWithStock, type SupportState } from '../../../penunjang-demo';
import type { ScenarioResults } from '../../../penunjang-skenario';
import { scenarioPrescriptions } from '../../../penunjang-skenario-farmasi';
import type { SessionView } from '../../../session-view';
import { api } from '../../api';
import { scenarioRuns } from '../../demo/scenario-context';
import { readDomain } from '../../demo/state';
import { notImplemented } from '../not-implemented';
import { isDemoData } from './shared';

/**
 * S04/S05 · Data layar Farmasi (telaah, penyiapan, serah terima). Mode presentasi: antrean dummy + resep pasien
 * skenario + keadaan tersimpan di toko demo `penunjang`. Mode api: telaah `/api/v1/pharmacy/*` (potongan 4.5);
 * penyiapan, serah terima, dan retur `/api/v1/dispensing/*` (4.6b).
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

// ─── Mode api (potongan 4.5) ─────────────────────────────────────────────────────────────────────────────────────

/** Kiriman CPOE ber-obat aktif yang belum diterima farmasi, ditujukan ke depo dalam lingkup sesi. */
export function getPharmacyIncomingApi(): Promise<PharmacyIncoming[]> {
  return api('/api/v1/pharmacy/incoming', { schema: z.array(pharmacyIncomingSchema) });
}

/** Resep farmasi di depo dalam lingkup: terbuka, atau selesai/batal 7 hari terakhir. */
export function getPharmacyQueueApi(): Promise<PharmacyQueueRow[]> {
  return api('/api/v1/pharmacy/prescriptions', { schema: z.array(pharmacyQueueRowSchema) });
}

/** Resep lengkap untuk telaah: item, temuan CDS terbaru, telaah, intervensi. */
export function getPharmacyPrescriptionApi(id: string): Promise<PharmacyPrescriptionView> {
  return api(`/api/v1/pharmacy/prescriptions/${id}`, { schema: pharmacyPrescriptionViewSchema });
}

// ─── Mode api (potongan 4.6b) ────────────────────────────────────────────────────────────────────────────────────

/** Penyiapan obat satu resep (terbaru dulu). */
export function getDispensesApi(prescriptionId: string): Promise<DispenseView[]> {
  return api(`/api/v1/dispensing/prescriptions/${prescriptionId}/dispenses`, {
    schema: z.array(dispenseViewSchema),
  });
}

/** Satu penyiapan untuk cetak etiket. */
export function getDispenseApi(dispenseId: string): Promise<DispenseView> {
  return api(`/api/v1/dispensing/dispenses/${dispenseId}`, { schema: dispenseViewSchema });
}
