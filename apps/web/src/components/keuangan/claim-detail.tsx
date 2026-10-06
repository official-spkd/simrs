'use client';

import { type Claim, formatJam, formatTanggal } from '@simrs/shared';
import { cx } from '@simrs/ui';
import { useState } from 'react';
import { GatedButton } from '@/components/gated-button';
import { type KlaimActionInput, klaimAction } from '@/app/(staf)/keuangan/klaim/actions';
import { useDemoRunner } from '@/components/demo-sync';
import { useStoreAction } from '@/lib/demo/store/client';
import { flowReason, type ScenarioFlow } from '@/lib/keuangan-flow';
import {
  CLAIM_STATUS_LABEL,
  claimHeaderStatus,
  codingView,
  missingDocs,
  submitLabel,
} from '@/lib/keuangan-klaim';
import { ClaimCodes } from './claim-codes';
import { ClaimDocs } from './claim-docs';
import { ClaimGrouper } from './claim-grouper';
import { useClaimLocal } from './claim-local';
import { ClaimScenarioControls } from './claim-scenario-controls';
import { FlowTaskButton } from './flow-task-button';

const NOTE = {
  ok: { box: 'border-zamrud-200 bg-zamrud-50', mark: '✓', fg: 'text-success' },
  warn: { box: 'border-warning-border bg-kunyit-50', mark: '!', fg: 'text-warning' },
  bad: { box: 'border-danger-border bg-danger-bg', mark: '!', fg: 'text-danger' },
  info: { box: 'border-samudra-200 bg-samudra-50', mark: 'i', fg: 'text-info' },
  none: { box: 'border-line bg-white', mark: '·', fg: 'text-ink-700' },
} as const;

/**
 * U05/U06 · Berkas klaim terpilih (mockup Klaim): kode ICD-10/ICD-9-CM, saran koding, hasil grouper vs tarif RS,
 * kelengkapan berkas, lalu final → kirim E-Klaim. Pasien skenario: validasi dan kirim menjalankan tugas skenario.
 */
export function ClaimDetail({
  claim,
  flow,
  rev,
  storeRev,
}: {
  claim: Claim;
  flow: ScenarioFlow | null;
  /** Revisi toko skenario (tugas Simulasi). */
  rev: number;
  /** Revisi domain toko `klaim`. */
  storeRev: number;
}) {
  const runner = useDemoRunner(rev);
  const store = useStoreAction(storeRev);
  // Per klaim, tersimpan di toko demo: bertahan saat pindah klaim, muat ulang, dan di perangkat lain.
  const local = useClaimLocal(claim.id);
  const docs = claim.documents;
  const fmt = (v: string | null | undefined) => (v ? formatJam(v) : null);
  const acceptedAt = fmt(local.acceptedAt);
  const queryAt = fmt(local.queryAt);
  const sentAt = fmt(local.sentAt);
  const [message, setMessage] = useState<string | null>(null);
  const pending = store.pending || runner.pending;
  const scen = claim.scenario ? flow : null;
  const task = (id: string, value: true | string = true) => {
    if (scen) runner.run({ type: 'task', step: scen.step, task: id, value, scenario: scen.scenario });
  };
  const run = (input: KlaimActionInput) =>
    store.run(
      (r) => klaimAction({ ...input, rev: r }),
      (res) => setMessage(res.message),
    );

  const view = codingView(claim, { accepted: !!acceptedAt, docs });
  const sug = claim.suggestion;
  const label = submitLabel(claim.status);
  const atVerifier = !label;
  const locked = atVerifier || !!sentAt;
  const missing = missingDocs(docs);
  const kirimTask = scen?.tasks.kirim ? 'kirim' : null;
  const submit =
    label && !sentAt
      ? {
          label,
          enabled:
            missing.length === 0 &&
            !!view.grouper &&
            !pending &&
            (kirimTask ? !!scen?.tasks.kirim?.enabled : true),
          reason: missing.length
            ? `Belum bisa dikirim: lengkapi ${missing.length} berkas (${missing.join('; ')}).`
            : !view.grouper
              ? 'Grouping ditahan; selesaikan tindak lanjut di atas lebih dulu.'
              : kirimTask && scen
                ? flowReason(scen, 'kirim')
                : '',
          onClick: () =>
            kirimTask
              ? task('kirim')
              : run({
                  type:
                    claim.status === 'pending'
                      ? 'tanggapan'
                      : claim.status === 'dispute'
                        ? 'banding'
                        : 'kirim',
                  claimId: claim.id,
                  rev: 0,
                }),
        }
      : null;
  const firstSend = local.sentKind === 'kirim' || claim.status === 'draft';
  const verify =
    !scen && claim.status === 'sent' ? (
      <GatedButton enabled={!pending} onClick={() => run({ type: 'verifikasi', claimId: claim.id, rev: 0 })}>
        Catat hasil verifikasi BPJS: layak bayar (mock E-Klaim)
      </GatedButton>
    ) : undefined;
  const sent = sentAt
    ? {
        title: firstSend
          ? `Terkirim ke E-Klaim ${sentAt}`
          : local.sentKind === 'tanggapan' || claim.status === 'pending'
            ? `Tanggapan terkirim ke verifikator ${sentAt}`
            : `Banding diajukan ${sentAt}`,
        note:
          claim.status === 'payable'
            ? (claim.note?.text ?? 'Layak bayar.')
            : firstSend
              ? 'Berkas dikunci untuk verifikasi BPJS. Piutang BPJS sudah diakui saat kunjungan ditutup di Kasir.'
              : 'Berkas tambahan dikunci dan tercatat di audit. Piutang BPJS tetap terbuka sampai dana cair.',
        journalLink: firstSend,
        extra: verify,
      }
    : atVerifier
      ? {
          title: `${CLAIM_STATUS_LABEL[claim.status]}${claim.submittedAt ? ` · dikirim ${formatTanggal(claim.submittedAt)}` : ''}`,
          note: claim.note?.text ?? 'Berkas dikunci untuk verifikasi BPJS.',
          extra: scen ? (
            <FlowTaskButton
              flow={scen}
              task="layak"
              label="Lompat ke hasil verifikasi"
              doneText="Layak bayar"
              pending={pending}
              onRun={(t) => task(t)}
            />
          ) : (
            verify
          ),
        }
      : null;
  const note =
    acceptedAt && sug
      ? {
          level: 'ok' as const,
          title: 'Saran diterima:',
          text: `kode utama ${sug.from} → ${sug.to} (${acceptedAt}). Hasil grouper dihitung ulang.`,
        }
      : claim.note;
  const status = claimHeaderStatus(claim, local, { grouper: view.grouper, missing: missing.length });

  const noteBox = note && (
    <div
      className={cx(
        'flex flex-col gap-2 rounded-control border px-3 py-2.5 text-[12.5px]',
        NOTE[note.level].box,
      )}
    >
      <span className="flex gap-2.5">
        <span aria-hidden="true" className={cx('font-bold', NOTE[note.level].fg)}>
          {NOTE[note.level].mark}
        </span>
        <span className="text-ink-700">
          <span className={cx('font-semibold', NOTE[note.level].fg)}>{note.title}</span> {note.text}
        </span>
      </span>
      {sug && !acceptedAt && !locked && (
        <span className="flex flex-wrap gap-2 pl-5">
          <GatedButton
            variant="primary"
            enabled={!pending}
            onClick={() => run({ type: 'terima-saran', claimId: claim.id, code: sug.to, rev: 0 })}
          >
            {queryAt ? `DPJP setuju · terapkan ${sug.to}` : `Terima ${sug.to}`}
          </GatedButton>
          {!queryAt && (
            <GatedButton enabled={!pending} onClick={() => run({ type: 'query', claimId: claim.id, rev: 0 })}>
              Kirim query ke DPJP
            </GatedButton>
          )}
        </span>
      )}
      {queryAt && !acceptedAt && (
        <span className="pl-5 font-semibold text-info">
          Query terkirim ke DPJP {queryAt} · menunggu jawaban
        </span>
      )}
    </div>
  );

  return (
    <section aria-label="Berkas klaim" className="flex min-w-0 flex-[999_1_560px] flex-col gap-4">
      <div className="overflow-hidden rounded-card border border-line bg-white">
        <div className="flex flex-wrap justify-between gap-2.5 border-b border-line bg-[linear-gradient(100deg,color-mix(in_srgb,_var(--color-brand-600)_6%,_transparent),#FFFFFF_60%)] px-4 py-3.5">
          <span className="flex min-w-0 flex-col">
            <span className="text-base font-semibold">
              {claim.patient.name} · {claim.encounter.title}
            </span>
            <span className="text-[12.5px] text-ink-500">
              RM {claim.patient.rm} · SEP {claim.encounter.sep} · {claim.encounter.classLabel} · DPJP{' '}
              {claim.encounter.dpjp} · {claim.encounter.resume}
            </span>
          </span>
          <span
            aria-live="polite"
            data-claim-status
            className={cx(
              'self-center text-[12.5px] font-semibold',
              status.tone === 'info'
                ? 'text-info'
                : status.tone === 'success'
                  ? 'text-success'
                  : 'text-brand-700',
            )}
          >
            {status.label}
          </span>
        </div>
        <ClaimCodes
          diagnoses={view.diagnoses}
          procedures={claim.procedures}
          diagnosisExtra={
            <>
              {noteBox}
              {scen && !atVerifier && (scen.tasks.utama || scen.tasks.kode) && (
                <ClaimScenarioControls
                  flow={scen}
                  pending={pending}
                  onTask={task}
                  onReason={(reason) => run({ type: 'alasan-bukti', claimId: claim.id, reason, rev: 0 })}
                />
              )}
            </>
          }
        />
      </div>
      <div className="grid grid-cols-1 gap-4 xl:grid-cols-[1.2fr_1fr]">
        <ClaimGrouper
          tiles={view.tiles}
          hospitalCost={claim.hospitalCost}
          tariff={view.grouper?.tariff ?? null}
          classLabel={view.grouper?.classLabel ?? claim.encounter.classLabel}
          held={view.held}
        />
        <ClaimDocs
          docs={docs}
          locked={locked}
          onToggle={(id) =>
            run({
              type: 'berkas',
              claimId: claim.id,
              docId: id,
              ok: !docs.find((d) => d.id === id)?.ok,
              rev: 0,
            })
          }
          query={
            !scen && !locked
              ? {
                  label: queryAt ? `Query terkirim ${queryAt}` : 'Kirim query ke DPJP',
                  enabled: !queryAt && !pending,
                  reason: '',
                  onClick: () => run({ type: 'query', claimId: claim.id, rev: 0 }),
                }
              : null
          }
          submit={submit}
          sent={sent}
        />
      </div>
      {(message || runner.error) && (
        <span role="status" className="text-caption text-ink-700">
          {runner.error ? <span className="text-danger">{runner.error.message}</span> : message}
        </span>
      )}
    </section>
  );
}
