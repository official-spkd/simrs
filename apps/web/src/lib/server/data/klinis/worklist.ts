import 'server-only';
import type { CpptEntry } from '@simrs/shared';
import { patientById } from '../../../demo/fixtures/pasien';
import { nursingPlan, SHIFT_EVALS } from '../../../demo/fixtures/rme-askep';
import { CONSULTS } from '../../../demo/fixtures/rme-konsul';
import { demoRmeCharts, rmeChartByEncounter } from '../../../demo/fixtures/rme-pasien';
import { resumeFinals } from '../../../rawat-inap-resume-toko';
import { latestResponse } from '../../../rme-asesmen';
import { consultAnswered, consultsOf } from '../../../rme-konsul-toko';
import { askepView } from '../../../rme-toko';
import type { WorklistTask } from '../../../rme-worklist';
import type { CriticalNotice, WorklistSources } from '../../../rme-worklist-toko';
import type { SessionView } from '../../../session-view';
import { readDomain } from '../../demo/state';
import { getCriticalCenter } from '../penunjang/kritis';
import { readRekam, REKAM_DATE, verifiedOf, withRekam } from './rekam';
import { assessmentsOf } from './rme';

/**
 * K01 · Sumber status worklist dari toko demo (ADR-0085): rekam `rekam-medis` (co-sign, verifikasi, eMAR, penyelesaian
 * langsung) dan laporan nilai kritis domain `hasil-kritis` (dibaca lewat Pusat hasil kritis, sumber yang sama dengan
 * layar Laboratorium). Domain lain (resume, konsul) ditambahkan pemanggil.
 */

type Extra = Pick<WorklistSources, 'resumeFinal' | 'consultAnswered' | 'assessed' | 'askepEvaluated'>;

/**
 * Sumber dari domain/layar lain untuk tugas worklist: resume final (`resume-medis`), konsul dijawab, asesmen final
 * terbaru per formulir, evaluasi askep shift pagi lengkap (semua di `rekam-medis`).
 */
export async function worklistExtras(tasks: readonly WorklistTask[]): Promise<{ extra: Extra; rev: number }> {
  const [{ state, rev }, resume] = await Promise.all([readRekam(), readDomain('resume-medis')]);
  const assessed: Record<string, { by: string; at: string }> = {};
  const askepEvaluated: Record<string, { by: string; at: string }> = {};
  for (const t of tasks) {
    const chart = rmeChartByEncounter(t.encounterId);
    if (!chart) continue;
    if (t.ref?.kind === 'asesmen') {
      const last = latestResponse(assessmentsOf(chart, state), t.ref.formCode);
      if (last) assessed[`${t.encounterId}|${t.ref.formCode}`] = { by: last.by, at: last.at };
    }
    if (t.ref?.kind === 'askep-evaluasi' && chart.inpatient) {
      const { dxs, evals } = askepView(
        {
          ...nursingPlan(chart.inpatient),
          evals: SHIFT_EVALS.filter((e) => e.dxId.startsWith(t.encounterId)),
        },
        state,
        t.encounterId,
      );
      const today = evals.filter((e) => e.shift === 'pagi' && e.date === REKAM_DATE);
      const last = [...today].sort((a, b) => a.at.localeCompare(b.at)).at(-1);
      if (last && dxs.every((d) => today.some((e) => e.dxId === d.id))) {
        askepEvaluated[t.encounterId] = { by: last.by, at: last.at };
      }
    }
  }
  return {
    rev,
    extra: {
      resumeFinal: resumeFinals(resume.state),
      consultAnswered: consultAnswered(consultsOf(CONSULTS, state)),
      assessed,
      askepEvaluated,
    },
  };
}

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
