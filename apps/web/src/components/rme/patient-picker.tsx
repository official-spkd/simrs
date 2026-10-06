'use client';

import { useRouter } from 'next/navigation';
import { useId } from 'react';

export interface PickerOption {
  encounterId: string;
  label: string;
  group: string;
}

/**
 * Pilih pasien bagan RME: berpindah ke `?pasien=<encounterId>` di layar yang sama (layar lain di bagan ikut
 * memakai pasien ini lewat tautan navigasi bagan).
 */
export function PatientPicker({ options, current }: { options: readonly PickerOption[]; current: string }) {
  const router = useRouter();
  const id = useId();
  const groups = [...new Set(options.map((o) => o.group))];
  return (
    <div className="flex flex-col gap-1">
      <label htmlFor={id} className="text-caption font-semibold text-ink-700">
        Pasien
      </label>
      <select
        id={id}
        value={current}
        onChange={(e) => router.push(`?pasien=${encodeURIComponent(e.target.value)}`)}
        className="h-11 max-w-full rounded-control border border-line-strong bg-white px-3 font-[inherit] text-small text-ink-900"
      >
        {groups.map((g) => (
          <optgroup key={g} label={g}>
            {options
              .filter((o) => o.group === g)
              .map((o) => (
                <option key={o.encounterId} value={o.encounterId}>
                  {o.label}
                </option>
              ))}
          </optgroup>
        ))}
      </select>
    </div>
  );
}
