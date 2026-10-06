'use client';

import type { CpoeContext, CpoeOrderKind } from '@simrs/shared';
import { useState } from 'react';
import { sendOrdersAction } from '@/app/(staf)/klinis/order/actions-demo';
import { useStoreAction } from '@/lib/demo/store/client';
import {
  type CdsFix,
  cdsFixes,
  costEstimate,
  cpoeSendView,
  evaluateOrders,
  preSendChecks,
  SCENARIO_ORDER_NOTE,
  sendGate,
} from '@/lib/klinis-cds';
import { CpoeCatalog } from './cpoe-catalog';
import { CpoeOrderRow } from './cpoe-order-row';
import { CpoeResults } from './cpoe-results';
import { CpoeScenarioPanel, type ScenarioHandoff } from './cpoe-scenario-panel';
import { CpoeSummary, type SentInfo } from './cpoe-summary';
import { useCpoeOrders } from './use-cpoe-orders';
import { type ScenarioBinding, useScenarioTasks } from './use-scenario-tasks';

/** Gerbang CDS yang dibawakan tugas skenario (ikuti / override) pada satu item order. */
export interface ScenarioGate {
  catalogId: string;
  task: string;
  follow: string;
  override: string;
}

const GROUPS: ReadonlyArray<{ kind: CpoeOrderKind; title: string; dest: (igd: boolean) => string }> = [
  { kind: 'lab', title: 'LABORATORIUM', dest: () => 'Lab PK · sampel diambil hari ini' },
  { kind: 'radiologi', title: 'RADIOLOGI', dest: () => 'Radiologi · jadwal hari ini' },
  {
    kind: 'obat',
    title: 'OBAT',
    dest: (igd) => (igd ? 'Farmasi satelit IGD' : 'Farmasi rawat jalan · 30 hari'),
  },
  {
    kind: 'tindakan',
    title: 'TINDAKAN',
    dest: (igd) => (igd ? 'IGD · dikerjakan segera' : 'Poli · dikerjakan hari ini'),
  },
  { kind: 'kontrol', title: 'TINDAK LANJUT', dest: () => 'Otomatis' },
];

/**
 * Tiga kolom CPOE (mockup CPOE): katalog + order set | order per jenis dengan CDS | ringkasan + kirim (TTE).
 * Kunjungan pasien skenario (`scenarioOwned`) mengikuti langkah Simulasi: semua baris draf terkunci, katalog dan
 * order set nonaktif, dan pengiriman hanya lewat tugas skenario yang sedang giliran (gerbang CDS selesai lebih
 * dulu), sehingga yang ditandatangani persis daftar order di layar.
 */
export function CpoeWorkspace({
  ctx,
  signer,
  binding,
  scenarioOwned,
  scenarioGate,
  sendTask,
  handoff,
  links,
  rev,
  lastSent,
}: {
  ctx: CpoeContext;
  signer: string;
  binding: ScenarioBinding | null;
  scenarioOwned: boolean;
  scenarioGate: ScenarioGate | null;
  sendTask: string | null;
  handoff: ScenarioHandoff | null;
  links: ReadonlyArray<{ href: string; label: string }>;
  /** Revisi toko `klinis-order` yang dilihat layar. */
  rev: number;
  /** Kiriman terakhir tersimpan (banner "N order terkirim pukul …" setelah muat ulang). */
  lastSent: { count: number; at: string; by: string } | null;
}) {
  const tasks = useScenarioTasks(binding);
  const gateTask = scenarioGate ? tasks.task(scenarioGate.task) : undefined;
  const gateOpen = Boolean(scenarioGate && gateTask && gateTask.status !== 'selesai');
  const orders = useCpoeOrders(ctx, signer, scenarioOwned);
  const payer = ctx.patient.payer;
  const patient = {
    allergies: ctx.patient.allergies,
    activeMeds: ctx.activeMeds,
    flags: ctx.flags,
    egfr: ctx.egfr,
    payer,
  };
  const evaluated = evaluateOrders(orders.lines, patient, signer);
  const gate = sendGate(evaluated);
  const cost = costEstimate(evaluated, payer);
  const [localSent, setSent] = useState<(SentInfo & { at: string }) | null>(null);
  /** Banner kiriman tersimpan ditutup begitu daftar order diubah lagi. */
  const [showStored, setShowStored] = useState(true);
  const sent: (SentInfo & { at: string }) | null =
    localSent ??
    (showStored && lastSent && !scenarioOwned
      ? {
          title: `${lastSent.count} order terkirim pukul ${lastSent.at}`,
          message: `Ditandatangani ${lastSent.by} dengan TTE. Order sudah masuk antrean unit penerima.`,
          at: lastSent.at,
        }
      : null);
  const [error, setError] = useState<string | null>(null);
  const { run, pending } = useStoreAction(rev);
  const igd = ctx.setting === 'igd';

  const send = sendTask ? tasks.task(sendTask) : undefined;
  const scenarioSent: SentInfo | null =
    send?.status === 'selesai'
      ? { title: `Resep terkirim · ${send.statusText.replace(/^Selesai · /, '')}`, message: send.doneText }
      : null;
  const view = cpoeSendView({
    scenarioOwned,
    sendTask: send ? { done: send.status === 'selesai', enabled: send.enabled } : null,
    stepActive: tasks.active,
    gate,
    sent: sent !== null,
    sentAt: sent?.at ?? null,
  });
  /**
   * Mockup CPOE: setiap perubahan daftar (tambah, hapus, ganti, override) membuka kiriman baru; order yang sudah
   * terkirim tetap terkunci (hanya draf baru yang bisa diubah dan dikirim).
   */
  const edit =
    <A extends unknown[]>(fn: (...args: A) => void) =>
    (...args: A) => {
      setSent(null);
      setShowStored(false);
      fn(...args);
    };

  const onSend = () => {
    setError(null);
    if (scenarioOwned) {
      // Pasien skenario: hanya tugas kirim skenario yang sedang giliran; tidak pernah lewat sendOrdersAction.
      if (send && view.canSend) tasks.run(send.id, true);
      return;
    }
    const drafts = evaluated.filter((l) => l.status === 'draf');
    const count = gate.count;
    run(
      (r) =>
        sendOrdersAction(
          {
            encounterId: ctx.encounterId,
            orders: drafts.map((l) => ({ catalogId: l.item.id, override: l.overridden ? l.override : null })),
          },
          r,
        ),
      (r) => {
        if (!r.ok) return setError(r.error ?? 'Gagal mengirim order.');
        orders.markSent();
        setSent({
          title: `${count} order terkirim pukul ${r.at ?? ''}`,
          message: r.message ?? '',
          at: r.at ?? '',
        });
      },
    );
  };

  const costNote =
    payer === 'Umum'
      ? `Pasien umum: ${cost.items} item dibayar mandiri sesuai tarif RS.`
      : cost.total > 0n
        ? `${cost.items} item di luar paket penjamin ditanggung pasien. Minta persetujuan pasien sebelum kirim.`
        : 'Seluruh item masuk paket penjamin. Tidak ada biaya tambahan untuk pasien.';

  return (
    <div className="grid grid-cols-1 items-start gap-5 lg:grid-cols-[minmax(240px,280px)_minmax(0,1fr)] min-[1400px]:grid-cols-[minmax(240px,280px)_minmax(0,1fr)_minmax(260px,300px)]">
      <CpoeCatalog
        catalog={ctx.catalog}
        orderSets={ctx.orderSets}
        disabled={pending}
        lockedNote={scenarioOwned ? `${SCENARIO_ORDER_NOTE}.` : null}
        onAdd={edit(orders.add)}
        onApplySet={edit(orders.applySet)}
      />
      <section aria-label="Daftar order" className="flex min-w-0 flex-col gap-3.5">
        <CpoeScenarioPanel
          tasks={tasks}
          skip={[scenarioGate?.task ?? '', sendTask ?? ''].filter(Boolean)}
          handoff={handoff}
        />
        {orders.note && (
          <div
            role="status"
            className="flex items-center justify-between gap-2.5 rounded-control border border-brand-100 bg-selected py-1.5 pr-1.5 pl-3.5 text-small text-brand-700"
          >
            <span>{orders.note}</span>
            <button
              type="button"
              onClick={orders.clearNote}
              className="min-h-11 cursor-pointer rounded-lg border border-brand-100 bg-white px-2.5 font-[inherit] text-caption text-brand-700"
            >
              Tutup
            </button>
          </div>
        )}
        {evaluated.length === 0 && (
          <p className="m-0 rounded-card border border-dashed border-line-strong bg-white p-4 text-small text-ink-500">
            {scenarioOwned
              ? 'Belum ada order. Order pasien simulasi muncul saat tugas langkah skenario dijalankan.'
              : 'Belum ada order. Cari item katalog atau terapkan order set di kiri.'}
          </p>
        )}
        {GROUPS.map((g) => {
          const rows = evaluated.filter((l) => l.item.kind === g.kind);
          if (rows.length === 0) return null;
          return (
            <section
              key={g.kind}
              aria-label={`Order ${g.title.toLowerCase()}`}
              className="overflow-hidden rounded-card border border-line bg-white shadow-card"
            >
              <div className="flex flex-wrap justify-between gap-2 border-b border-line bg-[linear-gradient(90deg,#F8FAFB,#FFFFFF)] px-4 py-2.5">
                <h2 className="m-0 text-caption font-bold tracking-[0.06em] text-ink-700">{g.title}</h2>
                <span className="text-caption text-ink-500">{g.dest(igd)}</span>
              </div>
              <ul className="m-0 list-none p-0">
                {rows.map((l) => {
                  const isLocked =
                    gateOpen &&
                    scenarioGate !== null &&
                    l.item.id === scenarioGate.catalogId &&
                    l.status === 'draf';
                  const followLabel =
                    gateTask?.options.find((o) => o.id === scenarioGate?.follow)?.label ??
                    'Ikuti rekomendasi';
                  const fixes: CdsFix[] = isLocked
                    ? [{ kind: 'remove', lineId: l.lineId, label: followLabel }]
                    : scenarioOwned
                      ? []
                      : cdsFixes(l, evaluated, ctx.catalog);
                  return (
                    <CpoeOrderRow
                      key={l.lineId}
                      line={l}
                      fixes={fixes}
                      payer={payer}
                      removable={!scenarioOwned}
                      disabled={isLocked ? !tasks.enabled(scenarioGate.task) : scenarioOwned || pending}
                      onFix={(f) =>
                        isLocked ? tasks.run(scenarioGate.task, scenarioGate.follow) : edit(orders.fix)(f)
                      }
                      onOverride={(reason) =>
                        isLocked
                          ? tasks.run(scenarioGate.task, scenarioGate.override)
                          : edit(orders.override)(l.lineId, reason)
                      }
                      onRemove={edit(() => orders.remove(l.lineId))}
                    />
                  );
                })}
              </ul>
            </section>
          );
        })}
        {gateOpen && gateTask && !gateTask.enabled && (
          <p className="m-0 text-caption text-ink-500">
            Gerbang CDS skenario dibuka setelah tugas sebelumnya di langkah ini selesai (
            {gateTask.statusText.toLowerCase()}).
          </p>
        )}
        {scenarioGate && gateTask && tasks.errorFor(scenarioGate.task) && (
          <p role="alert" className="m-0 text-small text-danger">
            {tasks.errorFor(scenarioGate.task)}
          </p>
        )}
      </section>
      <div className="flex min-w-0 flex-col gap-3.5 lg:col-span-2 min-[1400px]:col-span-1">
        <CpoeResults results={ctx.results} />
        <CpoeSummary
          checks={preSendChecks(evaluated, signer, payer)}
          cost={cost.total}
          costNote={costNote}
          sendLabel={view.label}
          sendReason={view.reason}
          canSend={view.canSend}
          pending={pending || tasks.pending}
          onSend={onSend}
          sent={scenarioSent ?? sent}
          error={error ?? (send ? tasks.errorFor(send.id) : null)}
          links={links}
        />
      </div>
    </div>
  );
}
