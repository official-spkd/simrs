'use client';

import { Button } from '@simrs/ui';
import { useState } from 'react';

/** Pesan galat yang langsung dibacakan pembaca layar. */
export function ErrorText({ message }: { message?: string }) {
  if (!message) return null;
  return (
    <p
      role="alert"
      className="m-0 rounded-control border border-danger-border bg-danger-bg px-3 py-2 text-small text-danger"
    >
      {message}
    </p>
  );
}

/** Umpan balik berjam setelah aksi berhasil (docs/08 §5.3). */
export function Done({ message }: { message?: string }) {
  if (!message) return null;
  return (
    <p
      role="status"
      className="m-0 rounded-control border border-success-border bg-success-bg px-3 py-2 text-small text-success"
    >
      {message}
    </p>
  );
}

/**
 * Sandi sementara: tampil SEKALI di layar admin, bisa disalin, dengan pengingat cara menyerahkannya.
 * Tidak disimpan di mana pun oleh web.
 */
export function TemporaryPassword({ username, password }: { username: string; password: string }) {
  const [copied, setCopied] = useState(false);
  return (
    <div className="flex flex-col gap-2 rounded-control border border-warning-border bg-warning-bg px-3.5 py-3">
      <span className="text-small font-semibold text-warning">
        Sandi sementara untuk {username} (hanya tampil sekali)
      </span>
      <div className="flex flex-wrap items-center gap-2">
        <code
          data-testid="sandi-sementara"
          className="rounded-control bg-white px-2.5 py-1.5 font-mono text-body text-ink-900"
        >
          {password}
        </code>
        <Button
          size="sm"
          onClick={() => {
            void navigator.clipboard?.writeText(password).then(() => setCopied(true));
          }}
        >
          {copied ? 'Tersalin' : 'Salin'}
        </Button>
      </div>
      <span className="text-caption text-ink-700">
        Serahkan langsung ke pemilik akun (bukan lewat grup obrolan). Saat login pertama ia wajib mendaftarkan
        aplikasi autentikator dan mengganti kata sandi.
      </span>
    </div>
  );
}

export const selectClass =
  'h-10 rounded-control border border-line-strong bg-white px-2.5 font-[inherit] text-ink-900 disabled:bg-muted';
export const inputClass =
  'h-10 rounded-control border border-line-strong bg-white px-3 font-[inherit] text-ink-900';
