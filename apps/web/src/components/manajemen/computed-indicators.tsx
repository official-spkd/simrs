'use client';

import { formatJam } from '@simrs/shared';
import { Button } from '@simrs/ui';
import { useState } from 'react';
import { Panel, TableWrap, TD, TH } from '@/components/backoffice/kit';
import { demoNow } from '@/lib/demo/fixtures/waktu';
import type { ComputedIndicator } from '@/lib/mutu-transaksi';

const fmt = (n: number) => n.toLocaleString('id-ID');

/**
 * B06 · Lima indikator yang dihitung mesin indikator dari data transaksi layar lain (PPI, pengalaman pasien, rekam
 * medis): pembilang/penyebut dan sumbernya terlihat; "Hitung ulang" menjalankan ulang perhitungan (deterministik).
 */
export function ComputedIndicators({
  items,
  computedAt,
}: {
  items: readonly ComputedIndicator[];
  computedAt: string;
}) {
  const [at, setAt] = useState(computedAt);
  return (
    <Panel
      title="Dihitung dari data transaksi"
      sub={`Mesin indikator · terakhir dihitung ${at} · nilai sama dengan daftar indikator di atas`}
      actions={<Button onClick={() => setAt(`ulang ${formatJam(demoNow())}`)}>Hitung ulang</Button>}
      flush
    >
      <TableWrap label="Indikator dari data transaksi" minWidth={620}>
        <thead>
          <tr>
            <th className={TH}>Indikator</th>
            <th className={`${TH} text-right`}>Pembilang / penyebut</th>
            <th className={`${TH} text-right`}>Nilai</th>
            <th className={TH}>Sumber data</th>
          </tr>
        </thead>
        <tbody>
          {items.map((c) => (
            <tr key={c.id}>
              <td className={TD}>{c.label}</td>
              <td className={`${TD} text-right font-mono`}>
                {c.unit === 'indeks'
                  ? `${fmt(c.denominator)} respons`
                  : `${fmt(c.numerator)} / ${fmt(c.denominator)}`}
              </td>
              <td className={`${TD} text-right font-mono font-semibold`}>
                {c.value}
                {c.unit === '%' ? '%' : ''}
              </td>
              <td className={TD}>{c.source}</td>
            </tr>
          ))}
        </tbody>
      </TableWrap>
    </Panel>
  );
}
