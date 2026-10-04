'use client';

import { TabList } from './tabs';

export interface SegmentedItem {
  id: string;
  label: string;
}

/**
 * Kontrol segmen (pil abu-abu, pilihan aktif putih) untuk berpindah tampilan setara, mis. skenario simulasi atau
 * rentang dasbor: `TabList` gaya `segmen` (tampak ringkas 36 px, area sentuh 44 px). Semantik tab ARIA; panah
 * kiri/kanan dan Home/End berpindah pilihan. Tanpa panel: konten diatur pemanggil.
 */
export function Segmented({
  items,
  value,
  onChange,
  label,
  disabled,
}: {
  items: readonly SegmentedItem[];
  value: string;
  onChange: (id: string) => void;
  label: string;
  disabled?: boolean;
}) {
  return (
    <TabList
      variant="segmen"
      items={items}
      value={value}
      onChange={onChange}
      label={label}
      disabled={disabled}
    />
  );
}
