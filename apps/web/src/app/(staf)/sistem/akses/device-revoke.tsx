'use client';

import { Button } from '@simrs/ui';
import { useActionState, useState } from 'react';
import { type ActionResult, revokeDeviceAction } from './actions';
import { Done, ErrorText } from './parts';

const QUESTIONS = {
  pin: (label: string) =>
    `Cabut PIN di ${label}? Sesi PIN dari perangkat itu langsung berakhir; pemiliknya harus masuk dengan kata sandi dan kode verifikasi untuk mendaftarkannya lagi.`,
  trusted: (label: string) =>
    `Cabut perangkat tepercaya ${label}? Login berikutnya di perangkat itu kembali wajib kode verifikasi.`,
} as const;

/** Cabut PIN perangkat (ADR-0024) atau perangkat tepercaya (ADR-0022) milik pengguna lain, dengan konfirmasi. */
export function RevokeDevice({
  kind,
  deviceId,
  label,
}: {
  kind: 'pin' | 'trusted';
  deviceId: string;
  label: string;
}) {
  const [asking, setAsking] = useState(false);
  const [state, action, pending] = useActionState<ActionResult, FormData>(revokeDeviceAction, {});
  if (state.ok) return <Done message={state.message} />;
  if (!asking) {
    return (
      <Button
        size="sm"
        variant="ghost"
        onClick={() => setAsking(true)}
        aria-label={`Cabut ${kind === 'pin' ? 'PIN' : 'perangkat tepercaya'} ${label}`}
      >
        Cabut
      </Button>
    );
  }
  return (
    <form action={action} className="flex w-full flex-col gap-2">
      <input type="hidden" name="kind" value={kind} />
      <input type="hidden" name="deviceId" value={deviceId} />
      <span className="text-small text-ink-700">{QUESTIONS[kind](label)}</span>
      <ErrorText message={state.error} />
      <div className="flex gap-2">
        <Button type="submit" size="sm" variant="danger" disabled={pending}>
          {pending ? 'Memproses…' : kind === 'pin' ? 'Cabut PIN' : 'Cabut perangkat'}
        </Button>
        <Button size="sm" onClick={() => setAsking(false)}>
          Batal
        </Button>
      </div>
    </form>
  );
}
