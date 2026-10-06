import 'server-only';
import { type ConsentDocument, consentDocumentSchema } from '@simrs/shared';
import { CONSENT_ID } from '../../../demo/fixtures/ids';
import { demoHendroConsent } from '../../../demo/fixtures/rawat-inap';
import { applyConsent } from '../../../rawat-inap-consent-toko';
import {
  consentScenarioWait,
  hartonoConsent,
  ratnaConsent,
  reached,
  type ScenarioStepState,
} from '../../../rawat-inap-scenario';
import type { SessionView } from '../../../session-view';
import { scenarioRuns } from '../../demo/scenario-context';
import { readDomain } from '../../demo/state';
import { assertDemo } from '../../demo-guard';
import { webEnv } from '../../web-env';
import { notImplemented } from '../not-implemented';
import { scenarioSteps } from './shared';

/**
 * K11 · Data tablet Persetujuan tindakan. Mode presentasi: dokumen fiktif + keputusan tersimpan di toko demo
 * (`persetujuan`, ADR-0085) + persetujuan pasien skenario, divalidasi
 * kontrak yang sama dengan API kelak; mode api menunggu backend fase 3 (potongan 3.7, layar W5a; halaman menampilkan
 * "Belum tersambung").
 */

/**
 * Dokumen persetujuan tindakan di tablet; null = dokumen tidak dikenal (halaman → 404). Persetujuan Tn. Hartono
 * baru ada setelah langkah tata laksana dimulai (sebelum itu belum ada tindakan yang disetujui).
 */
export async function getConsentDocument(session: SessionView, id: string): Promise<ConsentDocument | null> {
  if (webEnv().dataSource === 'demo') {
    assertDemo();
    const runs = await scenarioRuns(session);
    const igd = runs.results['igd-ranap'];
    const doc =
      id === CONSENT_ID.hartono
        ? reached(igd, 'tata-laksana')
          ? hartonoConsent(igd)
          : null
        : id === CONSENT_ID.ratna
          ? ratnaConsent(runs.results['elektif-btn'])
          : id === CONSENT_ID.hendro
            ? applyConsent(demoHendroConsent(), (await readDomain('persetujuan')).state)
            : null;
    return doc ? consentDocumentSchema.parse(doc) : null;
  }
  return notImplemented('persetujuan tindakan');
}

/**
 * Giliran tablet persetujuan: dokumen milik skenario hanya diproses pada giliran tugasnya (`wait` = alasan menunggu,
 * null = boleh); `step` dipakai tombol TTE untuk memajukan skenario.
 */
export async function consentTurn(
  session: SessionView,
  doc: Pick<ConsentDocument, 'id' | 'status'>,
): Promise<{ step: ScenarioStepState | null; wait: string | null }> {
  const [step] =
    doc.id === CONSENT_ID.hartono ? await scenarioSteps(session, [['igd-ranap', 'tata-laksana']]) : [];
  return { step: step ?? null, wait: consentScenarioWait(doc, step?.tasks.consent) };
}
