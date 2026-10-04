'use client';

import type { RadiologyExam, RadiologyWorklist } from '@simrs/shared';
import { KpiCard } from '@simrs/ui';
import { useMemo, useState, useTransition } from 'react';
import {
  finishExamAction,
  signReportAction,
  startExamAction,
} from '@/app/(staf)/penunjang/radiologi/actions';
import { RADIOLOG } from '@/lib/demo/fixtures/penunjang';
import { demoNow } from '@/lib/demo/fixtures/waktu';
import type { PenunjangActionResult } from '@/lib/penunjang-aksi';
import { applyRadLocal, type RadLocal, sortExams } from '@/lib/penunjang-radiologi';
import { RadBoard } from './rad-board';
import { RadDetail, type RadHandlers } from './rad-detail';
import { type RadFilter, RadWorklist } from './rad-worklist';

function durasi(min: number): string {
  const h = Math.floor(min / 60);
  return h ? `${h} j ${min % 60} mnt` : `${min} mnt`;
}

/**
 * S03 · Ruang kerja Radiologi: KPI, papan modalitas, worklist berfilter, dan rincian pemeriksaan dengan langkah
 * mulai → akuisisi (dosis CT) → ekspertise → TTE radiolog. Tindakan disimulasikan (tidak disimpan).
 */
export function RadWorkspace({
  data,
  initialSelected,
}: {
  data: RadiologyWorklist;
  initialSelected: string | null;
}) {
  const [local, setLocal] = useState<Record<string, RadLocal>>({});
  const [filter, setFilter] = useState<RadFilter>('semua');
  const [selected, setSelected] = useState(initialSelected ?? '');
  const [msg, setMsg] = useState<Record<string, { ok: boolean; text: string }>>({});
  const [busy, startTransition] = useTransition();
  const exams = useMemo(
    () => sortExams(data.exams.map((e) => applyRadLocal(e, local[e.id]))),
    [data.exams, local],
  );
  const shown = filter === 'semua' ? exams : exams.filter((e) => e.status === filter);
  const sel = exams.find((e) => e.id === selected) ?? shown[0] ?? exams[0];
  const count = (f: RadFilter) => (f === 'semua' ? exams.length : exams.filter((e) => e.status === f).length);
  const counts = {
    semua: count('semua'),
    terjadwal: count('terjadwal'),
    berlangsung: count('berlangsung'),
    ekspertise: count('ekspertise'),
    ditandatangani: count('ditandatangani'),
  };

  const select = (id: string) => {
    setSelected(id);
    try {
      window.history.replaceState(null, '', `?pilih=${encodeURIComponent(id)}`);
    } catch {
      // URL hanya kenyamanan.
    }
  };
  const call = (e: RadiologyExam, action: () => Promise<PenunjangActionResult>, onOk: () => RadLocal) =>
    startTransition(async () => {
      const r = await action();
      setMsg((m) => ({ ...m, [e.id]: { ok: r.ok, text: r.message } }));
      if (!r.ok) return;
      const next = onOk(); // cap waktu dibuat di penangan, bukan di dalam updater state
      setLocal((cur) => ({ ...cur, [e.id]: { ...cur[e.id], ...next } }));
    });
  // Cap waktu catatan lokal memakai jam demo (hari presentasi), bukan jam dinding.
  const handlers = (e: RadiologyExam): RadHandlers => ({
    onStart: (identity, contrast) =>
      call(
        e,
        () => startExamAction({ examId: e.id, identityChecked: identity, contrastChecked: contrast }),
        () => ({ startedAt: demoNow().toISOString() }),
      ),
    onFinish: (ctdiVol, dlp) =>
      call(
        e,
        () => finishExamAction({ examId: e.id, ctdiVol, dlp }),
        () => ({
          finishedAt: demoNow().toISOString(),
          dose: ctdiVol !== null && dlp !== null && e.modality === 'CT' ? { ctdiVol, dlp } : null,
        }),
      ),
    onSign: (findings, impression) =>
      call(
        e,
        () => signReportAction({ examId: e.id, findings, impression }),
        () => ({
          report: { findings, impression, radiologist: RADIOLOG, signedAt: demoNow().toISOString() },
        }),
      ),
  });

  const waiting = counts.ekspertise;
  const citoOpen = exams.filter((e) => e.priority === 'cito' && e.status !== 'ditandatangani').length;
  const today = data.modalities.reduce((a, m) => a + m.slotsUsed, 0);
  const m = sel ? msg[sel.id] : undefined;

  return (
    <>
      <div role="region" aria-label="Indikator radiologi" className="grid grid-cols-2 gap-3.5 xl:grid-cols-4">
        <KpiCard
          label="Pemeriksaan hari ini"
          value={String(today)}
          detail="semua modalitas, termasuk portabel"
          tinted
        />
        <KpiCard
          label="Menunggu ekspertise"
          value={String(waiting)}
          hint={waiting ? 'perlu dibaca radiolog' : 'semua sudah dibaca'}
          tone={waiting ? 'warning' : 'success'}
          tinted
        />
        <KpiCard
          label="Cito terbuka"
          value={String(citoOpen)}
          hint={citoOpen ? 'prioritaskan' : 'tidak ada'}
          tone={citoOpen ? 'danger' : 'success'}
          tinted
        />
        <KpiCard
          label="TAT ekspertise (rutin)"
          value={durasi(data.stats.tatExpertiseMinutes)}
          hint={`target ≤ ${durasi(data.stats.tatExpertiseTarget)}`}
          tone={data.stats.tatExpertiseMinutes <= data.stats.tatExpertiseTarget ? 'success' : 'danger'}
          tinted
        />
      </div>
      <RadBoard modalities={data.modalities} />
      <div className="flex flex-wrap items-start gap-5">
        <RadWorklist
          exams={shown}
          counts={counts}
          filter={filter}
          selected={sel?.id ?? ''}
          onFilter={setFilter}
          onSelect={select}
        />
        <div className="@container flex min-w-0 flex-[999_1_480px] flex-col">
          {sel && (
            <RadDetail
              exam={sel}
              busy={busy}
              error={m && !m.ok ? m.text : null}
              feedback={m?.ok ? m.text : null}
              handlers={handlers(sel)}
            />
          )}
        </div>
      </div>
    </>
  );
}
