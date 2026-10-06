'use client';

import { cx } from '@simrs/ui';
import { useState, useTransition } from 'react';
import { openScreenAsAction } from '@/app/(staf)/simulasi/actions';

/**
 * "Buka layar X sebagai posisi Y" untuk presenter: ganti posisi akun demo bila perlu, lalu buka layar. Layar yang
 * belum dibangun tampil sebagai teks keterangan, bukan tombol mati tanpa alasan.
 */
export function OpenScreenButton({
  screen,
  role,
  roleName,
  variant = 'link',
  text,
}: {
  screen: { id: string; label: string; ready: boolean };
  role: string | null;
  roleName: string | null;
  variant?: 'link' | 'button' | 'outline';
  /** Teks tombol pengganti (mis. "Lihat dari sisi pasien"); nama layar dan posisi tetap ada di `title`. */
  text?: string;
}) {
  const [pending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);
  if (!screen.ready) {
    return <span className="text-small text-ink-500">Layar {screen.label} belum tersedia.</span>;
  }
  const label = `Buka layar ${screen.label}${roleName ? ` sebagai ${roleName}` : ''}`;
  return (
    <span className="flex flex-col gap-1">
      <button
        type="button"
        disabled={pending}
        title={text ? label : undefined}
        // Teks terlihat di awal nama aksesibel (label-in-name), lalu layar dan posisi tujuannya.
        aria-label={text && !pending ? `${text} · ${label}` : undefined}
        onClick={() =>
          startTransition(async () => {
            const r = await openScreenAsAction(screen.id, role);
            if (r?.error) setError(r.error);
          })
        }
        className={cx(
          'cursor-pointer self-start font-[inherit] font-semibold disabled:cursor-wait',
          variant === 'link'
            ? 'min-h-11 border-0 bg-transparent p-0 text-left text-small text-brand-700 underline-offset-2 hover:underline'
            : variant === 'outline'
              ? 'min-h-11 rounded-control border border-line-strong bg-white px-4 font-medium text-ink-900'
              : 'min-h-11 rounded-control border border-brand-800 bg-brand-600 px-4 text-small text-white',
        )}
      >
        {pending ? 'Membuka…' : (text ?? `${label} →`)}
      </button>
      {error && (
        <span role="alert" className="text-caption text-danger">
          {error}
        </span>
      )}
    </span>
  );
}
