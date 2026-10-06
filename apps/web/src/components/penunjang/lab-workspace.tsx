'use client';

import { formatJam, type LabSample } from '@simrs/shared';
import { KpiCard } from '@simrs/ui';
import { useMemo, useState } from 'react';
import { receiveLabAction, resampleLabAction, validateLabAction } from '@/app/(staf)/penunjang/lab/actions';
import { useStoreAction } from '@/lib/demo/store/client';
import type { StoredLabWorklist } from '@/lib/server/data/penunjang';
import {
  applyLabLocal,
  criticalOpen,
  criticalStage,
  formatLabNumber,
  labFlowStage,
  pendingCount,
  sampleStatusView,
  sortWorklist,
} from '@/lib/penunjang';
import { criticalIdOfLab } from '@/lib/penunjang-kritis';
import type { ScenarioTaskHook } from '@/lib/penunjang-skenario';
import { CriticalBanner } from './lab-critical-banner';
import { LabDetail } from './lab-detail';
import { LabFlow } from './lab-flow';
import { LabWorklistPanel } from './lab-worklist';
import { useScenarioTasks } from './use-scenario-tasks';

/**
 * S01/S09 · Ruang kerja Laboratorium (mockup Lab): KPI, banner nilai kritis, worklist, hasil terpilih, alur
 * validasi. Pelaporan nilai kritis tersimpan di toko demo bersama (ADR-0085) dan datang kembali lewat `data`;
 * validasi dan sampel ulang tersimpan dalam toko demo bersama;
 * pasien skenario mengikuti mesin simulasi.
 */
export function LabWorkspace({
  role,
  data,
  hook,
  initialSelected,
  criticalRev,
  storedCritical,
}: {
  role: string | null;
  data: StoredLabWorklist;
  hook: ScenarioTaskHook;
  initialSelected: string | null;
  userName: string;
  /** Revisi domain toko `hasil-kritis` (dikirim bersama pelaporan). */
  criticalRev: number;
  /** Id hasil kritis yang laporannya tersimpan di toko (banner "dilaporkan" tetap tampil setelah muat ulang). */
  storedCritical: readonly string[];
}) {
  const tasks = useScenarioTasks(hook);
  const local = data.stored;
  const [feedback, setFeedback] = useState<Record<string, string>>({});
  const { run, pending: busy } = useStoreAction(data.rev);
  const samples = useMemo(
    () => sortWorklist(data.samples.map((s) => applyLabLocal(s, local[s.id]))),
    [data.samples, local],
  );
  const [selected, setSelected] = useState<string>(initialSelected ?? '');
  const sel = samples.find((s) => s.id === selected) ?? samples[0];

  const select = (id: string) => {
    setSelected(id);
    try {
      window.history.replaceState(null, '', `?pilih=${encodeURIComponent(id)}`);
    } catch {
      // URL hanya kenyamanan (tautan langsung ke sampel).
    }
  };
  const say = (id: string, message: string) => setFeedback((f) => ({ ...f, [id]: message }));
  const validate = (s: LabSample, level: 'teknis' | 'klinis') =>
    run(
      (rev) => validateLabAction({ sampleId: s.id, level }, rev),
      (r) => say(s.id, r.message),
    );
  const resample = (s: LabSample) =>
    run(
      (rev) => resampleLabAction({ sampleId: s.id, cancel: !!local[s.id]?.resampleAt }, rev),
      (r) => say(s.id, r.message),
    );

  const open = samples.filter(criticalOpen).length;
  const stored = new Set(storedCritical);
  const banners = samples.filter(
    (s) =>
      s.critical &&
      (criticalOpen(s) ||
        stored.has(criticalIdOfLab(s)) ||
        (criticalStage(s.critical) === 'selesai' && tasks.scenarioOf(s.patient.id))),
  );
  const st = data.stats;

  return (
    <>
      <div
        role="region"
        aria-label="Indikator laboratorium"
        className="grid grid-cols-2 gap-3.5 xl:grid-cols-4"
      >
        <KpiCard
          label="Sampel hari ini"
          value={formatLabNumber(st.samplesToday, 0)}
          detail={`${st.awaitingValidation} menunggu validasi`}
          tinted
        />
        <KpiCard
          label="TAT rata-rata (rutin)"
          value={`${st.tatRoutineMinutes} mnt`}
          hint={`target ≤ ${st.tatRoutineTarget} mnt`}
          tone={st.tatRoutineMinutes <= st.tatRoutineTarget ? 'success' : 'danger'}
          tinted
        />
        <KpiCard
          label="TAT cito"
          value={`${st.tatCitoMinutes} mnt`}
          hint={`target ≤ ${st.tatCitoTarget} mnt`}
          tone={st.tatCitoMinutes <= st.tatCitoTarget ? 'success' : 'danger'}
          tinted
        />
        <KpiCard
          label="Nilai kritis terbuka"
          value={String(open)}
          hint={open ? 'belum dilaporkan dengan read-back' : 'semua sudah dilaporkan'}
          tone={open ? 'danger' : 'success'}
          tinted
        />
      </div>

      <div className="flex flex-wrap items-start gap-5">
        <LabWorklistPanel
          rows={samples.map((s) => ({
            sample: s,
            status: sampleStatusView(s, !!local[s.id]?.resampleAt),
            criticalOpen: criticalOpen(s),
          }))}
          selected={sel?.id ?? ''}
          onSelect={select}
        />
        <div className="@container flex min-w-0 flex-[999_1_480px] flex-col gap-4">
          {banners.map((s) => (
            <CriticalBanner
              key={s.id}
              sample={s}
              scenario={tasks.scenarioOf(s.patient.id)}
              tasks={tasks}
              rev={criticalRev}
            />
          ))}
          {sel && (
            <>
              <LabDetail
                role={role}
                sample={sel}
                resample={local[sel.id]?.resampleAt ? formatJam(local[sel.id]?.resampleAt ?? '') : null}
                scenario={tasks.scenarioOf(sel.patient.id)}
                tasks={tasks}
                busy={busy}
                feedback={feedback[sel.id] ?? null}
                onValidate={(level) => validate(sel, level)}
                onReceive={(specimen, identityConfirmed) =>
                  run(
                    (rev) => receiveLabAction({ sampleId: sel.id, specimen, identityConfirmed }, rev),
                    (r) => say(sel.id, r.message),
                  )
                }
                onResample={() => resample(sel)}
              />
              <LabFlow stage={labFlowStage(sel, !!local[sel.id]?.resampleAt)} pending={pendingCount(sel)} />
            </>
          )}
        </div>
      </div>
    </>
  );
}
