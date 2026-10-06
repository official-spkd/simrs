'use client';

import { Button } from '@simrs/ui';
import { Panel, TableWrap, TD, TH } from '@/components/backoffice/kit';
import { useTokoAction } from '@/components/backoffice/use-toko';
import { demoStamp } from '@/lib/backoffice-toko';
import type { ComputedIndicator } from '@/lib/mutu-transaksi';

const fmt = (n: number) => n.toLocaleString('id-ID');

/**
 * B06 · Lima indikator yang dihitung mesin indikator dari data transaksi layar lain (PPI, pengalaman pasien, rekam
 * medis) di toko demo: pembilang/penyebut dan sumbernya terlihat; "Hitung ulang" menjalankan ulang perhitungan dari
 * keadaan terkini dan mencatat pelakunya.
 */
export function ComputedIndicators({
  items,
  computedAt,
  rev,
  fromClinical,
}: {
  items: readonly ComputedIndicator[];
  computedAt: string;
  rev: number;
  /** Jumlah resume final dari layar klinis yang ikut dihitung. */
  fromClinical: number;
}) {
  const { act, pending } = useTokoAction('mutu', rev);
  const at = computedAt;
  return (
    <Panel
      title="Dihitung dari data transaksi"
      sub={`Mesin indikator · terakhir dihitung ${at} · nilai sama dengan daftar indikator di atas${fromClinical ? ` · ${fromClinical} resume final dari layar klinis` : ''}`}
      actions={
        <Button
          disabled={pending}
          onClick={() => act({ type: 'indikator.dihitung-ulang', jam: demoStamp().jam }, null)}
        >
          Hitung ulang
        </Button>
      }
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
