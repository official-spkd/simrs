import 'server-only';
import type { CpptEntry } from '@simrs/shared';
import { patientById } from '../../../demo/fixtures/pasien';
import { demoRmeCharts } from '../../../demo/fixtures/rme-pasien';
import type { WorklistTask } from '../../../rme-worklist';
import type { CriticalNotice, WorklistSources } from '../../../rme-worklist-toko';
import type { SessionView } from '../../../session-view';
import { getCriticalCenter } from '../penunjang-lanjut';
import { readRekam, verifiedOf, withRekam } from './rekam';

/**
 * K01 · Sumber status worklist dari toko demo (ADR-0085): rekam `rekam-medis` (co-sign, verifikasi, eMAR, penyelesaian
 * langsung) dan laporan nilai kritis domain `hasil-kritis` (dibaca lewat Pusat hasil kritis, sumber yang sama dengan
 * layar Laboratorium). Domain lain (resume, konsul) ditambahkan pemanggil.
 */

/** Semua entri CPPT bagan RME rawat inap (rekam awal + toko), per id. */
export async function cpptIndex(): Promise<Map<string, CpptEntry>> {
  const { state } = await readRekam();
  const map = new Map<string, CpptEntry>();
  for (const c of demoRmeCharts()) {
    if (!c.inpatient) continue;
    for (const e of withRekam(c.inpatient, state).cppt) map.set(e.id, e);
  }
  for (const c of state.cppt) map.set(c.entry.id, c.entry);
  return map;
}

/** Nilai kritis lintas unit dengan status pelaporan (fixture + toko `hasil-kritis`). */
export async function criticalNotices(session: SessionView): Promise<CriticalNotice[]> {
  const center = await getCriticalCenter(session);
  return center.items.map((i) => ({
    rm: i.patient.rm,
    test: i.test,
    valueText: i.valueText,
    report: i.report
      ? {
          recipient: i.report.recipient,
          recipientRole: i.report.recipientRole,
          reportedBy: i.report.reportedBy,
          reportedAt: i.report.reportedAt,
        }
      : null,
  }));
}

export async function worklistSources(
  session: SessionView,
  tasks: readonly WorklistTask[],
  extra: Partial<
    Pick<WorklistSources, 'resumeFinal' | 'consultAnswered' | 'assessed' | 'askepEvaluated'>
  > = {},
): Promise<WorklistSources> {
  const [{ state }, index, critical] = await Promise.all([
    readRekam(),
    cpptIndex(),
    criticalNotices(session),
  ]);
  const ids = tasks.flatMap((t) => (t.ref?.kind === 'cppt' ? [t.ref.entryId] : []));
  const cosigned = Object.fromEntries(
    ids.flatMap((id) => {
      const e = index.get(id);
      return e?.cosignedBy && e.cosignedAt ? [[id, { by: e.cosignedBy, at: e.cosignedAt }]] : [];
    }),
  );
  const rmOf = Object.fromEntries(tasks.map((t) => [t.encounterId, patientById(t.patientId)?.rm ?? '']));
  return {
    state,
    cosigned,
    verified: verifiedOf(state, ids),
    resumeFinal: extra.resumeFinal ?? {},
    consultAnswered: extra.consultAnswered ?? {},
    assessed: extra.assessed ?? {},
    askepEvaluated: extra.askepEvaluated ?? {},
    rmOf,
    critical,
  };
}
