'use client';

import { type Claim, formatJam, formatTanggal } from '@simrs/shared';
import { Button, cx } from '@simrs/ui';
import { useState, useTransition } from 'react';
import { type KlaimActionInput, klaimAction } from '@/app/(staf)/keuangan/klaim/actions';
import { useDemoRunner } from '@/components/demo-sync';
import { flowReason, type ScenarioFlow } from '@/lib/keuangan-flow';
import { CLAIM_STATUS_LABEL, codingView, missingDocs, submitLabel } from '@/lib/keuangan-klaim';
import { ClaimCodes } from './claim-codes';
import { ClaimDocs } from './claim-docs';
import { ClaimGrouper } from './claim-grouper';
import { ClaimScenarioControls } from './claim-scenario-controls';
import { FlowTaskButton } from './flow-task-button';

const NOTE = {
  ok: { box: 'border-[#B7DEC0] bg-[#F2FAF4]', mark: '✓', fg: 'text-success' },
  warn: { box: 'border-warning-border bg-[#FFFAF2]', mark: '!', fg: 'text-warning' },
  bad: { box: 'border-danger-border bg-danger-bg', mark: '!', fg: 'text-danger' },
  info: { box: 'border-[#C9D3EE] bg-[#F6F8FD]', mark: 'i', fg: 'text-info' },
  none: { box: 'border-line bg-white', mark: '·', fg: 'text-ink-700' },
} as const;

/**
 * U05/U06 · Berkas klaim terpilih (mockup Klaim): kode ICD-10/ICD-9-CM, saran koding, hasil grouper vs tarif RS,
 * kelengkapan berkas, lalu final → kirim E-Klaim. Pasien skenario: validasi dan kirim menjalankan tugas skenario.
 */
export function ClaimDetail({ claim, flow, rev }: { claim: Claim; flow: ScenarioFlow | null; rev: number }) {
  const runner = useDemoRunner(rev);
  const [docs, setDocs] = useState(claim.documents);
  const [acceptedAt, setAcceptedAt] = useState<string | null>(null);
  const [queryAt, setQueryAt] = useState<string | null>(null);
  const [sentAt, setSentAt] = useState<string | null>(null);
  const [message, setMessage] = useState<string | null>(null);
  const [busy, startTransition] = useTransition();
  const pending = busy || runner.pending;
  const scen = claim.scenario ? flow : null;
  const task = (id: string, value: true | string = true) => {
    if (scen) runner.run({ type: 'task', step: scen.step, task: id, value, scenario: scen.scenario });
  };
  const local = (input: KlaimActionInput, done?: (at: string) => void) =>
    startTransition(async () => {
      const r = await klaimAction(input);
      setMessage(r.message);
      if (r.ok) done?.(r.at ?? formatJam(new Date()));
    });

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
              : local(
                  {
                    type:
                      claim.status === 'pending'
                        ? 'tanggapan'
                        : claim.status === 'dispute'
                          ? 'banding'
                          : 'kirim',
                    claimId: claim.id,
                  },
                  setSentAt,
                ),
        }
      : null;
  const sent = sentAt
    ? {
        title:
          claim.status === 'draft'
            ? `Terkirim ke E-Klaim ${sentAt}`
            : claim.status === 'pending'
              ? `Tanggapan terkirim ke verifikator ${sentAt}`
              : `Penyelesaian dispute diajukan ${sentAt}`,
        note:
          claim.status === 'draft'
            ? 'Berkas dikunci untuk verifikasi BPJS. Jurnal piutang BPJS terbentuk otomatis di Akuntansi.'
            : 'Berkas tambahan dikunci dan tercatat di audit. Piutang BPJS tetap terbuka sampai dana cair.',
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
          ) : undefined,
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
  const status = sentAt
    ? claim.status === 'draft'
      ? 'Terkirim ke E-Klaim'
      : 'Tanggapan terkirim'
    : `${CLAIM_STATUS_LABEL[claim.status]} · ${claim.tag.label}`;

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
          <Button
            variant="primary"
            disabled={pending}
            onClick={() => local({ type: 'terima-saran', claimId: claim.id, code: sug.to }, setAcceptedAt)}
          >
            {queryAt ? `DPJP setuju · terapkan ${sug.to}` : `Terima ${sug.to}`}
          </Button>
          {!queryAt && (
            <Button
              disabled={pending}
              onClick={() => local({ type: 'query', claimId: claim.id }, setQueryAt)}
            >
              Kirim query ke DPJP
            </Button>
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
        <div className="flex flex-wrap justify-between gap-2.5 border-b border-line bg-[linear-gradient(100deg,rgba(15,118,110,0.06),#FFFFFF_60%)] px-4 py-3.5">
          <span className="flex min-w-0 flex-col">
            <span className="text-base font-semibold">
              {claim.patient.name} · {claim.encounter.title}
            </span>
            <span className="text-[12.5px] text-ink-500">
              RM {claim.patient.rm} · SEP {claim.encounter.sep} · {claim.encounter.classLabel} · DPJP{' '}
              {claim.encounter.dpjp} · {claim.encounter.resume}
            </span>
          </span>
          <span aria-live="polite" className="self-center text-[12.5px] font-semibold text-brand-700">
            {status}
          </span>
        </div>
        <ClaimCodes
          diagnoses={view.diagnoses}
          procedures={claim.procedures}
          diagnosisExtra={
            <>
              {noteBox}
              {scen && !atVerifier && (
                <ClaimScenarioControls
                  flow={scen}
                  pending={pending}
                  onTask={task}
                  onReason={(reason) => local({ type: 'alasan-bukti', claimId: claim.id, reason })}
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
          onToggle={(id) => setDocs((ds) => ds.map((d) => (d.id === id ? { ...d, ok: !d.ok } : d)))}
          query={
            !scen && !locked
              ? {
                  label: queryAt ? `Query terkirim ${queryAt}` : 'Kirim query ke DPJP',
                  enabled: !queryAt && !pending,
                  reason: '',
                  onClick: () => local({ type: 'query', claimId: claim.id }, setQueryAt),
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
