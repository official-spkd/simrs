'use client';

import { Button } from '@simrs/ui';
import { useActionState, useState } from 'react';
import { useFormStatus } from 'react-dom';
import { type ActionResult, addAssignmentAction, endAssignmentAction } from './actions';
import { Done, ErrorText, inputClass, selectClass } from './parts';

interface Option {
  value: string;
  label: string;
}

function Submit({
  label,
  pending,
  variant = 'primary',
}: {
  label: string;
  pending: string;
  variant?: 'primary' | 'danger';
}) {
  const { pending: busy } = useFormStatus();
  return (
    <Button type="submit" size="sm" variant={variant} disabled={busy}>
      {busy ? pending : label}
    </Button>
  );
}

/** "+ Tambah penugasan": peran × unit × masa berlaku (opsional, untuk rotasi/jaga terjadwal). */
export function AddAssignment({
  userId,
  roles,
  units,
}: {
  userId: string;
  roles: Option[];
  units: Option[];
}) {
  const [state, action] = useActionState<ActionResult, FormData>(addAssignmentAction, {});
  return (
    <details className="group rounded-control border border-line px-3 py-2">
      <summary className="cursor-pointer text-small font-semibold text-brand-600">+ Tambah penugasan</summary>
      <form action={action} className="mt-3 flex flex-col gap-3">
        <input type="hidden" name="userId" value={userId} />
        <ErrorText message={state.error ?? state.fields?.form} />
        <div className="grid gap-3 sm:grid-cols-2">
          <label className="flex flex-col gap-1.5 text-small font-semibold text-ink-700">
            Peran
            <select name="roleCode" required className={selectClass} defaultValue="">
              <option value="" disabled>
                Pilih peran
              </option>
              {roles.map((r) => (
                <option key={r.value} value={r.value}>
                  {r.label}
                </option>
              ))}
            </select>
            {state.fields?.roleCode && <span className="text-caption text-danger">Pilih peran.</span>}
          </label>
          <label className="flex flex-col gap-1.5 text-small font-semibold text-ink-700">
            Unit
            <select name="unitId" className={selectClass} defaultValue="">
              <option value="">Semua unit</option>
              {units.map((u) => (
                <option key={u.value} value={u.value}>
                  {u.label}
                </option>
              ))}
            </select>
          </label>
          <label className="flex flex-col gap-1.5 text-small font-semibold text-ink-700">
            Mulai (opsional)
            <input type="date" name="validFrom" className={inputClass} />
          </label>
          <label className="flex flex-col gap-1.5 text-small font-semibold text-ink-700">
            Berakhir (opsional)
            <input type="date" name="validUntil" className={inputClass} />
            {state.fields?.validUntil && (
              <span className="text-caption text-danger">{state.fields.validUntil}</span>
            )}
          </label>
        </div>
        <div>
          <Submit label="Tambahkan" pending="Menyimpan…" />
        </div>
        <Done message={state.message} />
      </form>
    </details>
  );
}

/** Mengakhiri penugasan wajib alasan (tercatat di kolom alasan jejak audit). */
export function EndAssignment({ assignmentId, label }: { assignmentId: string; label: string }) {
  const [open, setOpen] = useState(false);
  const [state, action] = useActionState<ActionResult, FormData>(endAssignmentAction, {});
  if (!open) {
    return (
      <Button
        size="sm"
        variant="ghost"
        onClick={() => setOpen(true)}
        aria-label={`Akhiri penugasan ${label}`}
      >
        Akhiri
      </Button>
    );
  }
  return (
    <form action={action} className="flex w-full flex-col gap-2">
      <input type="hidden" name="assignmentId" value={assignmentId} />
      <label className="flex flex-col gap-1.5 text-small font-semibold text-ink-700">
        Alasan mengakhiri {label}
        <input
          name="reason"
          required
          minLength={5}
          maxLength={300}
          placeholder="Mis. mutasi ke unit lain"
          className={inputClass}
          aria-invalid={Boolean(state.fields?.reason)}
        />
      </label>
      {state.fields?.reason && <span className="text-caption text-danger">{state.fields.reason}</span>}
      <ErrorText message={state.error} />
      <div className="flex gap-2">
        <Submit label="Akhiri penugasan" pending="Memproses…" variant="danger" />
        <Button size="sm" onClick={() => setOpen(false)}>
          Batal
        </Button>
      </div>
    </form>
  );
}
