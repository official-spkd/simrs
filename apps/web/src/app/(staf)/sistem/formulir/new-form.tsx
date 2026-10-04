'use client';

import { FORM_CATEGORIES } from '@simrs/shared';
import { Button, Field } from '@simrs/ui';
import { useActionState } from 'react';
import { useFormStatus } from 'react-dom';
import { createFormAction, type FormActionResult } from './actions';

function SubmitButton() {
  const { pending } = useFormStatus();
  return (
    <Button type="submit" variant="primary" disabled={pending}>
      {pending ? 'Membuat draf…' : 'Buat draf formulir'}
    </Button>
  );
}

/** Formulir baru: kode tetap (dipakai isian dan integrasi), judul, kategori, profesi yang boleh mengisi. */
export function NewFormCard({ roles }: { roles: Array<{ code: string; label: string }> }) {
  const [state, action] = useActionState<FormActionResult, FormData>(createFormAction, {});
  return (
    <form
      action={action}
      className="flex flex-col gap-3 rounded-card border border-line bg-card px-[18px] py-4"
    >
      <h2 className="m-0 text-body font-semibold">Formulir baru</h2>
      <Field
        label="Kode formulir"
        name="code"
        required
        pattern="[a-z][a-z0-9_]{2,40}"
        maxLength={41}
        autoComplete="off"
        spellCheck={false}
        className="[&_input]:font-mono"
        hint="Huruf kecil, angka, garis bawah (mis. skrining_nyeri). Tidak bisa diubah setelah dibuat."
        hintTone="muted"
      />
      <Field label="Judul" name="title" required minLength={3} maxLength={200} autoComplete="off" />
      <div className="flex flex-col gap-1.5">
        <label htmlFor="kategoriBaru" className="text-small font-semibold text-ink-700">
          Kategori
        </label>
        <select
          id="kategoriBaru"
          name="category"
          defaultValue="keperawatan"
          className="h-10 rounded-control border border-line-strong bg-white px-3 font-[inherit]"
        >
          {Object.entries(FORM_CATEGORIES).map(([value, label]) => (
            <option key={value} value={value}>
              {label}
            </option>
          ))}
        </select>
      </div>
      <fieldset className="m-0 flex flex-col gap-1.5 border-0 p-0">
        <legend className="mb-1.5 p-0 text-small font-semibold text-ink-700">
          Profesi yang boleh mengisi
        </legend>
        {roles.map((r) => (
          <label key={r.code} className="flex min-h-8 items-center gap-2.5 text-small">
            <input
              type="checkbox"
              name="writeRoles"
              value={r.code}
              defaultChecked={r.code === 'perawat'}
              className="size-[18px] accent-brand-600"
            />
            {r.label}
          </label>
        ))}
      </fieldset>
      <Field
        label="Catatan perubahan"
        name="changeNote"
        required
        minLength={3}
        maxLength={300}
        defaultValue="Formulir baru"
      />
      {state.error && (
        <p role="alert" className="m-0 text-small text-danger">
          {state.error}
        </p>
      )}
      <span>
        <SubmitButton />
      </span>
    </form>
  );
}
