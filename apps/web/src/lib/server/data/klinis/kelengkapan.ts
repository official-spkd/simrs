import 'server-only';
import { consentIdOf } from '../../../demo/fixtures/pasien';
import { closeChecklist, patientDocuments } from '../../../demo/fixtures/rme-kelengkapan';
import { demoHendroConsent } from '../../../demo/fixtures/rawat-inap';
import type { RmeChart } from '../../../demo/fixtures/rme-pasien';
import { documentsOf } from '../../../rme-kelengkapan-toko';
import type { CheckItem, PatientDocument } from '../../../rme-kelengkapan';
import type { RekamState } from '../../../rme-toko';
import { readDomain } from '../../demo/state';
import { assessmentsOf, diagnosisListsOf, eduRecordsOf } from './rme';

/**
 * K13 · Data layar Kelengkapan rekam medis dari toko demo (ADR-0085): dokumen + daftar periksa dihitung dari rekam
 * yang sama dengan layar asal (asesmen, CPPT/co-sign, diagnosis, edukasi di `rekam-medis`; resume final di
 * `resume-medis`; persetujuan tindakan di `persetujuan`). Dipakai halaman dan Server Action.
 */

export interface KelengkapanView {
  docs: PatientDocument[];
  items: CheckItem[];
  closed: RekamState['closed'][string] | null;
  death: RekamState['deaths'][string] | null;
}

export async function kelengkapanView(chart: RmeChart, state: RekamState): Promise<KelengkapanView> {
  const [resume, consent] = await Promise.all([readDomain('resume-medis'), readDomain('persetujuan')]);
  const enc = chart.encounterId;
  const fin = resume.state.final[enc];
  const consentId = consentIdOf(chart.patientId);
  const decided = consent.state.docs[consentId];
  // Dokumen persetujuan fixture non-skenario yang punya kunjungan ini (Tn. Hendro).
  const hendro = demoHendroConsent();
  const consents =
    decided && hendro.id === consentId && hendro.encounterId === enc
      ? [
          {
            id: consentId,
            procedure: hendro.procedure,
            status: decided.status,
            at: decided.at,
            by: decided.by,
            reason: decided.reason,
          },
        ]
      : [];
  const base = patientDocuments(chart);
  const docs = documentsOf(base, state, enc, {
    resumeFinal: fin ? { at: fin.at, by: fin.by } : null,
    consents,
  });
  const items = closeChecklist(chart, docs, {
    responses: assessmentsOf(chart, state),
    dx: diagnosisListsOf(chart, state).dx,
    edu: eduRecordsOf(enc, state),
    baseDocs: base,
  });
  return { docs, items, closed: state.closed[enc] ?? null, death: state.deaths[enc] ?? null };
}
