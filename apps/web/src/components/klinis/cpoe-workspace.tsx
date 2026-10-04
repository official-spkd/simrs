'use client';

import type { CpoeContext, CpoeOrderKind } from '@simrs/shared';
import { useState, useTransition } from 'react';
import { sendOrdersAction } from '@/app/(staf)/klinis/order/actions';
import {
  type CdsFix,
  cdsFixes,
  costEstimate,
  evaluateOrders,
  preSendChecks,
  sendGate,
} from '@/lib/klinis-cds';
import { CpoeCatalog } from './cpoe-catalog';
import { CpoeOrderRow } from './cpoe-order-row';
import { CpoeResults } from './cpoe-results';
import { CpoeScenarioPanel } from './cpoe-scenario-panel';
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
  { kind: 'obat', title: 'OBAT', dest: (igd) => (igd ? 'Farmasi satelit IGD' : 'Farmasi rawat jalan') },
  {
    kind: 'tindakan',
    title: 'TINDAKAN',
    dest: (igd) => (igd ? 'IGD · dikerjakan segera' : 'Poli · dikerjakan hari ini'),
  },
  { kind: 'kontrol', title: 'TINDAK LANJUT', dest: () => 'Otomatis' },
];

/** Tiga kolom CPOE (mockup CPOE): katalog + order set | order per jenis dengan CDS | ringkasan + kirim (TTE). */
export function CpoeWorkspace({
  ctx,
  signer,
  binding,
  scenarioGate,
  sendTask,
  links,
}: {
  ctx: CpoeContext;
  signer: string;
  binding: ScenarioBinding | null;
  scenarioGate: ScenarioGate | null;
  sendTask: string | null;
  links: ReadonlyArray<{ href: string; label: string }>;
}) {
  const tasks = useScenarioTasks(binding);
  const gateTask = scenarioGate ? tasks.task(scenarioGate.task) : undefined;
  const gateOpen = Boolean(scenarioGate && gateTask && gateTask.status !== 'selesai');
  const locked = new Set(gateOpen && scenarioGate ? [scenarioGate.catalogId] : []);
  const orders = useCpoeOrders(ctx, signer, locked);
  const payer = ctx.patient.payer;
  const patient = { allergies: ctx.patient.allergies, activeMeds: ctx.activeMeds, flags: ctx.flags, payer };
  const evaluated = evaluateOrders(orders.lines, patient, signer);
  const gate = sendGate(evaluated);
  const cost = costEstimate(evaluated, payer);
  const [sent, setSent] = useState<SentInfo | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();
  const igd = ctx.setting === 'igd';

  const send = sendTask ? tasks.task(sendTask) : undefined;
  const scenarioSent: SentInfo | null =
    send?.status === 'selesai'
      ? { title: `Resep terkirim · ${send.statusText.replace(/^Selesai · /, '')}`, message: send.doneText }
      : null;
  const sendReason = send
    ? (gate.reason ??
      (send.status === 'selesai' || send.enabled
        ? null
        : 'Belum bisa dikirim: selesaikan rencana terapi, gerbang CDS, dan PRB lebih dulu.'))
    : gate.reason;
  const canSend = send ? tasks.enabled(send.id) && gate.reason === null : gate.reason === null && !sent;

  const onSend = () => {
    setError(null);
    if (send) return tasks.run(send.id, true);
    const drafts = evaluated.filter((l) => l.status === 'draf');
    startTransition(async () => {
      const r = await sendOrdersAction({
        encounterId: ctx.encounterId,
        orders: drafts.map((l) => ({ catalogId: l.item.id, override: l.overridden ? l.override : null })),
      });
      if (!r.ok) return setError(r.error ?? 'Gagal mengirim order.');
      orders.markSent();
      setSent({
        title: `${r.count ?? drafts.length} order terkirim pukul ${r.at ?? ''}`,
        message: r.message ?? '',
      });
    });
  };

  const costNote =
    payer === 'Umum'
      ? `Pasien umum: ${cost.items} item dibayar mandiri sesuai tarif RS.`
      : cost.total > 0n
        ? `${cost.items} item di luar paket penjamin ditanggung pasien. Minta persetujuan pasien sebelum kirim.`
        : 'Seluruh item masuk paket penjamin. Tidak ada biaya tambahan untuk pasien.';

  return (
    <div className="grid grid-cols-1 items-start gap-5 lg:grid-cols-[minmax(240px,280px)_minmax(0,1fr)] 2xl:grid-cols-[280px_minmax(0,1fr)_300px]">
      <CpoeCatalog
        catalog={ctx.catalog}
        orderSets={ctx.orderSets}
        disabled={pending}
        onAdd={orders.add}
        onApplySet={orders.applySet}
      />
      <section aria-label="Daftar order" className="flex min-w-0 flex-col gap-3.5">
        <CpoeScenarioPanel tasks={tasks} skip={[scenarioGate?.task ?? '', sendTask ?? ''].filter(Boolean)} />
        {orders.note && (
          <div
            role="status"
            className="flex items-center justify-between gap-2.5 rounded-control border border-brand-100 bg-selected py-1.5 pr-1.5 pl-3.5 text-small text-brand-700"
          >
            <span>{orders.note}</span>
            <button
              type="button"
              onClick={orders.clearNote}
              className="min-h-9 cursor-pointer rounded-lg border border-brand-100 bg-white px-2.5 font-[inherit] text-caption text-brand-700"
            >
              Tutup
            </button>
          </div>
        )}
        {evaluated.length === 0 && (
          <p className="m-0 rounded-card border border-dashed border-line-strong bg-white p-4 text-small text-ink-500">
            Belum ada order. Cari item katalog atau terapkan order set di kiri.
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
                  const isLocked = locked.has(l.item.id) && l.status === 'draf' && scenarioGate !== null;
                  const followLabel =
                    gateTask?.options.find((o) => o.id === scenarioGate?.follow)?.label ??
                    'Ikuti rekomendasi';
                  const fixes: CdsFix[] = isLocked
                    ? [{ kind: 'remove', lineId: l.lineId, label: followLabel }]
                    : cdsFixes(l, evaluated, ctx.catalog);
                  return (
                    <CpoeOrderRow
                      key={l.lineId}
                      line={l}
                      fixes={fixes}
                      payer={payer}
                      removable={!isLocked}
                      disabled={isLocked ? !tasks.enabled(scenarioGate.task) : pending || sent !== null}
                      onFix={(f) =>
                        isLocked ? tasks.run(scenarioGate.task, scenarioGate.follow) : orders.fix(f)
                      }
                      onOverride={(reason) =>
                        isLocked
                          ? tasks.run(scenarioGate.task, scenarioGate.override)
                          : orders.override(l.lineId, reason)
                      }
                      onRemove={() => orders.remove(l.lineId)}
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
      <div className="flex min-w-0 flex-col gap-3.5 lg:col-span-2 2xl:col-span-1">
        <CpoeResults results={ctx.results} />
        <CpoeSummary
          checks={preSendChecks(evaluated, signer, payer)}
          cost={cost.total}
          costNote={costNote}
          sendLabel={send ? 'Kirim resep (TTE)' : sent ? 'Order terkirim' : `Kirim ${gate.count} order (TTE)`}
          sendReason={sendReason}
          canSend={canSend}
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
