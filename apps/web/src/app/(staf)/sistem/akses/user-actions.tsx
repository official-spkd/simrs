'use client';

import { Button } from '@simrs/ui';
import { useState, useTransition } from 'react';
import { type ActionResult, resetMfaAction, resetPasswordAction, setUserStatusAction } from './actions';
import { Done, ErrorText, TemporaryPassword } from './parts';

type Pending = 'password' | 'mfa' | 'status' | null;

const QUESTIONS: Record<Exclude<Pending, null>, (name: string, active: boolean) => string> = {
  password: (n) =>
    `Reset kata sandi ${n}? Semua sesi aktifnya dicabut dan ia wajib mengganti sandi saat login berikutnya.`,
  mfa: (n) =>
    `Reset verifikasi dua langkah ${n}? Pakai bila ponselnya hilang/ganti. Ia wajib mendaftarkan aplikasi autentikator lagi.`,
  status: (n, active) =>
    active
      ? `Nonaktifkan akun ${n}? Ia langsung keluar dari semua perangkat dan tidak bisa login sampai diaktifkan lagi.`
      : `Aktifkan kembali akun ${n}?`,
};

/** Aksi akun dengan konfirmasi eksplisit; hasil (termasuk sandi sementara) tampil sekali. */
export function UserActions({
  userId,
  username,
  displayName,
  active,
}: {
  userId: string;
  username: string;
  displayName: string;
  active: boolean;
}) {
  const [asking, setAsking] = useState<Pending>(null);
  const [busy, start] = useTransition();
  const [result, setResult] = useState<ActionResult & { temporaryPassword?: string }>({});

  const run = (which: Exclude<Pending, null>) =>
    start(async () => {
      setResult({});
      const r =
        which === 'password'
          ? await resetPasswordAction(userId)
          : which === 'mfa'
            ? await resetMfaAction(userId)
            : await setUserStatusAction(userId, active ? 'disabled' : 'active');
      setResult(r);
      setAsking(null);
    });

  return (
    <div className="flex flex-col gap-2.5">
      <div className="flex flex-wrap gap-2">
        <Button size="sm" onClick={() => setAsking('password')} disabled={busy}>
          Reset kata sandi
        </Button>
        <Button size="sm" onClick={() => setAsking('mfa')} disabled={busy}>
          Reset verifikasi dua langkah
        </Button>
        <Button
          size="sm"
          variant={active ? 'danger' : 'secondary'}
          onClick={() => setAsking('status')}
          disabled={busy}
        >
          {active ? 'Nonaktifkan akun' : 'Aktifkan kembali'}
        </Button>
      </div>
      {asking && (
        <div
          role="group"
          aria-label="Konfirmasi"
          className="flex flex-col gap-2 rounded-control border border-line bg-subtle px-3 py-2.5"
        >
          <span className="text-small text-ink-900">{QUESTIONS[asking](displayName, active)}</span>
          <div className="flex gap-2">
            <Button
              size="sm"
              variant={asking === 'status' && active ? 'danger' : 'primary'}
              onClick={() => run(asking)}
              disabled={busy}
            >
              {busy ? 'Memproses…' : 'Ya, lanjutkan'}
            </Button>
            <Button size="sm" onClick={() => setAsking(null)} disabled={busy}>
              Batal
            </Button>
          </div>
        </div>
      )}
      <ErrorText message={result.error} />
      <Done message={result.message} />
      {result.temporaryPassword && (
        <TemporaryPassword username={username} password={result.temporaryPassword} />
      )}
    </div>
  );
}
