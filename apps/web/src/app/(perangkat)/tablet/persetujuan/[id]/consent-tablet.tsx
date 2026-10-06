'use client';

import { type ConsentDocument, formatJam, SAFETY_REASON_MIN } from '@simrs/shared';
import { cx } from '@simrs/ui';
import Link from 'next/link';
import { useState } from 'react';
import { useStoreAction } from '@/lib/demo/store/client';
import { type SignatureValue, SignaturePad } from '@/components/rawat-inap/signature-pad';
import { taskEnabled, useScenarioTask } from '@/components/rawat-inap/use-scenario-task';
import { CONSENT_STATUS_LABEL } from '@/lib/rawat-inap';
import type { ScenarioStepState } from '@/lib/rawat-inap-scenario';
import { finalizeConsentAction, refuseConsentAction } from './actions-demo';
import { ConsentInfo, ConsentParties, RefusalForm } from './consent-body';

const STEPS = ['Informasi', 'Tanda tangan pasien', 'Saksi', 'TTE dokter'];

const FAILED = 'Server tidak dapat dihubungi; coba lagi.';

/**
 * K11 · Tablet persetujuan tindakan (mockup Consent, kanvas 834×1194). Terkunci menurut status dokumen dari server
 * (final/ditolak = hanya baca) dan, untuk dokumen milik skenario, menunggu giliran tugasnya (`wait`). Galat server
 * dan galat skenario tampil sebagai `role="alert"`.
 */
export function ConsentTablet({
  doc,
  patient,
  canSign,
  scenario,
  wait,
  rev,
  refusal,
}: {
  doc: ConsentDocument;
  patient: string;
  canSign: boolean;
  scenario: ScenarioStepState | null;
  /** Alasan menunggu giliran Simulasi (dokumen milik skenario), null = boleh diproses. */
  wait: string | null;
  /** Revisi toko `persetujuan`. */
  rev: number;
  /** Penolakan tersimpan (dokumen ditolak): jam + alasan. */
  refusal: { at: string; reason: string } | null;
}) {
  const { runTask, pending, error: runError } = useScenarioTask(scenario?.rev ?? 0);
  const wasFinal = doc.status === 'final';
  const wasRefused = doc.status === 'ditolak';
  const [fs, setFs] = useState(16);
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
  const { run, pending: busy } = useStoreAction(rev);
  const locked = !!finalAt || !!refused || wasRefused || !!wait;
  const closed = !!finalAt || !!refused || wasRefused;
  const status: ConsentDocument['status'] = finalAt ? 'final' : refused || wasRefused ? 'ditolak' : 'draf';
  const allAck = doc.items.every((i) => ack[i.id]);

  let canNext = false;
  let nextLabel = 'Lanjut';
  let hint = '';
  if (refused || wasRefused) hint = 'Alur dihentikan karena pasien menolak.';
  else if (finalAt) nextLabel = 'Dokumen final';
  else if (wait) hint = wait;
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
    if (!canNext || locked || busy || pending) return;
    if (step < 3) return setStep(step + 1);
    run(
      (r) =>
        finalizeConsentAction(
          {
            consentId: doc.id,
            acknowledged: doc.items.map((i) => i.id),
            patient: { method: pSig?.method ?? 'goresan', name: pSig?.name ?? doc.signerName },
            witness: { method: wSig?.method ?? 'goresan', name: wSig?.name ?? doc.witness.name },
            staffWitnessPresent: staff,
          },
          r,
        ),
      (res) => {
        if (!res.ok || !res.at) return setError(res.message || FAILED);
        const at = res.at;
        setError(null);
        // Dokumen milik skenario baru final setelah tugasnya tercatat; galatnya tampil dari `runError`.
        if (res.scenario && scenario && taskEnabled(scenario, 'consent')) {
          runTask(scenario, 'consent', true, (ok) => ok && setFinalAt(at));
        } else setFinalAt(at);
      },
    );
  };

  const refuse = () => {
    if (reason.trim().length < SAFETY_REASON_MIN) {
      setError(`Alasan penolakan wajib diisi (minimal ${SAFETY_REASON_MIN} karakter).`);
      return;
    }
    const why = reason.trim();
    run(
      (r) => refuseConsentAction({ consentId: doc.id, reason: why }, r),
      (res) => {
        if (!res.ok || !res.at) return setError(res.message || FAILED);
        setError(null);
        setRefusing(false);
        setRefused({ at: res.at, reason: why });
      },
    );
  };

  const signed = (name: string): SignatureValue | null =>
    finalAt ? { method: 'nama', name, at: finalAt } : null;

  return (
    <div className="flex h-full flex-col bg-canvas text-ink-900">
      <header className="flex items-center justify-between gap-3 border-b border-line bg-white/90 px-7 py-[18px]">
        <div className="flex flex-col">
          <span className="text-[13px] text-ink-500">Persetujuan tindakan kedokteran · K11</span>
          <h1 className="m-0 text-[20px] font-semibold">{doc.procedure}</h1>
          <span
            className={cx(
              'mt-1 self-start rounded-full px-3 py-0.5 text-[13px] font-semibold',
              status === 'final'
                ? 'bg-success-bg text-success'
                : status === 'ditolak'
                  ? 'bg-danger-bg text-danger'
                  : 'bg-warning-bg text-warning',
            )}
          >
            Status: {CONSENT_STATUS_LABEL[status]}
          </span>
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
          const cur = !locked && i === step;
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
        {wait && !closed && (
          <div
            role="status"
            className="flex flex-col gap-1 rounded-card border border-warning-border bg-warning-bg px-4 py-3"
          >
            <span className="font-semibold text-warning-strong">{wait}</span>
            <span className="text-ink-700">
              Dokumen hanya bisa dibaca sampai gilirannya; tanda tangan, TTE, dan penolakan dinonaktifkan.{' '}
              <Link href="/simulasi" className="font-semibold">
                Buka Simulasi
              </Link>
            </span>
          </div>
        )}
        {wasRefused && !refused && (
          <div
            role="status"
            className="rounded-card border border-danger-border bg-[#FFF8F7] px-4 py-3 font-semibold text-danger-strong"
          >
            Pasien menolak tindakan · penolakan tercatat di rekam medis
            {refusal ? ` ${formatJam(refusal.at)} · alasan: ${refusal.reason}` : ''}; dokumen terkunci.
          </div>
        )}
        <ConsentParties doc={doc} patient={patient} />
        <ConsentInfo
          doc={doc}
          ack={ack}
          locked={locked || step !== 0}
          onAck={(id) => setAck((a) => ({ ...a, [id]: !a[id] }))}
        />
        {/* Dua kartu tanda tangan terpisah (mockup: radius 14, padding 14). */}
        <section aria-label="Tanda tangan" className="grid grid-cols-2 gap-4">
          <div className="rounded-[14px] border border-line bg-white p-[14px]">
            <SignaturePad
              label="Tanda tangan pasien/keluarga"
              signerName={doc.signerName}
              disabled={locked || step !== 1}
              value={pSig ?? signed(doc.signerName)}
              onChange={setPSig}
              location={doc.location}
            />
          </div>
          <div className="rounded-[14px] border border-line bg-white p-[14px]">
            <SignaturePad
              label="Saksi (keluarga)"
              signerName={doc.witness.name}
              signerDetail={doc.witness.relation}
              captionLabel="Nama dan hubungan:"
              disabled={locked || step !== 2}
              value={wSig ?? signed(doc.witness.name)}
              onChange={setWSig}
              location={doc.location}
            />
          </div>
        </section>
        {step >= 2 && !refused && !wasRefused && (
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
        {!closed && !wait && step < 3 && (
          <p className="m-0 flex gap-2.5 rounded-card border border-warning-border bg-warning-bg px-4 py-3 text-ink-700">
            <span aria-hidden="true" className="font-bold text-warning">
              !
            </span>
            Saksi kedua dari petugas dan TTE dokter dibutuhkan sebelum dokumen final. Pasien berhak menolak
            atau menarik persetujuan kapan saja.
          </p>
        )}
        {!closed && !wait && step === 3 && (
          // Kotak TTE (mockup): putih, garis brand-600, ajakan di kanan. Penyedia sertifikat belum ditetapkan di
          // dokumen (docs/03 menyebut BSrE atau PSrE swasta), jadi keduanya ditulis.
          <div className="flex flex-wrap items-center gap-3 rounded-card border-2 border-brand-600 bg-white px-4 py-3">
            <span className="flex min-w-0 flex-1 flex-col">
              <span className="font-semibold">TTE dokter pelaksana</span>
              <span className="text-ink-700">
                {doc.doctor} · sertifikat elektronik tersertifikasi (BSrE/PSrE) · pasien dan saksi sudah
                menandatangani
              </span>
            </span>
            <span className="text-[0.85em] font-semibold text-brand-700">
              Tekan &quot;Tanda tangani (TTE)&quot; di bawah
            </span>
          </div>
        )}
        {finalAt && (
          <div
            role="status"
            className="rounded-card border border-success-border bg-success-bg px-4 py-3 font-semibold text-success"
          >
            ✓ Dokumen final · TTE {doc.doctor} pukul {finalAt}. Tersimpan di rekam medis; kamar operasi dan
            kelengkapan rekam medis membaca persetujuan ini.
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
              Alasan: {refused.reason}. Tersimpan di rekam medis; DPJP perlu edukasi lanjutan dan rencana
              alternatif.
            </span>
          </div>
        )}
        {error && !refusing && (
          <span role="alert" className="font-semibold text-danger">
            {error}
          </span>
        )}
        {runError && (
          <span role="alert" className="font-semibold text-danger">
            {runError.message}
          </span>
        )}
      </main>
      <footer className="flex items-center gap-3 border-t border-line bg-white px-7 py-4">
        <button
          type="button"
          disabled={locked || !!scenario}
          title={scenario ? 'Alur skenario tidak bercabang ke penolakan.' : undefined}
          onClick={() => setRefusing(true)}
          className="min-h-[52px] cursor-pointer rounded-control border border-danger-border bg-white px-4 font-[inherit] font-semibold text-danger disabled:cursor-not-allowed disabled:opacity-45"
        >
          Saya menolak tindakan
        </button>
        <span id="consent-hint" className="flex-1 text-right text-[13px] font-semibold text-warning">
          {hint}
        </span>
        <button
          type="button"
          disabled={locked || step === 0}
          onClick={() => setStep((s) => s - 1)}
          className="min-h-[52px] cursor-pointer rounded-control border border-line-strong bg-white px-5 font-[inherit] disabled:cursor-not-allowed disabled:opacity-45"
        >
          Kembali
        </button>
        <button
          type="button"
          disabled={!canNext || busy || pending}
          aria-describedby={hint ? 'consent-hint' : undefined}
          onClick={next}
          className="min-h-[52px] cursor-pointer rounded-control border border-brand-800 bg-btn-primary px-6 font-[inherit] font-semibold text-white disabled:cursor-not-allowed disabled:border-line disabled:bg-muted disabled:bg-none disabled:text-ink-400"
        >
          {nextLabel}
        </button>
      </footer>
    </div>
  );
}
