'use client';

import { Button, Icon } from '@simrs/ui';
import { useRouter } from 'next/navigation';

/** Tombol cetak (dialog cetak browser) + kembali; tidak ikut tercetak. */
export function PrintActions() {
  const router = useRouter();
  return (
    <div className="print-actions flex flex-wrap gap-2">
      <Button variant="primary" onClick={() => window.print()}>
        <Icon name="printer" size={16} />
        Cetak
      </Button>
      <Button variant="ghost" onClick={() => router.back()}>
        Kembali
      </Button>
    </div>
  );
}
