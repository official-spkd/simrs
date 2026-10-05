'use client';

import { Button, Field } from '@simrs/ui';
import { useActionState } from 'react';
import { enrolDeviceAction, type EnrolState } from './actions';

/** Formulir pendaftaran perangkat: kode RS (lokal/staging) + kode sekali pakai dari admin. Target sentuh ≥ 64 px. */
export function EnrolForm({
  lanjut,
  tenantCodeField,
  defaultTenantCode,
}: {
  lanjut: string;
  tenantCodeField: boolean;
  defaultTenantCode: string;
}) {
  const [state, action, pending] = useActionState<EnrolState, FormData>(enrolDeviceAction, {});
  return (
    <form action={action} className="flex flex-col gap-5" noValidate>
      <input type="hidden" name="lanjut" value={lanjut} />
      {state.error && (
        <p
          role="alert"
          className="m-0 rounded-control border border-danger-border bg-danger-bg px-3.5 py-2.5 text-small text-danger"
        >
          {state.error}
        </p>
      )}
      {tenantCodeField && (
        <Field
          label="Kode RS"
          name="tenantCode"
          autoComplete="organization"
          autoCapitalize="characters"
          defaultValue={state.values?.tenantCode ?? defaultTenantCode}
          error={state.fields?.tenantCode}
          hint="Lingkungan lokal/staging. Di produksi RS dikenali dari alamat situs."
          hintTone="muted"
        />
      )}
      <Field
        label="Kode pendaftaran perangkat"
        name="code"
        autoComplete="off"
        autoCapitalize="characters"
        spellCheck={false}
        placeholder="XXXXX-XXXXX"
        error={state.fields?.code}
        hint="Kode 10 huruf/angka dari admin SIM RS, berlaku 15 menit dan hanya sekali pakai."
        hintTone="muted"
        className="[&_input]:h-16 [&_input]:font-mono [&_input]:text-[24px] [&_input]:tracking-[0.2em]"
      />
      <Button type="submit" variant="primary" disabled={pending} className="h-16 text-[18px]">
        {pending ? 'Mendaftarkan…' : 'Daftarkan perangkat ini'}
      </Button>
    </form>
  );
}
