'use client';

import { formatRupiah, formatTanggal } from '@simrs/shared';
import { Button } from '@simrs/ui';
import { useState } from 'react';
import { CheckField, Panel, ReasonButton, TableWrap, TD, TH } from '@/components/backoffice/kit';
import {
  MIN_EXPIRY_MONTHS,
  payableDue,
  type ReceiptInput,
  type ReceiptLine,
  receiptBlock,
  receiptJournal,
  receiptValue,
} from '@/lib/logistik-terima';

const fmt = (n: number) => n.toLocaleString('id-ID');
const INPUT = 'h-11 w-full min-w-0 rounded-control border border-line-strong bg-white px-2 font-[inherit]';

/**
 * B01 · Penerimaan barang satu PO: jumlah diterima, batch, kedaluwarsa (≥ 6 bulan), cek rantai dingin; pratinjau
 * jurnal persediaan/utang usaha sebelum dicatat. "Catat penerimaan" nonaktif beralasan sampai lengkap.
 */
export function GoodsReceiptPanel({
  poId,
  supplier,
  lines,
  today,
  onCancel,
  onConfirm,
}: {
  poId: string;
  supplier: string;
  lines: readonly ReceiptLine[];
  today: string;
  onCancel: () => void;
  onConfirm: (inputs: Record<string, ReceiptInput>, value: bigint) => void;
}) {
  const [inputs, setInputs] = useState<Record<string, ReceiptInput>>(() =>
    Object.fromEntries(lines.map((l) => [l.itemId, { received: String(l.ordered), batch: '', expiry: '' }])),
  );
  const [cold, setCold] = useState(false);
  const set = (id: string, patch: Partial<ReceiptInput>) =>
    setInputs((cur) => ({ ...cur, [id]: { ...(cur[id] as ReceiptInput), ...patch } }));
  const block = receiptBlock(lines, inputs, today, cold);
  const value = receiptValue(lines, inputs);
  const journal = receiptJournal(value);

  return (
    <Panel
      title={`Penerimaan barang ${poId}`}
      sub={`${supplier} · cek fisik, batch, dan kedaluwarsa minimal ${MIN_EXPIRY_MONTHS} bulan`}
    >
      <TableWrap label={`Baris penerimaan ${poId}`} minWidth={640}>
        <thead>
          <tr>
            <th className={TH}>Item</th>
            <th className={`${TH} text-right`}>Dipesan</th>
            <th className={TH}>Diterima</th>
            <th className={TH}>Batch</th>
            <th className={TH}>Kedaluwarsa</th>
          </tr>
        </thead>
        <tbody>
          {lines.map((l) => {
            const v = inputs[l.itemId];
            return (
              <tr key={l.itemId}>
                <td className={TD}>
                  <span className="block font-semibold">{l.name}</span>
                  <span className="block text-caption text-ink-500">
                    {formatRupiah(BigInt(l.unitPrice))} per {l.unit}
                  </span>
                </td>
                <td className={`${TD} text-right font-mono`}>{fmt(l.ordered)}</td>
                <td className={TD}>
                  <input
                    aria-label={`Diterima ${l.name}`}
                    inputMode="numeric"
                    value={v?.received ?? ''}
                    onChange={(e) => set(l.itemId, { received: e.target.value })}
                    className={INPUT}
                  />
                </td>
                <td className={TD}>
                  <input
                    aria-label={`Batch ${l.name}`}
                    value={v?.batch ?? ''}
                    onChange={(e) => set(l.itemId, { batch: e.target.value })}
                    className={INPUT}
                  />
                </td>
                <td className={TD}>
                  <input
                    aria-label={`Kedaluwarsa ${l.name}`}
                    placeholder="TTTT-BB-HH"
                    value={v?.expiry ?? ''}
                    onChange={(e) => set(l.itemId, { expiry: e.target.value })}
                    className={INPUT}
                  />
                </td>
              </tr>
            );
          })}
        </tbody>
      </TableWrap>
      {lines.some((l) => l.cold) && (
        <CheckField
          label="Suhu rantai dingin 2–8 °C sesuai saat diterima"
          checked={cold}
          onChange={setCold}
        />
      )}
      <div className="flex flex-col gap-1 rounded-control border border-line bg-subtle px-3 py-2 text-small">
        <span className="font-semibold">Jurnal otomatis saat dicatat</span>
        {journal.map((j) => (
          <span key={j.account} className="flex justify-between gap-3">
            <span>{j.account}</span>
            <span className="font-mono">
              {j.debit ? `D ${formatRupiah(j.debit)}` : `K ${formatRupiah(j.credit)}`}
            </span>
          </span>
        ))}
        <span className="text-caption text-ink-500">
          Utang jatuh tempo {formatTanggal(payableDue(today))} (30 hari)
        </span>
      </div>
      <span className="flex flex-wrap items-start gap-2">
        <ReasonButton reason={block} onClick={() => onConfirm(inputs, value)}>
          Catat penerimaan
        </ReasonButton>
        <Button variant="ghost" onClick={onCancel}>
          Batal
        </Button>
      </span>
    </Panel>
  );
}
