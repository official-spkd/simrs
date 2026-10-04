'use client';

import { Button, Icon } from '@simrs/ui';

/** Pratinjau cetak resume (dialog cetak browser; PDF ber-TTE dibangkitkan backend kelak). */
export function PrintButton() {
  return (
    <Button onClick={() => window.print()}>
      <Icon name="printer" size={16} />
      Pratinjau cetak
    </Button>
  );
}
