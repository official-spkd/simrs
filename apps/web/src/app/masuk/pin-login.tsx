'use client';

import { cx } from '@simrs/ui';
import { useActionState, useState } from 'react';
import { type FormState, pinLoginAction } from './actions';
import { FormError, OtpInput, SubmitButton } from './form-parts';
import { StepCard } from './login-shell';

export interface PinAccountOption {
  id: string;
  displayName: string;
  roleName: string;
  unitName: string | null;
}

/**
 * Masuk cepat dengan PIN (docs/05 §1, ADR-0024): hanya tampil di peramban yang mengingat akun ber-PIN. Pilih akun
 * (satu akun langsung terpilih), ketik PIN 6 digit; posisi mengikuti pendaftaran PIN sehingga langkah kode
 * verifikasi dan pilih posisi dilewati. Mengikuti gaya kotak kode verifikasi di mockup Login.
 */
export function PinLogin({ lanjut, accounts }: { lanjut: string; accounts: PinAccountOption[] }) {
  const [state, action] = useActionState<FormState, FormData>(pinLoginAction, {});
  const [picked, setPicked] = useState<string>(
    state.values?.deviceId ?? (accounts.length === 1 ? (accounts[0]?.id ?? '') : ''),
  );
  return (
    <section aria-label="Masuk dengan PIN">
      <StepCard
        title="Masuk dengan PIN"
        description="Perangkat ini terdaftar untuk masuk cepat. Pilih akun Anda, lalu ketik PIN 6 digit."
      >
        <form action={action} className="flex flex-col gap-[18px]">
          <input type="hidden" name="lanjut" value={lanjut} />
          <FormError message={state.error} />
          <fieldset className="m-0 grid grid-cols-1 gap-2 border-0 p-0 sm:grid-cols-2">
            <legend className="sr-only">Akun ber-PIN di perangkat ini</legend>
            {accounts.map((a) => {
              const on = a.id === picked;
              return (
                <label
                  key={a.id}
                  className={cx(
                    'flex min-h-14 cursor-pointer flex-col justify-center rounded-control border px-3 py-2.5 text-small has-[:focus-visible]:outline-2 has-[:focus-visible]:outline-brand-600',
                    on ? 'border-brand-600 bg-selected' : 'border-line bg-white',
                  )}
                >
                  <input
                    type="radio"
                    name="deviceId"
                    value={a.id}
                    checked={on}
                    onChange={() => setPicked(a.id)}
                    className="sr-only"
                  />
                  <span className={cx('font-semibold', on ? 'text-brand-700' : 'text-ink-900')}>
                    {a.displayName}
                  </span>
                  <span className="text-caption text-ink-500">
                    {a.roleName}
                    {a.unitName ? ` · ${a.unitName}` : ''}
                  </span>
                </label>
              );
            })}
          </fieldset>
          {/* Kunci = pesan galat: setelah PIN salah, kotak dikosongkan dan fokus kembali ke digit pertama. */}
          <OtpInput
            key={state.fields?.pin ?? state.error ?? ''}
            error={state.fields?.pin}
            label="PIN"
            name="pin"
            masked
            digitLabel="Digit PIN"
          />
          <SubmitButton pending="Memeriksa PIN…">Masuk dengan PIN</SubmitButton>
          <span className="text-center text-caption text-ink-500">
            Bukan akun Anda, atau PIN terkunci? Masuk dengan kata sandi di bawah.
          </span>
        </form>
      </StepCard>
    </section>
  );
}
