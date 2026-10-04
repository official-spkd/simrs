'use client';

import { Button, Field } from '@simrs/ui';
import { useActionState } from 'react';
import { type PinFormState, registerPinAction, removePinDeviceAction } from './actions';

function Feedback({ state }: { state: PinFormState }) {
  return (
    <>
      {state.error && (
        <p
          role="alert"
          className="m-0 rounded-control border border-danger-border bg-danger-bg px-3 py-2 text-small text-danger"
        >
          {state.error}
        </p>
      )}
      {state.message && (
        <p
          role="status"
          className="m-0 rounded-control border border-success-border bg-success-bg px-3 py-2 text-small text-success"
        >
          {state.message}
        </p>
      )}
    </>
  );
}

const pinInput = {
  type: 'password',
  inputMode: 'numeric',
  maxLength: 6,
  pattern: '[0-9]{6}',
  autoComplete: 'off',
} as const;

/** Daftarkan peramban ini: nama perangkat, PIN 6 digit (dua kali), dan kata sandi saat ini. */
export function RegisterPinForm({ defaultName, replacing }: { defaultName: string; replacing: boolean }) {
  const [state, action, pending] = useActionState<PinFormState, FormData>(registerPinAction, {});
  return (
    <form action={action} className="flex flex-col gap-4" noValidate>
      <Feedback state={state} />
      <Field
        label="Nama perangkat"
        name="name"
        defaultValue={defaultName}
        maxLength={60}
        error={state.fields?.name}
        hint="Agar mudah dikenali di daftar, mis. Komputer nurse station Melati."
        hintTone="muted"
      />
      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
        <Field
          label="PIN baru (6 digit)"
          name="pin"
          {...pinInput}
          error={state.fields?.pin}
          hint={state.fields?.pin ? undefined : 'Bukan tanggal lahir, angka berurutan, atau potongan NIP.'}
          hintTone="muted"
        />
        <Field label="Ulangi PIN" name="pinConfirm" {...pinInput} error={state.fields?.pinConfirm} />
      </div>
      <Field
        label="Kata sandi saat ini"
        name="password"
        type="password"
        autoComplete="current-password"
        error={state.fields?.password}
      />
      <span>
        <Button type="submit" variant="primary" disabled={pending}>
          {pending ? 'Menyimpan…' : replacing ? 'Ganti PIN di perangkat ini' : 'Daftarkan perangkat ini'}
        </Button>
      </span>
    </form>
  );
}

/** Hapus PIN di satu perangkat (bisa didaftarkan lagi kapan saja dari login penuh). */
export function RemovePinButton({ deviceId, name }: { deviceId: string; name: string }) {
  const [state, action, pending] = useActionState<PinFormState, FormData>(removePinDeviceAction, {});
  return (
    <form action={action} className="flex flex-col items-end gap-2">
      <input type="hidden" name="deviceId" value={deviceId} />
      <Button type="submit" disabled={pending} aria-label={`Hapus PIN di ${name}`}>
        {pending ? 'Menghapus…' : 'Hapus'}
      </Button>
      <Feedback state={state} />
    </form>
  );
}
