'use client';

import { type DispenseStage, formatJam, type PharmacyPrescription, type PharmacyQueue } from '@simrs/shared';
import { TabList, TabPanel } from '@simrs/ui';
import { type ReactNode, useId, useMemo, useState, useTransition } from 'react';
import {
  cdsFollowUpAction,
  dispenseRxAction,
  doubleCheckAction,
  prepareRxAction,
  reviewRxAction,
} from '@/app/(staf)/penunjang/farmasi/actions';
import { demoNow } from '@/lib/demo/fixtures/waktu';
import type { PenunjangActionResult } from '@/lib/penunjang-aksi';
import { type AlertAction, applyRxLocal, dispenseLines, rxTag } from '@/lib/penunjang-farmasi';
import type { ScenarioTaskHook } from '@/lib/penunjang-skenario';
import type { FarmasiHandlers } from './farmasi-detail';
import { FarmasiDetailFor, FlashBar } from './farmasi-parts';
import { FarmasiQueue } from './farmasi-queue';
import { useRxLocal } from './use-rx-local';
import { useScenarioTasks } from './use-scenario-tasks';

export type FarmasiTab = 'telaah' | 'siap' | 'serah';
const TAB_LABEL: Record<FarmasiTab, string> = { telaah: 'Telaah', siap: 'Penyiapan', serah: 'Serah terima' };
const STATE: Record<'usul' | 'setuju' | 'konfirmasi' | 'override', AlertAction> = {
  usul: 'diusulkan',
  setuju: 'disetujui',
  konfirmasi: 'dikonfirmasi',
  override: 'override',
};
const RECEIVER_LABEL = { pasien: 'pasien', keluarga: 'keluarga pasien', perawat: 'perawat ruangan' } as const;

interface Flash {
  text: string;
  lines?: string[];
  next?: FarmasiTab;
}

/**
 * S04/S05 · Ruang kerja Farmasi (mockup Farmasi): tab Telaah / Penyiapan / Serah terima atas antrean resep.
 * Tindakan disimulasikan (Server Action, tidak disimpan); kemajuan lokal per resep diingat di tab ini selama tahap
 * server resep itu tidak berubah (`useRxLocal`), termasuk saat halaman dibuat ulang setelah simulasi maju. Resep
 * Tn. Suryo memajukan tugas simulasi `farmasi.telaah → siap → serah` bila sedang giliran.
 */
export function FarmasiWorkspace({
  heading,
  banner,
  data,
  hook,
  userName,
  initialTab,
  initialSelected,
}: {
  /** Remah + judul halaman (kiri kepala; kanan = tab antrean). */
  heading: ReactNode;
  /** Banner skenario di antara kepala dan panel tab. */
  banner: ReactNode;
  data: PharmacyQueue;
  hook: ScenarioTaskHook;
  userName: string;
  initialTab: FarmasiTab;
  initialSelected: string | null;
}) {
  const tasks = useScenarioTasks(hook);
  const tabsId = useId();
  const [tab, setTab] = useState<FarmasiTab>(initialTab);
  const [sel, setSel] = useState<Partial<Record<FarmasiTab, string>>>(
    initialSelected ? { [initialTab]: initialSelected } : {},
  );
  const [local, patch] = useRxLocal(data.prescriptions, userName);
  const [flash, setFlash] = useState<Flash | null>(null);
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [pending, startTransition] = useTransition();
  const busy = pending || tasks.pending;

  const all = useMemo(
    () => data.prescriptions.map((rx) => applyRxLocal(rx, local[rx.id])),
    [data.prescriptions, local],
  );
  const rowsOf = (t: DispenseStage) =>
    all
      .filter((rx) => rx.stage === t)
      .sort((a, b) => Number(b.cito) - Number(a.cito) || a.writtenAt.localeCompare(b.writtenAt));
  const rows = rowsOf(tab);
  const rx = rows.find((r) => r.id === sel[tab]) ?? rows[0];

  const syncUrl = (t: FarmasiTab, id: string | undefined) => {
    try {
      window.history.replaceState(null, '', `?tab=${t}${id ? `&pilih=${encodeURIComponent(id)}` : ''}`);
    } catch {
      // URL hanya kenyamanan.
    }
  };
  const pickTab = (id: string) => {
    const t = id as FarmasiTab;
    setTab(t);
    syncUrl(t, sel[t]);
  };
  const pick = (id: string) => {
    setSel((s) => ({ ...s, [tab]: id }));
    syncUrl(tab, id);
  };

  const call = (
    id: string,
    action: () => Promise<PenunjangActionResult>,
    onOk: (r: PenunjangActionResult) => void,
  ) =>
    startTransition(async () => {
      const r = await action();
      setErrors((e) => ({ ...e, [id]: r.ok ? '' : r.message }));
      if (r.ok) onOk(r);
    });

  const handlers = (p: PharmacyPrescription): FarmasiHandlers => {
    const rj = tasks.scenarioOf(p.patient.id) === 'rawat-jalan';
    const name = p.patient.name;
    return {
      onCds: (alert, action, reason) =>
        call(
          p.id,
          () => cdsFollowUpAction({ rxId: p.id, alertId: alert.id, action, reason }),
          () => {
            // Catatan tindak lanjut memakai jam demo (hari presentasi), bukan jam dinding.
            const at = demoNow().toISOString();
            const jam = formatJam(at);
            const text =
              action === 'setuju'
                ? `Dokter menyetujui (${jam}): omeprazol diganti pantoprazol 40 mg IV 1×1. Interaksi teratasi.`
                : action === 'konfirmasi'
                  ? `${alert.recommendation ?? 'Ditinjau apoteker'} · dikonfirmasi ${jam}${alert.kind === 'dosis-ginjal' ? ', pantau anti-Xa' : ''}.`
                  : `${reason ?? ''} · ${jam}`;
            patch(p.id, (c) => ({
              ...c,
              alerts: { ...c.alerts, [alert.id]: { state: STATE[action], at, text } },
            }));
          },
        ),
      onApprove: () => {
        const next = {
          text: `Resep ${name} lolos telaah dan masuk antrean penyiapan.`,
          next: 'siap' as const,
        };
        if (rj) return tasks.runTask('rawat-jalan', 'telaah', true, (ok) => ok && setFlash(next));
        call(
          p.id,
          () => reviewRxAction({ rxId: p.id, decision: 'setujui' }),
          (r) => {
            patch(p.id, (c) => ({ ...c, stage: 'siap' }));
            setFlash({ ...next, text: `${next.text.slice(0, -1)} · ${r.at} (simulasi, tidak disimpan).` });
          },
        );
      },
      onHoldToggle: () => {
        const release = !!local[p.id]?.hold;
        call(
          p.id,
          () => reviewRxAction({ rxId: p.id, decision: release ? 'lepas' : 'tahan' }),
          () => patch(p.id, (c) => ({ ...c, hold: release ? undefined : demoNow().toISOString() })),
        );
      },
      onPartial: () =>
        call(
          p.id,
          () => reviewRxAction({ rxId: p.id, decision: 'sebagian' }),
          () => patch(p.id, (c) => ({ ...c, partial: demoNow().toISOString() })),
        ),
      onToggle: (kind, i, checked) => patch(p.id, (c) => ({ ...c, [kind]: { ...c[kind], [i]: checked } })),
      onReceiver: (receiver) => patch(p.id, (c) => ({ ...c, receiver })),
      onDoubleCheck: (second) =>
        call(
          p.id,
          () => doubleCheckAction({ rxId: p.id, second }),
          () => patch(p.id, (c) => ({ ...c, doubleCheck: { by: second, at: demoNow().toISOString() } })),
        ),
      onDone: (receiver) => {
        if (tab === 'siap') {
          const next = {
            text: `Obat ${name} selesai disiapkan dan masuk antrean serah terima.`,
            next: 'serah' as const,
          };
          if (rj) return tasks.runTask('rawat-jalan', 'siap', true, (ok) => ok && setFlash(next));
          return call(
            p.id,
            () => prepareRxAction({ rxId: p.id }),
            (r) => {
              patch(p.id, (c) => ({ ...c, stage: 'serah' }));
              setFlash({ ...next, text: `${next.text.slice(0, -1)} · ${r.at} (simulasi, tidak disimpan).` });
            },
          );
        }
        if (!receiver) return;
        const lines = dispenseLines(p);
        if (rj) {
          if (receiver === 'perawat') return;
          return tasks.runTask(
            'rawat-jalan',
            'serah',
            receiver,
            (ok) =>
              ok &&
              setFlash({ text: `Obat ${name} diserahkan ke ${RECEIVER_LABEL[receiver]} (simulasi).`, lines }),
          );
        }
        call(
          p.id,
          () => dispenseRxAction({ rxId: p.id, receiver }),
          (r) => {
            patch(p.id, (c) => ({ ...c, stage: 'selesai' }));
            setFlash({
              text: `Obat ${name} diserahkan ke ${RECEIVER_LABEL[receiver]} · ${r.at} (simulasi, tidak disimpan). Tercatat di eMAR dan billing.`,
              lines,
            });
          },
        );
      },
    };
  };

  const detail = rx ? (
    <FarmasiDetailFor
      tab={tab}
      rx={rx}
      local={local[rx.id]}
      rj={tasks.scenarioOf(rx.patient.id) === 'rawat-jalan'}
      enabled={(t) => tasks.enabled('rawat-jalan', t)}
      pharmacists={data.pharmacists}
      userName={userName}
      busy={busy}
      error={errors[rx.id] || (tasks.error?.message ?? null)}
      handlers={handlers(rx)}
    />
  ) : (
    <p className="m-0 rounded-card border border-dashed border-line-strong bg-white p-6 text-small text-ink-500">
      Tidak ada resep di antrean ini. Pilih tab lain.
    </p>
  );
  const body = (
    <div className="flex flex-col gap-4">
      {flash && <FlashBar flash={flash} onOpen={(t) => pickTab(t)} onClose={() => setFlash(null)} />}
      <div className="flex flex-wrap items-start gap-5">
        <FarmasiQueue
          label={`Antrean ${TAB_LABEL[tab].toLowerCase()}`}
          rows={rows.map((r) => ({ rx: r, tag: rxTag(r, local[r.id]) }))}
          selected={rx?.id ?? ''}
          onSelect={pick}
        />
        <div className="@container flex min-w-0 flex-[999_1_480px] flex-col">{detail}</div>
      </div>
    </div>
  );
  // Tab antrean di kanan kepala halaman (mockup: pil "Antrean"), banner skenario di antara kepala dan panel.
  return (
    <>
      <header className="flex flex-wrap items-center justify-between gap-3">
        {heading}
        <TabList
          label="Antrean"
          idBase={tabsId}
          value={tab}
          onChange={(t) => pickTab(t as FarmasiTab)}
          items={(['telaah', 'siap', 'serah'] as const).map((t) => ({
            id: t,
            label: `${TAB_LABEL[t]} · ${rowsOf(t).length}`,
          }))}
        />
      </header>
      {banner}
      <TabPanel key={tab} idBase={tabsId} value={tab}>
        {body}
      </TabPanel>
    </>
  );
}
