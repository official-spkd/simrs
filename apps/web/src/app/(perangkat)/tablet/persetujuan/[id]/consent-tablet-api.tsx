'use client';

import {
  type ConsentDraft,
  type ConsentInformationKey,
  type ConsentRecord,
  formatJam,
  SAFETY_REASON_MIN,
} from '@simrs/shared';
import { Button, Chip, cx } from '@simrs/ui';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useId, useState, useTransition } from 'react';
import { type SignatureValue, SignaturePad } from '@/components/rawat-inap/signature-pad';
import { useRefreshWhilePending } from '@/lib/use-refresh-while-pending';
import {
  attestConsentWitnessAction,
  cancelConsentDraftAction,
  finalizeConsentApiAction,
  refuseConsentApiAction,
  saveConsentSignaturesAction,
} from '../actions';
import { DraftStatusChip, educationHref, MISSING_LABEL, TteChip } from '../consent-status';
import { TABLET_CARD, TabletShell } from '../tablet-shell';
import { RefusalForm } from './consent-body';

const STEPS = ['Informasi', 'Tanda tangan pasien', 'Saksi', 'TTE dokter'];
const SIGNER_KIND = {
  pasien: 'Pasien',
  wali: 'Wali',
  saksi_keluarga: 'Saksi keluarga',
  saksi_petugas: 'Saksi petugas',
} as const;
const FIELD = 'min-h-12 rounded-control border border-line-strong bg-white px-3 font-[inherit] text-[16px]';

/** Langkah awal dari keadaan server: belum ditandatangani → informasi; sudah → saksi; lengkap → TTE. */
function initialStep(d: ConsentDraft): number {
  if (d.status !== 'draf') return 3;
  if (!d.signer) return 0;
  // Hanya edukasi tindakan yang tersisa: langsung ke langkah TTE (tautan ke layar Edukasi tampil di sana).
  return d.missing.every((m) => m === 'edukasi_tindakan') ? 3 : 2;
}

const toInput = (s: SignatureValue, relation: string | null) => ({
  name: s.name,
  relation,
  method: s.method,
  image: s.method === 'goresan' ? (s.image ?? null) : null,
});

/** Ringkasan tanda tangan tersimpan di server (nama, hubungan, cara). */
function SavedSignature({ label, sig }: { label: string; sig: NonNullable<ConsentDraft['signer']> }) {
  return (
    <div className={`flex flex-col gap-1 p-[14px] ${TABLET_CARD}`}>
      <span className="font-semibold">{label}</span>
      <span className="text-ink-700">
        {sig.name}
        {sig.relation ? ` · ${sig.relation}` : ''} · {sig.method === 'nama' ? 'nama diketik' : 'goresan'} ·
        tersimpan
      </span>
    </div>
  );
}

/**
 * K11 · Tablet persetujuan mode api (layar W5a, mockup Consent): ketujuh butir dipahami → tanda tangan pasien/wali
 * (goresan PNG atau ketik nama) + saksi keluarga opsional → atestasi saksi petugas dengan sesinya sendiri → TTE dokter
 * berelasi (`consent.sign`). Dokter juga mencatat penolakan beralasan; pemegang `consent.write` bisa membatalkan draf
 * beralasan. Keadaan berasal dari API (`missing`, status draf); galat API tampil tertulis.
 */
export function ConsentTabletApi({
  draft: serverDraft,
  consent: serverConsent,
  patient,
  me,
  canSign,
}: {
  draft: ConsentDraft;
  consent: ConsentRecord | null;
  patient: { name: string; mrn: string };
  me: { userId: string; name: string };
  canSign: boolean;
}) {
  const id = useId();
  const router = useRouter();
  // Jawaban action terbaru dipakai langsung; data server (router.refresh) menyusul.
  const [latest, setLatest] = useState<ConsentDraft | null>(null);
  const draft = latest && latest.updatedAt >= serverDraft.updatedAt ? latest : serverDraft;
  const [finalConsent, setFinalConsent] = useState<ConsentRecord | null>(null);
  const consent = serverConsent ?? finalConsent;
  const closed = draft.status !== 'draf';
  const [step, setStep] = useState(() => initialStep(serverDraft));
  const [ack, setAck] = useState<Record<string, boolean>>({});
  const [signerName, setSignerName] = useState(draft.signerKind === 'pasien' ? patient.name : '');
  const [signerRelation, setSignerRelation] = useState('');
  const [pSig, setPSig] = useState<SignatureValue | null>(null);
  const [withWitness, setWithWitness] = useState(false);
  const [witnessName, setWitnessName] = useState('');
  const [witnessRelation, setWitnessRelation] = useState('');
  const [wSig, setWSig] = useState<SignatureValue | null>(null);
  /** Tanda tangan di layar sudah tersimpan ke API (atau belum ada yang baru sejak muat). */
  const [resigning, setResigning] = useState(!serverDraft.signer);
  const [refusing, setRefusing] = useState(false);
  const [reason, setReason] = useState('');
  const [cancelling, setCancelling] = useState(false);
  const [cancelReason, setCancelReason] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [pending, start] = useTransition();
  useRefreshWhilePending(consent?.document?.signatureStatus === 'pending');

  const items = draft.information;
  const allAck = items.every((i) => ack[i.key]);
  const isWali = draft.signerKind === 'wali';
  const signerReady =
    !!pSig && signerName.trim().length >= 3 && (!isWali || signerRelation.trim().length > 0);
  const witnessReady =
    !withWitness || (!!wSig && witnessName.trim().length >= 3 && witnessRelation.trim().length > 0);
  const saved = !!draft.signer && !resigning;
  const iAmWitness = draft.staffWitness?.userId === me.userId;

  const act = <T,>(
    fn: () => Promise<({ ok: true } & T) | { ok: false; message: string }>,
    done: (r: T) => void,
  ) =>
    start(async () => {
      setError(null);
      setNotice(null);
      const r = await fn();
      if (!r.ok) return setError(r.message);
      done(r);
      router.refresh();
    });

  const saveSignatures = () => {
    if (!pSig || !signerReady || !witnessReady) return;
    act(
      () =>
        saveConsentSignaturesAction({
          draftId: draft.id,
          acknowledged: items.map((i) => i.key as ConsentInformationKey),
          signer: toInput({ ...pSig, name: signerName.trim() }, isWali ? signerRelation.trim() : null),
          familyWitness:
            withWitness && wSig
              ? toInput({ ...wSig, name: witnessName.trim() }, witnessRelation.trim())
              : null,
        }),
      (r: { draft: ConsentDraft }) => {
        setLatest(r.draft);
        setResigning(false);
        setNotice('Tanda tangan tersimpan. Saksi petugas menyatakan kehadirannya dengan sesinya sendiri.');
      },
    );
  };

  const eduMissing = draft.missing.includes('edukasi_tindakan');
  let canNext = false;
  let nextLabel = 'Lanjut';
  let hint = '';
  if (closed) {
    // Draf tertutup: kaki hanya menulis "Dokumen terkunci".
  } else if (step === 0) {
    canNext = allAck;
    nextLabel = 'Lanjut ke tanda tangan';
    if (!canNext) hint = 'Centang ketujuh butir informasi yang sudah dipahami.';
  } else if (step === 1) {
    canNext = saved || signerReady;
    nextLabel = 'Lanjut ke saksi';
    if (!canNext) {
      hint =
        isWali && !signerRelation.trim()
          ? 'Isi nama dan hubungan wali, lalu tanda tangan.'
          : 'Pasien/wali belum menandatangani.';
    }
  } else if (step === 2) {
    // Edukasi tindakan tidak menghalangi lanjut ke langkah TTE: di sana tautan ke layar Edukasi ditampilkan.
    const signing = draft.missing.filter((m) => m !== 'edukasi_tindakan');
    canNext = saved && signing.length === 0;
    nextLabel = 'Lanjut ke TTE dokter';
    if (!saved) hint = 'Simpan tanda tangan dulu.';
    else if (signing.length > 0) hint = `Menunggu ${MISSING_LABEL[signing[0]!]}.`;
  } else {
    canNext = canSign && !iAmWitness && draft.missing.length === 0;
    nextLabel = 'Tanda tangani (TTE)';
    if (!canSign) hint = 'TTE oleh dokter berelasi (DPJP/rawat bersama): masuk dengan sesi dokter.';
    else if (iAmWitness) hint = 'Saksi petugas harus orang lain dari dokter yang menandatangani.';
    else if (draft.missing.length > 0) hint = `Menunggu ${MISSING_LABEL[draft.missing[0]!]}.`;
  }

  const next = () => {
    if (!canNext || pending || closed) return;
    if (step < 3) return setStep(step + 1);
    act(
      () => finalizeConsentApiAction({ draftId: draft.id }),
      (r: { consent: ConsentRecord }) => setFinalConsent(r.consent),
    );
  };

  const statusBadge = (
    <span className="mt-1 flex flex-wrap gap-1.5">
      <DraftStatusChip draft={draft} />
      {consent && <TteChip consent={consent} />}
    </span>
  );

  return (
    <TabletShell
      context={`Persetujuan tindakan kedokteran · ${patient.name} · RM ${patient.mrn}`}
      title={draft.procedure}
      badge={statusBadge}
      aside={
        <Link
          href={`/tablet/persetujuan?kunjungan=${draft.encounterId}`}
          className="inline-flex min-h-12 items-center rounded-control border border-line-strong bg-white px-4 text-[15px] font-semibold text-ink-900 no-underline"
        >
          Daftar persetujuan
        </Link>
      }
      footer={
        closed ? (
          <span className="flex-1 text-right text-[14px] text-ink-700">Dokumen terkunci.</span>
        ) : (
          <>
            {canSign && (
              <button
                type="button"
                disabled={pending}
                onClick={() => setRefusing(true)}
                className="min-h-[52px] cursor-pointer rounded-control border border-danger-border bg-white px-4 font-[inherit] font-semibold text-danger disabled:cursor-not-allowed disabled:opacity-45"
              >
                Pasien menolak tindakan
              </button>
            )}
            <span id={`${id}-hint`} className="flex-1 text-right text-[13px] font-semibold text-warning">
              {hint}
            </span>
            {eduMissing && (
              <Link
                href={educationHref(draft)}
                className="inline-flex min-h-[52px] items-center rounded-control border border-line-strong bg-white px-4 text-[15px] font-semibold text-ink-900 no-underline"
              >
                Isi edukasi tindakan
              </Link>
            )}
            <button
              type="button"
              disabled={step === 0 || pending}
              onClick={() => setStep((s) => s - 1)}
              className="min-h-[52px] cursor-pointer rounded-control border border-line-strong bg-white px-5 font-[inherit] disabled:cursor-not-allowed disabled:opacity-45"
            >
              Kembali
            </button>
            <button
              type="button"
              disabled={!canNext || pending}
              aria-describedby={hint ? `${id}-hint` : undefined}
              onClick={next}
              className="min-h-[52px] cursor-pointer rounded-control border border-transparent bg-btn-primary px-6 font-[inherit] font-semibold text-white shadow-button disabled:cursor-not-allowed disabled:border-line disabled:bg-muted disabled:bg-none disabled:text-ink-400 disabled:shadow-none"
            >
              {pending && step === 3 ? 'Menandatangani…' : nextLabel}
            </button>
          </>
        )
      }
    >
      {!closed && (
        <nav aria-label="Langkah" className="grid grid-cols-4 gap-1.5">
          {STEPS.map((label, i) => (
            <span
              key={label}
              aria-current={i === step ? 'step' : undefined}
              className={cx(
                'flex items-center rounded-control px-3 py-2.5 text-[13px]',
                i === step
                  ? 'bg-btn-primary font-semibold text-white shadow-[0_6px_16px_rgba(23,32,46,0.18)]'
                  : i < step
                    ? 'bg-zamrud-100 font-semibold text-zamrud-700'
                    : 'bg-ink-900/5 font-medium text-ink-700',
              )}
            >
              {i + 1}. {label}
              {i < step && <span className="sr-only"> (selesai)</span>}
            </span>
          ))}
        </nav>
      )}

      {draft.status === 'final' && (
        <div
          role="status"
          className="rounded-[14px] border border-success-border bg-alert-success px-4 py-3 font-semibold text-success"
        >
          ✓ Dokumen final
          {consent
            ? ` · ditandatangani ${consent.informer.nama} · ${
                consent.document?.signatureStatus === 'signed'
                  ? 'TTE sah'
                  : consent.document?.signatureStatus === 'failed'
                    ? 'TTE gagal, minta ulang dari Dokumen & TTE'
                    : 'TTE diproses'
              }`
            : ''}
          . Tersimpan di rekam medis; perubahan hanya lewat pencabutan.
        </div>
      )}
      {closed && consent && consent.signatures.length > 0 && (
        <section aria-label="Tanda tangan tercatat" className={`flex flex-col gap-1 p-4 ${TABLET_CARD}`}>
          <h2 className="m-0 text-[1.05em] font-semibold">Tanda tangan tercatat</h2>
          <ul className="m-0 list-none p-0">
            {consent.signatures.map((s) => (
              <li key={`${s.signerKind}-${s.signerName}`} className="py-1 text-ink-700">
                <span className="font-semibold text-ink-900">{SIGNER_KIND[s.signerKind]}</span>:{' '}
                {s.signerName}
                {s.relation ? ` · ${s.relation}` : ''} · {s.method === 'nama' ? 'nama diketik' : 'goresan'} ·{' '}
                {formatJam(s.signedAt)}
              </li>
            ))}
          </ul>
        </section>
      )}
      {draft.status === 'ditolak' && (
        <div
          role="status"
          className="flex flex-col gap-1 rounded-[14px] border border-danger-border bg-alert-critical px-4 py-3"
        >
          <span className="font-semibold text-danger-strong">
            Pasien menolak tindakan · penolakan tercatat
            {draft.closedAt ? ` ${formatJam(draft.closedAt)}` : ''}
            {consent?.document?.signatureStatus
              ? ` · ${consent.document.signatureStatus === 'signed' ? 'TTE sah' : 'TTE diproses'}`
              : ''}
          </span>
          {consent?.refusalReason && <span className="text-ink-700">Alasan: {consent.refusalReason}</span>}
        </div>
      )}
      {draft.status === 'batal' && (
        <div role="status" className={`px-4 py-3 ${TABLET_CARD}`}>
          <span className="font-semibold">Draf dibatalkan</span>
          {draft.cancelReason ? ` · alasan: ${draft.cancelReason}` : ''}. Tidak menjadi rekam medis.
        </div>
      )}

      <section aria-label="Informasi tindakan" className={`flex flex-col gap-2 p-4 ${TABLET_CARD}`}>
        <div className="flex items-baseline justify-between gap-3">
          <h2 className="m-0 text-[1.1em] font-semibold">Informasi tindakan</h2>
          {!closed && (
            <span
              className={cx(
                'text-[0.85em] font-semibold',
                allAck || step > 0 ? 'text-success' : 'text-warning',
              )}
            >
              {step > 0
                ? 'Ketujuh butir dipahami'
                : `${items.filter((i) => ack[i.key]).length} dari ${items.length} dipahami`}
            </span>
          )}
        </div>
        <ol className="m-0 flex list-none flex-col gap-1 p-0">
          {items.map((i, k) => (
            <li key={i.key} className="border-b border-line-soft py-2 last:border-b-0">
              <label
                className={cx('flex gap-3', step === 0 && !closed ? 'cursor-pointer' : 'cursor-default')}
              >
                {!closed && (
                  <input
                    type="checkbox"
                    checked={step > 0 || !!ack[i.key]}
                    disabled={step !== 0 || pending}
                    onChange={() => setAck((a) => ({ ...a, [i.key]: !a[i.key] }))}
                    aria-label={`Saya memahami: ${i.title}`}
                    className="mt-1 size-6 flex-none accent-brand-600"
                  />
                )}
                <span className="flex flex-col gap-0.5">
                  <span className="font-semibold">
                    {k + 1}. {i.title}
                  </span>
                  <span className="whitespace-pre-line text-ink-700">{i.body}</span>
                </span>
              </label>
            </li>
          ))}
        </ol>
        <p className="m-0 rounded-control border border-info-border bg-alert-info px-3 py-2 text-[0.85em] text-info">
          Draf disiapkan {draft.createdBy.nama}
          {draft.explainedAt ? ` · dijelaskan ${formatJam(draft.explainedAt)}` : ''} · pasien diberi
          kesempatan bertanya
        </p>
      </section>

      {!closed && step >= 1 && (
        <section aria-label="Tanda tangan" className="flex flex-col gap-3">
          {saved && draft.signer ? (
            <div className="grid grid-cols-2 gap-4">
              <SavedSignature label="Pemberi persetujuan" sig={draft.signer} />
              {draft.familyWitness ? (
                <SavedSignature label="Saksi keluarga" sig={draft.familyWitness} />
              ) : (
                <div className={`p-[14px] text-ink-700 ${TABLET_CARD}`}>Tanpa saksi keluarga.</div>
              )}
              <Button
                className="col-span-2 h-12 w-fit"
                disabled={pending}
                onClick={() => {
                  setResigning(true);
                  setPSig(null);
                  setWSig(null);
                  setStep(1);
                }}
              >
                Ulangi tanda tangan
              </Button>
            </div>
          ) : (
            <>
              <div className={`flex flex-col gap-3 p-[14px] ${TABLET_CARD}`}>
                <div className="grid grid-cols-2 gap-3">
                  <label htmlFor={`${id}-nama`} className="flex flex-col gap-1 font-semibold">
                    {isWali ? 'Nama wali' : 'Nama pasien'}
                    <input
                      id={`${id}-nama`}
                      value={signerName}
                      maxLength={80}
                      disabled={step !== 1 || pending}
                      onChange={(e) => {
                        setSignerName(e.target.value);
                        setPSig(null);
                      }}
                      className={FIELD}
                    />
                  </label>
                  {isWali && (
                    <label htmlFor={`${id}-hubungan`} className="flex flex-col gap-1 font-semibold">
                      Hubungan dengan pasien
                      <input
                        id={`${id}-hubungan`}
                        value={signerRelation}
                        maxLength={40}
                        disabled={step !== 1 || pending}
                        onChange={(e) => setSignerRelation(e.target.value)}
                        className={FIELD}
                      />
                    </label>
                  )}
                </div>
                <SignaturePad
                  label={isWali ? 'Tanda tangan wali' : 'Tanda tangan pasien'}
                  signerName={signerName.trim() || 'Pemberi persetujuan'}
                  disabled={step !== 1 || pending || signerName.trim().length < 3}
                  value={pSig}
                  onChange={setPSig}
                />
              </div>
              {step >= 2 && (
                <div className={`flex flex-col gap-3 p-[14px] ${TABLET_CARD}`}>
                  <label className="flex min-h-12 cursor-pointer items-center gap-3 font-semibold">
                    <input
                      type="checkbox"
                      checked={withWitness}
                      disabled={pending}
                      onChange={() => {
                        setWithWitness((v) => !v);
                        setWSig(null);
                      }}
                      className="size-6 accent-brand-600"
                    />
                    Ada saksi keluarga
                  </label>
                  {withWitness && (
                    <>
                      <div className="grid grid-cols-2 gap-3">
                        <label htmlFor={`${id}-saksi`} className="flex flex-col gap-1 font-semibold">
                          Nama saksi keluarga
                          <input
                            id={`${id}-saksi`}
                            value={witnessName}
                            maxLength={80}
                            disabled={pending}
                            onChange={(e) => {
                              setWitnessName(e.target.value);
                              setWSig(null);
                            }}
                            className={FIELD}
                          />
                        </label>
                        <label htmlFor={`${id}-saksi-hub`} className="flex flex-col gap-1 font-semibold">
                          Hubungan saksi dengan pasien
                          <input
                            id={`${id}-saksi-hub`}
                            value={witnessRelation}
                            maxLength={40}
                            disabled={pending}
                            onChange={(e) => setWitnessRelation(e.target.value)}
                            className={FIELD}
                          />
                        </label>
                      </div>
                      <SignaturePad
                        label="Saksi (keluarga)"
                        signerName={witnessName.trim() || 'Saksi keluarga'}
                        disabled={pending || witnessName.trim().length < 3}
                        value={wSig}
                        onChange={setWSig}
                      />
                    </>
                  )}
                  <Button
                    variant="primary"
                    className="h-12 w-fit"
                    disabled={!signerReady || !witnessReady || pending}
                    onClick={saveSignatures}
                  >
                    {pending ? 'Menyimpan…' : 'Simpan tanda tangan'}
                  </Button>
                </div>
              )}
            </>
          )}
        </section>
      )}

      {!closed && step >= 2 && saved && (
        <section aria-label="Saksi petugas" className={`flex flex-col gap-2 p-4 ${TABLET_CARD}`}>
          <h2 className="m-0 text-[1.05em] font-semibold">Saksi kedua (petugas)</h2>
          {draft.staffWitness && !draft.missing.includes('saksi_kedaluwarsa') ? (
            <span className="flex flex-wrap items-center gap-2">
              <Chip tone="success">Saksi petugas tercatat</Chip>
              {draft.staffWitness.nama} · {formatJam(draft.staffWitness.attestedAt)} · berlaku sampai{' '}
              {formatJam(draft.staffWitness.expiresAt)}
            </span>
          ) : (
            <>
              <span className="text-ink-700">
                Petugas yang hadir saat penjelasan dan penandatanganan menyatakan kehadirannya dengan sesinya
                sendiri (berlaku 30 menit). Dokter yang menandatangani TTE tidak boleh menjadi saksi.
              </span>
              <Button
                className="h-12 w-fit"
                disabled={pending}
                onClick={() =>
                  act(
                    () => attestConsentWitnessAction({ draftId: draft.id }),
                    (r: { draft: ConsentDraft }) => {
                      setLatest(r.draft);
                      setNotice('Atestasi saksi petugas tercatat.');
                    },
                  )
                }
              >
                Saya ({me.name}) hadir sebagai saksi petugas
              </Button>
            </>
          )}
        </section>
      )}

      {!closed && step === 3 && canSign && !iAmWitness && (
        <div className="flex flex-wrap items-center gap-3 rounded-card border-2 border-brand-600 bg-white/95 px-4 py-3 shadow-card">
          <span className="flex min-w-0 flex-1 flex-col">
            <span className="font-semibold">TTE dokter pemberi penjelasan</span>
            <span className="text-ink-700">
              {me.name} · sertifikat elektronik tersertifikasi (BSrE/PSrE) · pasien dan saksi sudah
              menandatangani
            </span>
          </span>
          <span className="text-[0.85em] font-semibold text-brand-700">
            Tekan &quot;Tanda tangani (TTE)&quot; di bawah
          </span>
        </div>
      )}

      {refusing && !closed && (
        <RefusalForm
          reason={reason}
          error={error}
          busy={pending}
          onReason={(v) => {
            setReason(v);
            setError(null);
          }}
          onCancel={() => {
            setRefusing(false);
            setReason('');
            setError(null);
          }}
          onConfirm={() => {
            if (reason.trim().length < SAFETY_REASON_MIN) {
              setError(`Alasan penolakan wajib diisi (minimal ${SAFETY_REASON_MIN} karakter).`);
              return;
            }
            act(
              () => refuseConsentApiAction({ draftId: draft.id, reason: reason.trim() }),
              (r: { consent: ConsentRecord }) => {
                setFinalConsent(r.consent);
                setRefusing(false);
              },
            );
          }}
        />
      )}

      {!closed && (
        <div className="flex flex-col gap-2">
          {cancelling ? (
            <form
              className={`flex flex-col gap-2 p-4 ${TABLET_CARD}`}
              onSubmit={(e) => {
                e.preventDefault();
                if (cancelReason.trim().length < SAFETY_REASON_MIN) return;
                act(
                  () => cancelConsentDraftAction({ draftId: draft.id, reason: cancelReason.trim() }),
                  (r: { draft: ConsentDraft }) => {
                    setLatest(r.draft);
                    setCancelling(false);
                  },
                );
              }}
            >
              <label htmlFor={`${id}-batal`} className="flex flex-col gap-1 font-semibold">
                Alasan membatalkan draf (wajib, minimal {SAFETY_REASON_MIN} karakter)
                <textarea
                  id={`${id}-batal`}
                  rows={2}
                  maxLength={500}
                  value={cancelReason}
                  onChange={(e) => setCancelReason(e.target.value)}
                  className="rounded-control border border-line-strong bg-white px-3 py-2 font-[inherit] font-normal"
                />
              </label>
              <span className="flex flex-wrap justify-end gap-2">
                <Button className="h-12" disabled={pending} onClick={() => setCancelling(false)}>
                  Tutup
                </Button>
                <Button
                  type="submit"
                  variant="danger"
                  className="h-12"
                  disabled={pending || cancelReason.trim().length < SAFETY_REASON_MIN}
                >
                  Batalkan draf
                </Button>
              </span>
            </form>
          ) : (
            <Button
              variant="ghost"
              className="h-12 w-fit"
              disabled={pending}
              onClick={() => setCancelling(true)}
            >
              Batalkan draf ini
            </Button>
          )}
        </div>
      )}

      {notice && (
        <p role="status" className="m-0 rounded-[14px] bg-alert-success px-4 py-3 font-semibold text-success">
          {notice}
        </p>
      )}
      {error && !refusing && (
        <span role="alert" className="font-semibold text-danger">
          {error}
        </span>
      )}
    </TabletShell>
  );
}
