'use client';

import { type ChargeItem, formatJam, formatRupiah, formatTanggalLahir, type Invoice } from '@simrs/shared';
import { Alert, Chip, PatientBanner } from '@simrs/ui';
import { useState, useTransition } from 'react';
import { type KasirActionInput, kasirAction } from '@/app/(staf)/keuangan/kasir/actions';
import { useDemoRunner } from '@/components/demo-sync';
import {
  invoiceStatusView,
  invoiceTotal,
  PAYMENT_METHOD_LABEL,
  patientDue,
  recomputeSplit,
} from '@/lib/keuangan';
import { flowReason, type ScenarioFlow } from '@/lib/keuangan-flow';
import { BillLines } from './bill-lines';
import { KasirSettlement } from './kasir-settlement';
import { ManualLineForm } from './manual-line-form';
import { PayerSplitCard } from './payer-split-card';
import type { PaidInfo } from './payment-panel';

/**
 * U02/U03 · Ruang kerja satu tagihan (mockup Kasir). Tagihan biasa: finalkan, item manual (beralasan), dan bayar
 * berjalan lokal lewat Server Action (simulasi, tidak disimpan). Pasien skenario: tombol menjalankan tugas langkah
 * Kasir skenario hanya saat gilirannya, sehingga layar ini memajukan cerita presentasi.
 */
export function KasirWorkspace({
  invoice,
  flow,
  rev,
  nextHref,
}: {
  invoice: Invoice;
  flow: ScenarioFlow | null;
  rev: number;
  nextHref: string | null;
}) {
  const runner = useDemoRunner(rev);
  const [manual, setManual] = useState<ChargeItem[]>([]);
  const [finalAt, setFinalAt] = useState<string | null>(null);
  const [paid, setPaid] = useState<PaidInfo | null>(null);
  const [closedAt, setClosedAt] = useState<string | null>(null);
  const [message, setMessage] = useState<string | null>(null);
  const [busy, startTransition] = useTransition();
  const scen = invoice.scenario ? flow : null;

  const lines = manual.length ? [...invoice.lines, ...manual] : invoice.lines;
  const total = invoiceTotal(lines);
  const split = manual.length ? recomputeSplit(invoice.split, total) : invoice.split;
  const due = patientDue(
    split,
    invoice.payments.map((p) => BigInt(p.amount)),
  );
  const lunas = invoice.status === 'lunas' || !!paid || !!closedAt;
  const final = lunas || invoice.status === 'final' || !!finalAt;
  const pending = busy || runner.pending;
  const status = invoiceStatusView(
    lunas ? 'lunas' : final ? 'final' : 'berjalan',
    due,
    invoice.encounter.discharged,
  );

  const task = (id: string, value: true | string = true) => {
    if (scen) runner.run({ type: 'task', step: scen.step, task: id, value, scenario: scen.scenario });
  };
  const local = (input: KasirActionInput, done: (at: string) => void) =>
    startTransition(async () => {
      const r = await kasirAction(input);
      setMessage(r.message);
      if (r.ok) done(r.at ?? formatJam(new Date()));
    });

  const closeTask = invoice.scenario === 'rawat-jalan' ? 'tutup' : 'pulang';
  const finalize = scen
    ? { enabled: !!scen.tasks.final?.enabled && !pending, reason: flowReason(scen, 'final') }
    : {
        enabled: invoice.encounter.discharged && !pending,
        reason: invoice.encounter.discharged
          ? ''
          : 'Pasien masih dirawat; tagihan berjalan sampai pasien pulang.',
      };
  const close = scen
    ? { enabled: !!scen.tasks[closeTask]?.enabled && !pending, reason: flowReason(scen, closeTask) }
    : { enabled: !pending, reason: '' };
  const lastPayment = invoice.payments.at(-1);
  const receipt = lunas
    ? {
        no: invoice.receiptNo ?? invoice.number.replace('INV', 'KW'),
        at:
          paid?.at ??
          closedAt ??
          (lastPayment ? formatJam(lastPayment.at) : formatJam(invoice.finalizedAt ?? new Date())),
        note:
          paid?.note ??
          (lastPayment
            ? `${PAYMENT_METHOD_LABEL[lastPayment.method].name} ${formatRupiah(BigInt(lastPayment.amount))} · ${lastPayment.reference}`
            : (invoice.note ?? 'Ditanggung penjamin · pasien bayar Rp 0')),
      }
    : null;
  const pulang = scen && invoice.scenario === 'elektif-btn' && lunas ? scen.tasks.pulang : undefined;
  const discharge =
    scen && pulang && !pulang.done
      ? {
          label: pulang.btn || 'Pulangkan pasien',
          enabled: pulang.enabled && !pending,
          reason: flowReason(scen, 'pulang'),
          onClick: () => task('pulang'),
        }
      : null;

  return (
    <div className="flex min-w-0 flex-[999_1_640px] flex-wrap items-start gap-4">
      <div className="flex min-w-0 flex-[999_1_460px] flex-col gap-4">
        <PatientBanner
          name={invoice.patient.name}
          sex={invoice.patient.sex}
          ageYears={invoice.patient.ageYears}
          birthDate={formatTanggalLahir(invoice.patient.birthDate)}
          mrn={invoice.patient.rm}
          allergies={invoice.patient.allergies}
          guarantor={invoice.patient.guarantor}
          attending={invoice.encounter.dpjp}
        />
        <div className="flex flex-wrap justify-between gap-3 rounded-card border border-line bg-white bg-[linear-gradient(100deg,rgba(15,118,110,0.06),rgba(255,255,255,0)_60%)] px-4 py-3">
          <span className="flex min-w-0 flex-col">
            <span className="font-semibold">{invoice.encounter.label}</span>
            <span className="text-[12.5px] text-ink-500">
              {invoice.encounter.period} · {invoice.encounter.location} · no. tagihan{' '}
              <span className="font-mono">{invoice.number}</span>
            </span>
          </span>
          <span className="flex flex-wrap items-center gap-2">
            <Chip tone="brand">{split.payerLabel}</Chip>
            {split.classUpgrade && <Chip tone="warning">{split.classUpgrade.label}</Chip>}
            {invoice.encounter.sep && <Chip mono>SEP {invoice.encounter.sep}</Chip>}
            <Chip tone={status.tone}>{status.label}</Chip>
            {invoice.scenario && <Chip tone="info">Pasien simulasi</Chip>}
          </span>
        </div>
        <BillLines lines={lines} total={total} />
        <ManualLineForm
          invoiceId={invoice.id}
          disabledReason={
            final
              ? 'Tagihan sudah final dan terkunci; koreksi lewat unit asal.'
              : invoice.scenario
                ? 'Tagihan pasien simulasi mengikuti charge capture skenario; koreksi lewat unit asal.'
                : null
          }
          onAdded={(l, msg) => {
            setManual((m) => [...m, l]);
            setMessage(msg);
          }}
        />
        <Alert level="info" title="Charge capture">
          Semua item berasal dari charge capture otomatis (order, eMAR, lab, radiologi, OK, ADT) lengkap
          dengan sumbernya. Kasir tidak mengetik ulang item; item manual wajib beralasan dan tercatat di
          audit.
        </Alert>
      </div>
      <aside
        aria-label="Penyelesaian tagihan"
        className="flex min-w-0 flex-[1_1_320px] flex-col gap-4 xl:max-w-[400px]"
      >
        <PayerSplitCard split={split} payments={invoice.payments} due={lunas ? 0n : due} />
        <KasirSettlement
          invoice={invoice}
          patientShare={BigInt(split.patientShare)}
          due={due}
          final={final}
          lunas={lunas}
          flow={scen}
          busy={pending}
          receipt={receipt}
          finalize={{
            label: 'Finalkan tagihan',
            ...finalize,
            onClick: () =>
              scen ? task('final') : local({ type: 'final', invoiceId: invoice.id }, setFinalAt),
          }}
          close={{
            label: scen?.tasks[closeTask]?.btn || 'Tutup kunjungan (pasien bayar Rp 0)',
            ...close,
            onClick: () =>
              scen ? task(closeTask) : local({ type: 'tutup', invoiceId: invoice.id }, setClosedAt),
          }}
          discharge={discharge}
          onTask={task}
          onPaid={(p) => {
            setPaid(p);
            setMessage(p.message);
          }}
          nextHref={nextHref}
        />
        {(message || runner.error) && (
          <span role="status" className="text-caption text-ink-700">
            {runner.error ? <span className="text-danger">{runner.error.message}</span> : message}
          </span>
        )}
      </aside>
    </div>
  );
}
