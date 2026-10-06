import 'server-only';
import {
  DESTRUCTION_ACTORS,
  LOAN_UNITS,
  RECORD_FILES,
  RECORD_LOANS,
  RETENTION_BATCHES,
  ROI_APPROVERS,
  ROI_REQUESTS,
} from '../../demo/fixtures/rekam-medis-adm';
import { patientById } from '../../demo/fixtures/pasien';
import { assertDemo } from '../demo-guard';
import { webEnv } from '../web-env';
import { notImplemented } from './not-implemented';

/**
 * Fase 8–9 · Pintu data layar back office (B02–B13, I09 command center, I11 dataset riset). Mode presentasi: data
 * dummy fiktif (ADR-0023); mode api menunggu backend fase 8–9 (registri layar berstatus `demo`, jalur ini tidak
 * tercapai di luar presentasi).
 */

function demoOnly(domain: string): void {
  if (webEnv().dataSource !== 'demo') notImplemented(domain);
  assertDemo();
}

/** B09 · peminjaman berkas, pelepasan informasi/hak subjek data, retensi dan pemusnahan. */
export async function getRecordsAdmin() {
  demoOnly('rekam medis administratif');
  return {
    files: RECORD_FILES,
    loans: RECORD_LOANS,
    loanUnits: LOAN_UNITS,
    requests: ROI_REQUESTS.map((r) => {
      const p = patientById(r.patientId);
      return { ...r, patientName: p?.nama ?? '—', rm: p?.rm ?? '—' };
    }),
    approvers: ROI_APPROVERS,
    batches: RETENTION_BATCHES,
    destructionActors: DESTRUCTION_ACTORS,
  };
}
export type RecordsAdminData = Awaited<ReturnType<typeof getRecordsAdmin>>;
