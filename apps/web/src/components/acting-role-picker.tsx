'use client';

import { SYSTEM_ROLES, type SystemRoleCode } from '@simrs/shared';
import { usePathname, useRouter } from 'next/navigation';
import { useId, useState, useTransition } from 'react';
import { actingRoleFor, actingRoleOptions, screenForPath } from '@/lib/screens';
import { setActingRoleAction } from '@/lib/server/demo/acting-role-actions';

const roleName = (code: string | null) => (code ? (SYSTEM_ROLES[code as SystemRoleCode] ?? code) : '—');

/**
 * "Bertindak sebagai" untuk posisi Superadmin demo (mode presentasi, ADR-0023 keputusan 10). Dihitung dari URL
 * (layout tidak dirender ulang saat navigasi) dengan aturan yang sama dengan server (`actingRoleFor`): layar dengan
 * beberapa posisi pemakai menampilkan pilihan; layar satu posisi menampilkan posisi itu. Pilihan hanya mengubah
 * tampilan layar ber-data dummy; gerbang keselamatan dan alasan override tetap berlaku untuk posisi mana pun.
 */
export function ActingRolePicker({ preferred, base }: { preferred: string | null; base: string | null }) {
  const pathname = usePathname();
  const router = useRouter();
  const id = useId();
  const [pending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);
  const screen = screenForPath(pathname);
  const options = actingRoleOptions(screen);
  const acting = actingRoleFor(screen, preferred, base);

  if (options.length < 2) {
    return (
      <span className="inline-flex min-h-11 items-center rounded-full border border-line bg-white px-3 text-small text-ink-700">
        {options.length === 1 ? (
          <>
            Bertindak sebagai:&nbsp;<strong className="font-semibold text-ink-900">{roleName(acting)}</strong>
          </>
        ) : (
          <strong className="font-semibold text-ink-900">Superadmin demo · semua layar</strong>
        )}
      </span>
    );
  }
  return (
    <span className="inline-flex flex-col">
      <span className="inline-flex min-h-11 items-center gap-2 rounded-full border border-brand-200 bg-white pr-1 pl-3 text-small">
        <label htmlFor={id} className="font-medium whitespace-nowrap text-ink-700">
          Bertindak sebagai
        </label>
        <select
          id={id}
          value={acting ?? ''}
          disabled={pending}
          onChange={(e) => {
            const role = e.target.value;
            setError(null);
            startTransition(async () => {
              const r = await setActingRoleAction(role);
              if (r.error) setError(r.error);
              else router.refresh();
            });
          }}
          className="min-h-11 max-w-[14rem] cursor-pointer rounded-full border border-line bg-white px-2 font-[inherit] text-small font-semibold text-ink-900 disabled:cursor-wait"
        >
          {options.map((r) => (
            <option key={r} value={r}>
              {roleName(r)}
            </option>
          ))}
        </select>
      </span>
      {error && (
        <span role="alert" className="text-caption text-danger">
          {error}
        </span>
      )}
    </span>
  );
}
