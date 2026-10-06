'use client';

import { Button, Icon } from '@simrs/ui';

/** Pratinjau PDF resume (dialog cetak browser, bisa disimpan sebagai PDF; PDF ber-TTE dibangkitkan backend kelak). */
export function PrintButton() {
  return (
    <Button onClick={() => window.print()}>
      <Icon name="printer" size={16} />
      Pratinjau PDF
    </Button>
  );
}
