'use client';

import { Tabs } from '@simrs/ui';
import type { ReactNode } from 'react';

export interface KeepTab {
  id: string;
  label: string;
  /** Lencana kecil (mis. "3 selisih"); `warn` = merah. */
  badge?: string;
  warn?: boolean;
  content: ReactNode;
}

/**
 * Tab bergaya pil (mockup PembayaranBTN/PembiayaanBTN) yang menjaga semua panel tetap terpasang: pindah tab tidak
 * menghapus isian yang belum disimpan. Kini `Tabs` bersama di `@simrs/ui` (`variant="pil"`, `keepMounted`).
 */
export function KeepTabs({
  items,
  value,
  onChange,
  label,
}: {
  items: readonly KeepTab[];
  value: string;
  onChange: (id: string) => void;
  label: string;
}) {
  return (
    <Tabs
      variant="pil"
      keepMounted
      label={label}
      value={value}
      onChange={onChange}
      items={items.map(({ warn, ...t }) => ({ ...t, badgeTone: warn ? 'danger' : 'brand' }))}
    />
  );
}
