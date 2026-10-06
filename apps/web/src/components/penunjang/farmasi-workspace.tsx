'use client';

import { type DispenseStage, type PharmacyPrescription } from '@simrs/shared';
import { TabList, TabPanel } from '@simrs/ui';
import { type ReactNode, useId, useMemo, useState } from 'react';
import {
  cdsFollowUpAction,
  checkRxItemAction,
  dispenseRxAction,
  doubleCheckAction,
  prepareRxAction,
  reviewRxAction,
} from '@/app/(staf)/penunjang/farmasi/actions';
import { useStoreAction } from '@/lib/demo/store/client';
import type { StoredPharmacyQueue } from '@/lib/server/data/penunjang';
import type { PenunjangActionResult } from '@/lib/penunjang-aksi';
import { applyRxLocal, dispenseLines, rxTag, type RxLocal, type RxReceiver } from '@/lib/penunjang-farmasi';
import type { ScenarioTaskHook } from '@/lib/penunjang-skenario';
import type { FarmasiHandlers } from './farmasi-detail';
import { FarmasiDetailFor, FlashBar } from './farmasi-parts';
import { FarmasiQueue } from './farmasi-queue';
import { useRxLocal } from './use-rx-local';
import { useScenarioTasks } from './use-scenario-tasks';

export type FarmasiTab = 'telaah' | 'siap' | 'serah';
const TAB_LABEL: Record<FarmasiTab, string> = { telaah: 'Telaah', siap: 'Penyiapan', serah: 'Serah terima' };
const RECEIVER_LABEL = { pasien: 'pasien', keluarga: 'keluarga pasien', perawat: 'perawat ruangan' } as const;

interface Flash {
  text: string;
  lines?: string[];
  next?: FarmasiTab;
}

/** S04/S05 · Kemajuan resep disimpan di toko demo bersama; pasien skenario mengikuti mesin simulasi. */
export function FarmasiWorkspace({
  heading,
  banner,
  role,
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
  role: string | null;
  data: StoredPharmacyQueue;
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
  const [draft, patch] = useRxLocal(data.prescriptions, userName);
  const [receivers, setReceivers] = useState<Record<string, RxReceiver>>({});
  const local: Record<string, RxLocal> = Object.fromEntries(
    data.prescriptions.map((p) => [
      p.id,
      tasks.scenarioOf(p.patient.id)
        ? (draft[p.id] ?? {})
        : { ...data.stored[p.id], receiver: receivers[p.id] ?? data.stored[p.id]?.receiver },
    ]),
  );
  const [flash, setFlash] = useState<Flash | null>(null);
  const [errors, setErrors] = useState<Record<string, string>>({});
  const { run, pending } = useStoreAction(data.rev);
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
    action: (rev: number) => Promise<PenunjangActionResult>,
    onOk?: (r: PenunjangActionResult) => void,
  ) =>
    run(action, (r) => {
      setErrors((e) => ({ ...e, [id]: r.ok ? '' : r.message }));
      if (r.ok) onOk?.(r);
    });
  const handlers = (p: PharmacyPrescription): FarmasiHandlers => {
    const rj = tasks.scenarioOf(p.patient.id) === 'rawat-jalan';
    const name = p.patient.name;
    return {
      onCds: (alert, action, reason) =>
        call(p.id, (rev) => cdsFollowUpAction({ rxId: p.id, alertId: alert.id, action, reason }, rev)),
      onApprove: () => {
        const next = {
          text: `Resep ${name} lolos telaah dan masuk antrean penyiapan.`,
          next: 'siap' as const,
        };
        if (rj) return tasks.runTask('rawat-jalan', 'telaah', true, (ok) => ok && setFlash(next));
        call(
          p.id,
          (rev) => reviewRxAction({ rxId: p.id, decision: 'setujui' }, rev),
          () => setFlash(next),
        );
      },
      onHoldToggle: () =>
        call(p.id, (rev) =>
          reviewRxAction({ rxId: p.id, decision: local[p.id]?.hold ? 'lepas' : 'tahan' }, rev),
        ),
      onPartial: () => call(p.id, (rev) => reviewRxAction({ rxId: p.id, decision: 'sebagian' }, rev)),
      onToggle: (kind, index, checked) => {
        if (rj) return patch(p.id, (c) => ({ ...c, [kind]: { ...c[kind], [index]: checked } }));
        call(p.id, (rev) => checkRxItemAction({ rxId: p.id, kind, index, checked }, rev));
      },
      onReceiver: (receiver) => {
        if (rj) return patch(p.id, (c) => ({ ...c, receiver }));
        setReceivers((cur) => ({ ...cur, [p.id]: receiver }));
      },
      onDoubleCheck: (second) => call(p.id, (rev) => doubleCheckAction({ rxId: p.id, second }, rev)),
      onDone: (receiver) => {
        if (tab === 'siap') {
          const next = {
            text: `Obat ${name} selesai disiapkan dan masuk antrean serah terima.`,
            next: 'serah' as const,
          };
          if (rj) return tasks.runTask('rawat-jalan', 'siap', true, (ok) => ok && setFlash(next));
          return call(
            p.id,
            (rev) => prepareRxAction({ rxId: p.id }, rev),
            () => setFlash(next),
          );
        }
        if (!receiver) return;
        if (rj) {
          if (receiver === 'perawat') return;
          return tasks.runTask(
            'rawat-jalan',
            'serah',
            receiver,
            (ok) =>
              ok &&
              setFlash({
                text: `Obat ${name} diserahkan ke ${RECEIVER_LABEL[receiver]} (simulasi).`,
                lines: dispenseLines(p),
              }),
          );
        }
        call(
          p.id,
          (rev) => dispenseRxAction({ rxId: p.id, receiver }, rev),
          () => setFlash({ text: `Serah terima obat ${name} kepada ${RECEIVER_LABEL[receiver]} tersimpan.` }),
        );
      },
    };
  };

  const detail = rx ? (
    <FarmasiDetailFor
      role={role}
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
