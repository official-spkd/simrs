'use client';

import { formatJam } from '@simrs/shared';
import { Button } from '@simrs/ui';
import { useState } from 'react';

/**
 * Gerbang cek ganda obat high alert (CLAUDE.md §4.9): apoteker kedua yang bertugas, bukan penyiap, memeriksa ulang
 * obat, dosis, konsentrasi, dan kecepatan. Penyiapan tidak bisa diselesaikan sebelum terkonfirmasi.
 */
export function DoubleCheck({
  items,
  currentUser,
  done,
  busy,
  serverError,
  onConfirm,
}: {
  items: readonly string[];
  pharmacists: readonly string[];
  currentUser: string;
  done: { by: string; at: string } | null;
  busy: boolean;
  serverError: string | null;
  onConfirm: (second: string) => void;
}) {
  const [verified, setVerified] = useState(false);
  const [tried, setTried] = useState(false);
  const verifyErr = tried && !verified ? 'Centang konfirmasi pemeriksaan ulang.' : null;

  if (done) {
    return (
      <p
        role="status"
        className="m-0 rounded-control border border-success-border bg-[#F3FAF5] px-3 py-2 text-small font-semibold text-success"
      >
        ✓ Cek ganda high alert oleh {done.by} pukul {formatJam(done.at)}.
      </p>
    );
  }
  return (
    <fieldset className="m-0 flex flex-col gap-2 rounded-[12px] border border-warning-border bg-kunyit-50 p-3.5">
      <legend className="px-1 text-small font-semibold text-warning-strong">
        Cek ganda obat high alert (apoteker kedua)
      </legend>
      <ul className="m-0 list-disc pl-5 text-small text-ink-700">
        {items.map((i) => (
          <li key={i}>{i}</li>
        ))}
      </ul>
      <p className="m-0 text-small">
        Anda mencatat sebagai {currentUser}. Pemeriksaan wajib memakai sesi apoteker yang berbeda dari
        penyiap.
      </p>
      <label className="flex min-h-11 cursor-pointer items-center gap-2.5 text-small">
        <input
          type="checkbox"
          checked={verified}
          onChange={(e) => setVerified(e.target.checked)}
          className="size-[18px] flex-none accent-brand-600"
        />
        Obat, dosis, konsentrasi, dan kecepatan sudah dihitung ulang dan cocok
      </label>
      {verifyErr && <span className="text-caption text-danger">{verifyErr}</span>}
      {serverError && (
        <span role="alert" className="text-caption font-semibold text-danger">
          {serverError}
        </span>
      )}
      <span className="flex justify-end">
        <Button
          disabled={busy}
          onClick={() => {
            setTried(true);
            if (verified) onConfirm(currentUser);
          }}
        >
          Konfirmasi cek ganda
        </Button>
      </span>
    </fieldset>
  );
}
