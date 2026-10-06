'use client';

import { Button, cx } from '@simrs/ui';
import { useActionState, useState } from 'react';
import type { AssignmentOption } from '@/lib/server/schemas';
import { type PositionState, switchPositionAction } from './actions';

/** Daftar posisi akun (peran + unit) sebagai pilihan radio; posisi yang sedang dipakai ditandai. */
export function PositionForm({ options }: { options: AssignmentOption[] }) {
  const [state, action, pending] = useActionState<PositionState, FormData>(switchPositionAction, {});
  const current = options.find((o) => o.selected)?.id ?? '';
  const [picked, setPicked] = useState(current);
  const chosen = options.find((o) => o.id === picked);
  return (
    <form action={action} className="flex flex-col gap-4">
      {state.error && (
        <p role="alert" className="m-0 text-small font-semibold text-danger">
          {state.error}
        </p>
      )}
      <fieldset className="m-0 grid grid-cols-1 gap-2 border-0 p-0 sm:grid-cols-2 lg:grid-cols-3">
        <legend className="sr-only">Posisi</legend>
        {options.map((o) => {
          const on = o.id === picked;
          return (
            <label
              key={o.id}
              className={cx(
                'flex min-h-14 cursor-pointer flex-col justify-center rounded-control border px-3 py-2.5 text-small has-[:focus-visible]:outline-2 has-[:focus-visible]:outline-brand-600',
                on
                  ? 'border-brand-600 bg-[linear-gradient(90deg,var(--color-brand-100),rgba(255,255,255,0.4))]'
                  : 'border-white/95 bg-white/90 shadow-card',
              )}
            >
              <input
                type="radio"
                name="assignmentId"
                value={o.id}
                checked={on}
                onChange={() => setPicked(o.id)}
                className="sr-only"
              />
              <span className={cx('font-semibold', on ? 'text-brand-700' : 'text-ink-900')}>
                {o.roleName}
                {o.selected && <span className="font-normal text-ink-500"> · sedang dipakai</span>}
              </span>
              <span className="text-caption text-ink-500">{o.unitName ?? 'Semua unit'}</span>
            </label>
          );
        })}
      </fieldset>
      <span>
        <Button type="submit" variant="primary" disabled={pending || !chosen || chosen.selected}>
          {chosen && !chosen.selected ? `Pindah ke ${chosen.roleName}` : 'Pilih posisi lain'}
        </Button>
      </span>
    </form>
  );
}
