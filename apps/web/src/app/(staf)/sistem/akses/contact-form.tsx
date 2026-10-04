'use client';

import { Button, Field } from '@simrs/ui';
import { useActionState } from 'react';
import { type ActionResult, updateContactAction } from './actions';
import { Done, ErrorText } from './parts';

/**
 * Kontak notifikasi akun (email + no. HP/WhatsApp). No. HP tersimpan hanya ditampilkan tersamar; kolom kosong
 * berarti tidak diubah, kecuali "hapus no. HP" dicentang.
 */
export function ContactForm({
  userId,
  email,
  maskedPhone,
}: {
  userId: string;
  email: string | null;
  maskedPhone: string | null;
}) {
  const [state, action, pending] = useActionState<ActionResult, FormData>(updateContactAction, {});
  return (
    <form action={action} className="flex flex-col gap-2.5">
      <input type="hidden" name="userId" value={userId} />
      <div className="grid gap-3 sm:grid-cols-2">
        <Field
          label="Email"
          name="email"
          type="email"
          defaultValue={email ?? ''}
          error={state.fields?.email}
        />
        <Field
          label="No. HP / WhatsApp"
          name="phone"
          type="tel"
          inputMode="tel"
          autoComplete="off"
          placeholder={maskedPhone ?? 'Belum diisi'}
          error={state.fields?.phone}
          hint={
            maskedPhone ? `Tersimpan: ${maskedPhone}. Isi untuk mengganti.` : 'Untuk notifikasi mendesak.'
          }
          hintTone="muted"
        />
      </div>
      {maskedPhone && (
        <label className="flex min-h-8 items-center gap-2.5 text-small">
          <input type="checkbox" name="removePhone" className="size-[18px] accent-brand-600" />
          Hapus no. HP
        </label>
      )}
      <ErrorText message={state.error} />
      <Done message={state.ok ? state.message : undefined} />
      <span>
        <Button type="submit" size="sm" disabled={pending}>
          Simpan kontak
        </Button>
      </span>
    </form>
  );
}
