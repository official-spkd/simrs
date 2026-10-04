'use client';

import { Button } from '@simrs/ui';
import { useActionState, useState } from 'react';
import { type ActionResult, revokePinDeviceAction } from './actions';
import { Done, ErrorText } from './parts';

/** Cabut PIN masuk cepat satu perangkat dengan konfirmasi; sesi PIN dari perangkat itu ikut berakhir (ADR-0024). */
export function RevokePinDevice({ deviceId, label }: { deviceId: string; label: string }) {
  const [asking, setAsking] = useState(false);
  const [state, action, pending] = useActionState<ActionResult, FormData>(revokePinDeviceAction, {});
  if (state.ok) return <Done message={state.message} />;
  if (!asking) {
    return (
      <Button size="sm" variant="ghost" onClick={() => setAsking(true)} aria-label={`Cabut PIN ${label}`}>
        Cabut
      </Button>
    );
  }
  return (
    <form action={action} className="flex w-full flex-col gap-2">
      <input type="hidden" name="deviceId" value={deviceId} />
      <span className="text-small text-ink-700">
        Cabut PIN di {label}? Pemiliknya harus masuk dengan kata sandi dan kode verifikasi untuk
        mendaftarkannya lagi.
      </span>
      <ErrorText message={state.error} />
      <div className="flex gap-2">
        <Button type="submit" size="sm" variant="danger" disabled={pending}>
          {pending ? 'Memproses…' : 'Cabut PIN'}
        </Button>
        <Button size="sm" onClick={() => setAsking(false)}>
          Batal
        </Button>
      </div>
    </form>
  );
}
