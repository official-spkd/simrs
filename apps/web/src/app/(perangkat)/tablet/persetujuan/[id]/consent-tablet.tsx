'use client';

import { type ConsentDocument, formatJam, SAFETY_REASON_MIN } from '@simrs/shared';
import { cx } from '@simrs/ui';
import { useState, useTransition } from 'react';
import { type SignatureValue, SignaturePad } from '@/components/rawat-inap/signature-pad';
import { taskEnabled, useScenarioTask } from '@/components/rawat-inap/use-scenario-task';
import type { ScenarioStepState } from '@/lib/rawat-inap-scenario';
import { finalizeConsentAction, refuseConsentAction } from './actions';
import { ConsentInfo, ConsentParties, RefusalForm } from './consent-body';

const STEPS = ['Informasi', 'Tanda tangan pasien', 'Saksi', 'TTE dokter'];

/** K11 · Tablet persetujuan tindakan (mockup Consent, kanvas 834×1194). */
export function ConsentTablet({
  doc,
  patient,
  canSign,
  scenario,
}: {
  doc: ConsentDocument;
  patient: string;
  canSign: boolean;
  scenario: ScenarioStepState | null;
}) {
  const { runTask, pending } = useScenarioTask(scenario?.rev ?? 0);
  const wasFinal = doc.status === 'final';
  const [fs, setFs] = useState(17);
  const [step, setStep] = useState(wasFinal ? 3 : 0);
  const [ack, setAck] = useState<Record<string, boolean>>(() =>
    Object.fromEntries(doc.items.map((i) => [i.id, wasFinal])),
  );
  const [pSig, setPSig] = useState<SignatureValue | null>(null);
  const [wSig, setWSig] = useState<SignatureValue | null>(null);
  const [staff, setStaff] = useState(wasFinal);
  const [finalAt, setFinalAt] = useState<string | null>(doc.finalAt ? formatJam(doc.finalAt) : null);
  const [refusing, setRefusing] = useState(false);
  const [reason, setReason] = useState('');
  const [refused, setRefused] = useState<{ at: string; reason: string } | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, start] = useTransition();
  const locked = !!finalAt || !!refused;
  const allAck = doc.items.every((i) => ack[i.id]);

  let canNext = false;
  let nextLabel = 'Lanjut';
  let hint = '';
  if (refused) hint = 'Alur dihentikan karena pasien menolak.';
  else if (finalAt) nextLabel = 'Dokumen final';
  else if (step === 0) {
    canNext = allAck;
    nextLabel = 'Lanjut ke tanda tangan';
    if (!canNext) hint = 'Centang ketujuh butir informasi yang sudah dipahami.';
  } else if (step === 1) {
    canNext = !!pSig;
    nextLabel = 'Lanjut ke saksi';
    if (!canNext) hint = `${doc.signerName} belum menandatangani.`;
  } else if (step === 2) {
    canNext = !!wSig && staff;
    nextLabel = 'Lanjut ke TTE dokter';
    if (!wSig) hint = 'Saksi keluarga belum tanda tangan.';
    else if (!staff) hint = 'Centang kehadiran saksi petugas.';
  } else {
    canNext = canSign;
    nextLabel = 'Tanda tangani (TTE)';
    if (!canSign) hint = 'TTE oleh dokter pelaksana: masuk dengan posisi dokter.';
  }

  const next = () => {
    if (!canNext || busy || pending) return;
    if (step < 3) return setStep(step + 1);
    start(async () => {
      const r = await finalizeConsentAction({
        consentId: doc.id,
        acknowledged: doc.items.map((i) => i.id),
        patient: { method: pSig?.method ?? 'goresan', name: pSig?.name ?? doc.signerName },
        witness: { method: wSig?.method ?? 'goresan', name: wSig?.name ?? doc.witness.name },
        staffWitnessPresent: staff,
      });
      if (!r.ok) return setError(r.error ?? 'Dokumen belum final.');
      setError(null);
      setFinalAt(r.ok.at);
      if (scenario && taskEnabled(scenario, 'consent')) runTask(scenario, 'consent', true);
    });
  };

  const refuse = () => {
    if (reason.trim().length < SAFETY_REASON_MIN) {
      setError(`Alasan penolakan wajib diisi (minimal ${SAFETY_REASON_MIN} karakter).`);
      return;
    }
    start(async () => {
      const r = await refuseConsentAction({ consentId: doc.id, reason: reason.trim() });
      if (!r.ok) return setError(r.error ?? 'Penolakan belum tercatat.');
      setError(null);
      setRefusing(false);
      setRefused({ at: r.ok.at, reason: reason.trim() });
    });
  };

  const signed = (name: string): SignatureValue | null =>
    finalAt ? { method: 'nama', name, at: finalAt } : null;

  return (
    <div className="flex h-full flex-col bg-canvas text-ink-900">
      <header className="flex items-center justify-between gap-3 border-b border-line bg-white/90 px-7 py-[18px]">
        <div className="flex flex-col">
          <span className="text-[13px] text-ink-500">Persetujuan tindakan kedokteran · K11</span>
          <h1 className="m-0 text-[20px] font-semibold">{doc.procedure}</h1>
        </div>
        <div role="group" aria-label="Ukuran teks" className="flex gap-1.5">
          <button
            type="button"
            disabled={fs <= 14}
            onClick={() => setFs((v) => Math.max(14, v - 2))}
            aria-label="Perkecil teks"
            className="size-12 cursor-pointer rounded-control border border-line-strong bg-white font-[inherit] text-[15px] font-semibold disabled:cursor-not-allowed disabled:opacity-45"
          >
            A−
          </button>
          <button
            type="button"
            disabled={fs >= 24}
            onClick={() => setFs((v) => Math.min(24, v + 2))}
            aria-label="Perbesar teks"
            className="size-12 cursor-pointer rounded-control border border-line-strong bg-white font-[inherit] text-[19px] font-semibold disabled:cursor-not-allowed disabled:opacity-45"
          >
            A+
          </button>
        </div>
      </header>
      <nav aria-label="Langkah" className="grid grid-cols-4 gap-2 bg-white px-7 pt-3 pb-4">
        {STEPS.map((label, i) => {
          const isDone = !!finalAt || i < step;
          const cur = !finalAt && !refused && i === step;
          return (
            <span
              key={label}
              aria-current={cur ? 'step' : undefined}
              className={cx(
                'flex flex-col gap-1.5 text-[13px]',
                cur ? 'font-semibold' : 'font-medium',
                isDone || cur ? 'text-brand-700' : 'text-ink-500',
              )}
            >
              <span
                aria-hidden="true"
                className={cx(
                  'h-1.5 rounded-full',
                  isDone ? 'bg-brand-600' : cur ? 'bg-[linear-gradient(90deg,#0F766E,#5FB3AA)]' : 'bg-line',
                )}
              />
              {i + 1}. {label}
              {isDone && <span className="sr-only"> (selesai)</span>}
            </span>
          );
        })}
      </nav>
      <main className="flex flex-1 flex-col gap-4 overflow-y-auto px-7 py-5" style={{ fontSize: fs }}>
        <ConsentParties doc={doc} patient={patient} />
        <ConsentInfo
          doc={doc}
          ack={ack}
          locked={locked || step !== 0}
          onAck={(id) => setAck((a) => ({ ...a, [id]: !a[id] }))}
        />
        <section
          aria-label="Tanda tangan"
          className="grid grid-cols-2 gap-4 rounded-card border border-line bg-white p-4"
        >
          <SignaturePad
            label="Tanda tangan pasien/keluarga"
            signerName={doc.signerName}
            disabled={locked || step !== 1}
            value={pSig ?? signed(doc.signerName)}
            onChange={setPSig}
          />
          <SignaturePad
            label={`Saksi (keluarga · ${doc.witness.relation})`}
            signerName={doc.witness.name}
            disabled={locked || step !== 2}
            value={wSig ?? signed(doc.witness.name)}
            onChange={setWSig}
          />
        </section>
        {step >= 2 && !refused && (
          <label className="flex min-h-12 cursor-pointer items-center gap-3 rounded-card border border-line bg-white px-4">
            <input
              type="checkbox"
              checked={staff}
              disabled={locked || step !== 2}
              onChange={() => setStaff((v) => !v)}
              className="size-6 accent-brand-600"
            />
            Saksi kedua (petugas): {doc.staffWitness} hadir dan menyaksikan penandatanganan
          </label>
        )}
        {!finalAt && !refused && step < 3 && (
          <p className="m-0 flex gap-2.5 rounded-card border border-warning-border bg-warning-bg px-4 py-3 text-ink-700">
            <span aria-hidden="true" className="font-bold text-warning">
              !
            </span>
            Saksi kedua dari petugas dan TTE dokter dibutuhkan sebelum dokumen final. Pasien berhak menolak
            atau menarik persetujuan kapan saja.
          </p>
        )}
        {!finalAt && !refused && step === 3 && (
          <p className="m-0 flex flex-col rounded-card border border-brand-200 bg-selected px-4 py-3">
            <span className="font-semibold">TTE dokter pelaksana</span>
            <span className="text-ink-700">
              {doc.doctor} · sertifikat elektronik · pasien dan saksi sudah menandatangani. Tekan &quot;Tanda
              tangani (TTE)&quot; di bawah.
            </span>
          </p>
        )}
        {finalAt && (
          <div
            role="status"
            className="rounded-card border border-success-border bg-success-bg px-4 py-3 font-semibold text-success"
          >
            ✓ Dokumen final · TTE {doc.doctor} pukul {finalAt}. Salinan dikirim ke rekam medis dan aplikasi
            pasien (simulasi, tidak disimpan).
          </div>
        )}
        {refusing && !refused && (
          <RefusalForm
            reason={reason}
            error={error}
            busy={busy}
            onReason={(v) => {
              setReason(v);
              setError(null);
            }}
            onCancel={() => {
              setRefusing(false);
              setReason('');
              setError(null);
            }}
            onConfirm={refuse}
          />
        )}
        {refused && (
          <div
            role="status"
            className="flex flex-col gap-1 rounded-card border border-danger-border bg-[#FFF8F7] px-4 py-3"
          >
            <span className="font-semibold text-danger-strong">
              Pasien menolak tindakan · tercatat {refused.at}
            </span>
            <span className="text-ink-700">
              Alasan: {refused.reason}. DPJP diberi notifikasi untuk edukasi lanjutan dan rencana alternatif
              (simulasi, tidak disimpan).
            </span>
          </div>
        )}
        {error && !refusing && (
          <span role="alert" className="font-semibold text-danger">
            {error}
          </span>
        )}
      </main>
      <footer className="flex items-center gap-3 border-t border-line bg-white px-7 py-4">
        <button
          type="button"
          disabled={locked}
          onClick={() => setRefusing(true)}
          className="min-h-12 cursor-pointer rounded-control border border-danger-border bg-white px-4 font-[inherit] font-semibold text-danger disabled:cursor-not-allowed disabled:opacity-45"
        >
          Saya menolak tindakan
        </button>
        <span id="consent-hint" className="flex-1 text-right text-[13px] text-ink-700">
          {hint}
        </span>
        <button
          type="button"
          disabled={locked || step === 0}
          onClick={() => setStep((s) => s - 1)}
          className="min-h-12 cursor-pointer rounded-control border border-line-strong bg-white px-5 font-[inherit] disabled:cursor-not-allowed disabled:opacity-45"
        >
          Kembali
        </button>
        <button
          type="button"
          disabled={!canNext || busy || pending}
          aria-describedby={hint ? 'consent-hint' : undefined}
          onClick={next}
          className="min-h-12 cursor-pointer rounded-control border border-brand-800 bg-btn-primary px-6 font-[inherit] font-semibold text-white disabled:cursor-not-allowed disabled:border-line disabled:bg-muted disabled:bg-none disabled:text-ink-400"
        >
          {nextLabel}
        </button>
      </footer>
    </div>
  );
}
