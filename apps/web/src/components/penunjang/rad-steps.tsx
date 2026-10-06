'use client';

import type { RadiologyExam } from '@simrs/shared';
import { Button, cx } from '@simrs/ui';
import { useId, useState } from 'react';
import { doseError, parseDecimal, startError } from '@/lib/penunjang-radiologi';

const box = 'flex flex-col gap-2.5 rounded-card border border-white/95 bg-white/90 shadow-card px-4 py-3.5';

function Check({
  checked,
  onChange,
  children,
}: {
  checked: boolean;
  onChange: (v: boolean) => void;
  children: string;
}) {
  return (
    <label className="flex min-h-11 cursor-pointer items-center gap-2.5 text-small">
      <input
        type="checkbox"
        checked={checked}
        onChange={(e) => onChange(e.target.checked)}
        className="size-[18px] flex-none accent-brand-600"
      />
      {children}
    </label>
  );
}

/** Mulai pemeriksaan: identitas 2 penanda; pemeriksaan berkontras wajib skrining (eGFR, alergi, puasa). */
export function RadStart({
  exam,
  busy,
  serverError,
  onStart,
}: {
  exam: RadiologyExam;
  busy: boolean;
  serverError: string | null;
  onStart: (identity: boolean, contrast: boolean) => void;
}) {
  const [identity, setIdentity] = useState(false);
  const [contrast, setContrast] = useState(false);
  const reason = startError(exam, identity, contrast);
  return (
    <section aria-label="Mulai pemeriksaan" className={box}>
      <h3 className="m-0 text-[15px] font-semibold">Mulai pemeriksaan</h3>
      <Check checked={identity} onChange={setIdentity}>
        Identitas dicek dengan 2 penanda (nama dan tanggal lahir) dan cocok dengan order
      </Check>
      {exam.contrast && (
        <Check checked={contrast} onChange={setContrast}>
          Skrining kontras: eGFR, riwayat alergi kontras, dan puasa sudah diperiksa
        </Check>
      )}
      {serverError && (
        <span role="alert" className="text-caption font-semibold text-danger">
          {serverError}
        </span>
      )}
      <div className="flex flex-wrap items-center justify-end gap-2.5">
        {reason && <span className="text-[12.5px] font-semibold text-warning">{reason}</span>}
        <Button variant="primary" disabled={busy || !!reason} onClick={() => onStart(identity, contrast)}>
          Mulai pemeriksaan
        </Button>
      </div>
    </section>
  );
}

/** Selesai akuisisi: CT wajib mencatat dosis radiasi (CTDIvol, DLP) sebelum masuk antrean ekspertise. */
export function RadFinish({
  exam,
  busy,
  serverError,
  onFinish,
}: {
  exam: RadiologyExam;
  busy: boolean;
  serverError: string | null;
  onFinish: (ctdiVol: number | null, dlp: number | null) => void;
}) {
  const id = useId();
  const [ctdi, setCtdi] = useState('');
  const [dlp, setDlp] = useState('');
  const ct = exam.modality === 'CT';
  const reason = doseError(exam.modality, parseDecimal(ctdi), parseDecimal(dlp));
  const input = (invalid: boolean) =>
    cx(
      'h-11 w-full rounded-control border px-3 font-[inherit]',
      invalid ? 'border-danger' : 'border-line-strong',
    );
  return (
    <section aria-label="Selesai pemeriksaan" className={box}>
      <h3 className="m-0 text-[15px] font-semibold">Akuisisi citra</h3>
      <p className="m-0 text-small text-ink-700">
        Citra dikirim ke PACS (DICOM) lalu masuk antrean ekspertise radiolog.
        {ct ? ' Dosis radiasi CT wajib dicatat.' : ''}
      </p>
      {ct && (
        <div className="grid grid-cols-1 gap-2.5 sm:grid-cols-2">
          <span className="flex flex-col gap-1">
            <label htmlFor={`${id}-ctdi`} className="text-small font-semibold text-ink-700">
              CTDIvol (mGy)
            </label>
            <input
              id={`${id}-ctdi`}
              inputMode="decimal"
              value={ctdi}
              onChange={(e) => setCtdi(e.target.value)}
              className={input(!!ctdi && parseDecimal(ctdi) === null)}
            />
          </span>
          <span className="flex flex-col gap-1">
            <label htmlFor={`${id}-dlp`} className="text-small font-semibold text-ink-700">
              DLP (mGy·cm)
            </label>
            <input
              id={`${id}-dlp`}
              inputMode="decimal"
              value={dlp}
              onChange={(e) => setDlp(e.target.value)}
              className={input(!!dlp && parseDecimal(dlp) === null)}
            />
          </span>
        </div>
      )}
      {serverError && (
        <span role="alert" className="text-caption font-semibold text-danger">
          {serverError}
        </span>
      )}
      <div className="flex flex-wrap items-center justify-end gap-2.5">
        {reason && <span className="text-[12.5px] font-semibold text-warning">{reason}</span>}
        <Button
          variant="primary"
          disabled={busy || !!reason}
          onClick={() => onFinish(parseDecimal(ctdi), parseDecimal(dlp))}
        >
          Selesai, kirim ke ekspertise
        </Button>
      </div>
    </section>
  );
}
