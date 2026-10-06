'use client';

import { formatRupiah, type PaymentOverview } from '@simrs/shared';
import { Alert, Button, KpiCard } from '@simrs/ui';
import { type ReactNode, useEffect, useState } from 'react';
import { DepositControls } from '@/components/btn/deposit-controls';
import { KeepTabs } from '@/components/btn/keep-tabs';
import { KonfigurasiTab } from '@/components/btn/konfigurasi-tab';
import { RefundTab } from '@/components/btn/refund-tab';
import { RekonTab } from '@/components/btn/rekon-tab';
import { TransaksiDetail } from '@/components/btn/transaksi-detail';
import { TransaksiTab } from '@/components/btn/transaksi-tab';
import { useScenarioTask } from '@/components/btn/use-scenario-task';
import { formatJuta, formatWhen } from '@/lib/btn';
import type { ScenarioHook } from '@/lib/btn-skenario';
import { usePaymentState } from './use-payment-state';

const RECON_TASKS: ReadonlyArray<{ task: string; label: string; note: string }> = [
  {
    task: 'tarik',
    label: 'Tarik laporan TPDI dan mutasi BTN (H2H)',
    note: 'laporan transaksi harian + mutasi rekening operasional',
  },
  {
    task: 'jurnal',
    label: 'Posting jurnal otomatis',
    note: 'Bank BTN (D) · uang muka dan piutang pasien (K)',
  },
];

/** "N dtk lalu" / "N mnt lalu" dari jam demo; kosong bila lebih dari satu jam atau di masa depan. */
function agoLabel(nowIso: string, atIso: string): string {
  const sec = Math.floor((Date.parse(nowIso) - Date.parse(atIso)) / 1000);
  if (!Number.isFinite(sec) || sec < 0 || sec >= 3600) return '';
  return sec < 60 ? `${sec} dtk lalu` : `${Math.floor(sec / 60)} mnt lalu`;
}

/** I05/U09 · Bagian interaktif layar pembayaran digital: KPI, tab Transaksi/Rekonsiliasi/Refund/Konfigurasi. */
export function PembayaranClient({
  moneyFlow,
  data,
  hook,
  userName,
  kasirHref,
  journalHref,
}: {
  /** Alur dana (server component), tampil di bawah KPI seperti urutan mockup. */
  moneyFlow: ReactNode;
  data: PaymentOverview;
  hook: ScenarioHook | null;
  userName: string;
  kasirHref: string | null;
  journalHref: string | null;
}) {
  const s = usePaymentState(data, userName);
  const scenario = useScenarioTask(hook);
  const busy = s.pending || scenario.pending;
  const [tab, setTab] = useState(hook?.stepId === 'rekonsiliasi' ? 'rekonsiliasi' : 'transaksi');
  const [sel, setSel] = useState(s.txs[0]?.id ?? '');
  const [cfgDirty, setCfgDirty] = useState(false);
  // Kepala layar: "webhook terakhir HH.MM (N dtk lalu)" diperbarui tiap 5 detik (mockup).
  const [, setTick] = useState(0);
  useEffect(() => {
    const t = setInterval(() => setTick((n) => n + 1), 5000);
    return () => clearInterval(t);
  }, []);
  const ago = agoLabel(s.clock(), s.lastWebhookAt);
  const tx = s.txs.find((t) => t.id === sel) ?? s.txs[0];
  const refundsOpen = data.refunds.filter((r) => {
    const st = s.refundStages[r.id] ?? r.stage;
    return st !== 'diproses-btn' && st !== 'dana-kembali';
  }).length;
  const reconTask = RECON_TASKS.find((t) => scenario.can('rekonsiliasi', t.task));
  const conn = data.connection;

  const runRecon = async () => {
    if (await s.runRecon()) scenario.fire('rekonsiliasi', 'cocok');
  };

  return (
    <div className="flex flex-col gap-4">
      <div aria-live="polite" className="flex flex-wrap items-center gap-x-5 gap-y-1 text-small text-ink-700">
        <span>
          <span aria-hidden="true" className="mr-1.5 inline-block size-2 rounded-full bg-success" />
          <span className="font-semibold text-ink-900">TPDI</span> terhubung · webhook terakhir{' '}
          <span className="font-mono">{formatWhen(s.lastWebhookAt)}</span>
          {ago && <span className="text-ink-500"> ({ago})</span>} · latensi p95{' '}
          <span className="font-mono">{conn.latencyP95Ms} ms</span>
        </span>
        <span>
          <span aria-hidden="true" className="mr-1.5 inline-block size-2 rounded-full bg-success" />
          <span className="font-semibold text-ink-900">API BTN</span> mutasi H2H terhubung · tarik tiap{' '}
          {conn.pullEveryMin} mnt · terakhir{' '}
          <span className="font-mono">{formatWhen(s.reconRunAt ?? conn.lastBankPullAt)}</span>
        </span>
        <span
          className={
            s.savedMode === 'sandbox'
              ? 'rounded-full border border-warning-border bg-warning-bg px-2.5 py-0.5 text-caption font-bold tracking-wide text-warning'
              : 'rounded-full bg-brand-50 px-2.5 py-0.5 text-caption font-bold tracking-wide text-brand-700'
          }
        >
          Mode {s.savedMode === 'sandbox' ? 'SANDBOX' : 'PRODUKSI'}
        </span>
      </div>
      <div
        role="region"
        aria-label="Indikator pembayaran"
        className="grid grid-cols-2 gap-3.5 xl:grid-cols-4"
      >
        <KpiCard
          label="Penerimaan digital hari ini"
          value={formatJuta(s.kpis.recorded)}
          detail="tercatat di kasir · VA, QRIS, EDC"
          tinted
        />
        <KpiCard
          label="Transaksi berhasil"
          value={String(s.kpis.success)}
          detail={s.kpis.successDetail}
          tinted
        />
        <KpiCard
          label="Menunggu bayar"
          value={String(s.kpis.pending)}
          hint="VA aktif dan QR belum kedaluwarsa"
          tone="warning"
          tinted
        />
        <KpiCard
          label="Pengecualian rekonsiliasi"
          value={String(s.kpis.exceptionsLeft)}
          hint={
            s.kpis.exceptionsLeft
              ? `selisih belum dijelaskan ${formatRupiah(s.kpis.unexplained)}`
              : 'semua selisih sudah ditangani'
          }
          tone={s.kpis.exceptionsLeft ? 'danger' : 'success'}
          tinted
        />
      </div>
      {moneyFlow}
      {s.msg && <Alert level={s.msg.ok ? 'success' : 'critical'}>{s.msg.text}</Alert>}
      <KeepTabs
        label="Bagian pembayaran digital"
        value={tab}
        onChange={setTab}
        items={[
          {
            id: 'transaksi',
            label: 'Transaksi',
            badge: `${s.kpis.pending} menunggu`,
            content: tx ? (
              <TransaksiTab
                txs={s.txs}
                selectedId={tx.id}
                onSelect={setSel}
                detail={
                  <TransaksiDetail
                    tx={tx}
                    busy={busy}
                    kasirHref={kasirHref}
                    onSimulatePay={() => s.simulatePay(tx.id)}
                    scenarioControls={tx.scenario ? <DepositControls tx={tx} scenario={scenario} /> : null}
                  />
                }
              />
            ) : null,
          },
          {
            id: 'rekonsiliasi',
            label: 'Rekonsiliasi',
            badge: s.kpis.exceptionsLeft ? `${s.kpis.exceptionsLeft} selisih` : undefined,
            warn: true,
            content: (
              <RekonTab
                rows={s.rows}
                totals={s.totals}
                account={data.config.operationalAccount}
                runNote={
                  s.reconRunAt
                    ? `Terakhir dijalankan manual ${formatWhen(s.reconRunAt)}.`
                    : `Terakhir otomatis ${formatWhen(data.recon.lastAutoRunAt)} · berikutnya ${formatWhen(data.recon.nextAutoRunAt)}.`
                }
                flash={s.flash}
                busy={busy}
                onRun={runRecon}
                onResolve={(row, actionId, note) => s.resolve(row.id, actionId, note)}
                journalHref={journalHref}
                scenarioControls={
                  reconTask ? (
                    <div className="flex flex-wrap items-center gap-3 rounded-[12px] border border-[#9FCFC8] bg-[#F7FBFA] p-3">
                      <span className="text-caption font-semibold text-brand-700">
                        Simulasi · rekonsiliasi pasien skenario
                      </span>
                      <Button
                        variant="primary"
                        disabled={busy}
                        onClick={() => scenario.fire('rekonsiliasi', reconTask.task)}
                      >
                        {reconTask.label}
                      </Button>
                      <span className="text-caption text-ink-700">{reconTask.note}</span>
                    </div>
                  ) : null
                }
              />
            ),
          },
          {
            id: 'refund',
            label: 'Refund',
            badge: refundsOpen ? `${refundsOpen} proses` : undefined,
            content: (
              <RefundTab
                refunds={data.refunds}
                stages={s.refundStages}
                account={data.config.operationalAccount}
                busy={busy}
                record={s.record}
                now={s.clock}
                onStage={s.setRefundStage}
                userName={userName}
              />
            ),
          },
          {
            id: 'konfigurasi',
            label: 'Konfigurasi',
            badge: cfgDirty ? 'belum disimpan' : undefined,
            content: (
              <KonfigurasiTab
                config={data.config}
                busy={busy}
                record={s.record}
                now={s.clock}
                onSavedMode={s.setSavedMode}
                onDirty={setCfgDirty}
              />
            ),
          },
        ]}
      />
    </div>
  );
}
