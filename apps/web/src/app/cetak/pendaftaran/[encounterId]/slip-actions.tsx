'use client';

import { Button, Icon } from '@simrs/ui';

/** Tombol cetak (dialog cetak browser) dan tutup tab; disembunyikan saat dicetak. */
export function SlipActions() {
  return (
    <div className="slip-actions mx-auto flex w-[80mm] max-w-full flex-wrap gap-2">
      <Button variant="primary" onClick={() => window.print()}>
        <Icon name="printer" size={16} />
        Cetak
      </Button>
      <Button onClick={() => window.close()}>Tutup</Button>
    </div>
  );
}
