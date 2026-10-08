import 'server-only';
import {
  type LabInboundIssue,
  labInboundIssueSchema,
  type LabOrderDetail,
  labOrderDetailSchema,
  type LabQcRun,
  labQcRunSchema,
  type LabSample,
  type LabTestDefinition,
  labTestDefinitionSchema,
  type LabWorklist,
  type LabWorklistItem,
  labWorklistItemSchema,
  labWorklistSchema,
} from '@simrs/shared';
import { z } from 'zod';
import { demoLabWorklist } from '../../../demo/fixtures/penunjang';
import type { SupportState } from '../../../penunjang-demo';
import { applyStoredReportToSample } from '../../../penunjang-kritis';
import { type ScenarioResults, scenarioLabSamples } from '../../../penunjang-skenario';
import type { SessionView } from '../../../session-view';
import { api } from '../../api';
import { scenarioRuns } from '../../demo/scenario-context';
import { readDomain } from '../../demo/state';
import { notImplemented } from '../not-implemented';
import { isDemoData } from './shared';

/**
 * S01 · Data layar Laboratorium. Mode presentasi: worklist dummy + sampel pasien skenario + keadaan tersimpan di toko
 * demo (`penunjang`, `hasil-kritis`, ADR-0085). Mode api (potongan 4.2): pemuat `…Api` di bawah, ke `/api/v1/lab`.
 */

export type StoredLabWorklist = LabWorklist & {
  rev: number;
  stored: SupportState['labs'];
  incoming: SupportState['incomingOrders'];
};

/**
 * Worklist laboratorium; `scenario` = hasil replay simulasi sesi ini (`scenarioRuns(session).results`). Laporan
 * nilai kritis yang tersimpan di toko demo (domain `hasil-kritis`, ADR-0085) diterapkan ke sampelnya.
 */
export async function getLabWorklist(scenario: ScenarioResults): Promise<StoredLabWorklist> {
  if (isDemoData()) {
    const base = demoLabWorklist(scenarioLabSamples(scenario));
    const { state } = await readDomain('hasil-kritis');
    const support = await readDomain('penunjang');
    const persisted = new Map(support.state.samples.map((s) => [s.id, s]));
    return {
      ...labWorklistSchema.parse({
        ...base,
        samples: [
          ...base.samples.map((s) => persisted.get(s.id) ?? s),
          ...support.state.samples.filter((s) => !base.samples.some((x) => x.id === s.id)),
        ].map((s) => applyStoredReportToSample(s, state)),
        stats: {
          ...base.stats,
          samplesToday:
            base.stats.samplesToday +
            support.state.incomingOrders.filter((x) => x.dest === 'lab' && !x.reason).length,
        },
      }),
      rev: support.rev,
      stored: support.state.labs,
      incoming: support.state.incomingOrders,
    };
  }
  return notImplemented('laboratorium');
}

/*
 * Rekaman untuk Server Action: dicari server lewat jalur data yang sama dengan halaman (fixture + proyeksi pasien
 * skenario sesi ini), sehingga action tidak memercayai atribut keselamatan kiriman klien (kontras, modalitas,
 * nilai kritis, peringatan CDS, obat high alert). Klien hanya mengirim id; id yang tidak dikenal → undefined.
 */

export async function findLabSample(session: SessionView, id: string): Promise<LabSample | undefined> {
  const { results } = await scenarioRuns(session);
  return (await getLabWorklist(results)).samples.find((s) => s.id === id);
}

// ═════════════════════════════ Mode api (potongan 4.2) ═════════════════════════════

/** Worklist unit lab: order CPOE baru (belum diterima) + order lab aktif, atau yang selesai ≤ 7 hari. */
export function getLabWorklistApi(view: 'aktif' | 'selesai'): Promise<LabWorklistItem[]> {
  return api(`/api/v1/lab/worklist?view=${view}&limit=200`, { schema: z.array(labWorklistItemSchema) });
}

/** Detail order lab (audit `read` di API). */
export function getLabOrderApi(id: string): Promise<LabOrderDetail> {
  return api(`/api/v1/lab/orders/${encodeURIComponent(id)}`, { schema: labOrderDetailSchema });
}

/** Pesan analyzer gagal/berhenti diproses (tanpa isi pesan). */
export function getLabInboundIssuesApi(): Promise<LabInboundIssue[]> {
  return api('/api/v1/lab/inbound-issues', { schema: z.array(labInboundIssueSchema) });
}

export function getLabTestsApi(): Promise<LabTestDefinition[]> {
  return api('/api/v1/lab/tests', { schema: z.array(labTestDefinitionSchema) });
}

export function getLabQcApi(): Promise<LabQcRun[]> {
  return api('/api/v1/lab/qc', { schema: z.array(labQcRunSchema) });
}
