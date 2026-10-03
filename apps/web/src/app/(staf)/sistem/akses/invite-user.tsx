'use client';

import { Button, Field } from '@simrs/ui';
import { useActionState, useRef, useState } from 'react';
import { useFormStatus } from 'react-dom';
import { type InviteResult, inviteUserAction } from './actions';
import { ErrorText, selectClass, TemporaryPassword } from './parts';

interface Option {
  value: string;
  label: string;
}

function Submit() {
  const { pending } = useFormStatus();
  return (
    <Button type="submit" variant="primary" disabled={pending}>
      {pending ? 'Membuat…' : 'Buat akun'}
    </Button>
  );
}

function InviteForm({ roles, units, onClose }: { roles: Option[]; units: Option[]; onClose: () => void }) {
  const [state, action] = useActionState<InviteResult, FormData>(inviteUserAction, {});
  if (state.created) {
    return (
      <div className="flex flex-col gap-4">
        <h2 id="undang-judul" className="m-0 text-h2 font-semibold">
          Akun dibuat
        </h2>
        <TemporaryPassword username={state.created.username} password={state.created.temporaryPassword} />
        <div className="flex justify-end">
          <Button variant="primary" onClick={onClose}>
            Selesai
          </Button>
        </div>
      </div>
    );
  }
  return (
    <form action={action} className="flex flex-col gap-4" noValidate>
      <h2 id="undang-judul" className="m-0 text-h2 font-semibold">
        Undang pengguna
      </h2>
      <p className="m-0 text-small text-ink-700">
        Sistem membuat kata sandi sementara. Pemilik akun wajib mengaktifkan verifikasi dua langkah dan
        mengganti sandi saat login pertama.
      </p>
      <ErrorText message={state.error} />
      <Field
        label="NIP atau email RS"
        name="username"
        required
        autoComplete="off"
        defaultValue={state.values?.username}
        error={state.fields?.username}
        hint="Dipakai untuk login."
        hintTone="muted"
      />
      <Field
        label="Nama tampilan"
        name="displayName"
        required
        defaultValue={state.values?.displayName}
        error={state.fields?.displayName}
        hint="Mis. Rina Wulandari, S.Kep"
        hintTone="muted"
      />
      <Field
        label="Email (opsional)"
        name="email"
        type="email"
        defaultValue={state.values?.email}
        error={state.fields?.email}
      />
      <div className="grid gap-3 sm:grid-cols-2">
        <label className="flex flex-col gap-1.5 text-small font-semibold text-ink-700">
          Peran
          <select name="roleCode" defaultValue={state.values?.roleCode ?? ''} className={selectClass}>
            <option value="">Tanpa peran (atur nanti)</option>
            {roles.map((r) => (
              <option key={r.value} value={r.value}>
                {r.label}
              </option>
            ))}
          </select>
        </label>
        <label className="flex flex-col gap-1.5 text-small font-semibold text-ink-700">
          Unit
          <select name="unitId" defaultValue={state.values?.unitId ?? ''} className={selectClass}>
            <option value="">Semua unit</option>
            {units.map((u) => (
              <option key={u.value} value={u.value}>
                {u.label}
              </option>
            ))}
          </select>
        </label>
      </div>
      <div className="flex justify-end gap-2">
        <Button onClick={onClose}>Batal</Button>
        <Submit />
      </div>
    </form>
  );
}

/** "+ Undang pengguna" (mockup Akses): dialog bawaan browser (fokus terkunci, Esc menutup). */
export function InviteUser({ roles, units }: { roles: Option[]; units: Option[] }) {
  const dialog = useRef<HTMLDialogElement>(null);
  const [round, setRound] = useState(0);
  const close = () => {
    dialog.current?.close();
    // Formulir baru setiap kali dibuka: sandi sementara sebelumnya tidak tertinggal di memori komponen.
    setRound((n) => n + 1);
  };
  return (
    <>
      <Button variant="primary" onClick={() => dialog.current?.showModal()}>
        + Undang pengguna
      </Button>
      <dialog
        ref={dialog}
        aria-labelledby="undang-judul"
        onClose={() => setRound((n) => n + 1)}
        className="m-auto w-[min(520px,calc(100vw-32px))] rounded-card border border-line bg-card p-6 shadow-card backdrop:bg-ink-900/40"
      >
        <InviteForm key={round} roles={roles} units={units} onClose={close} />
      </dialog>
    </>
  );
}
