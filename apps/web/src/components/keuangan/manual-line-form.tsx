'use client';

import { CHARGE_CATEGORIES, type ChargeCategory, type ChargeItem } from '@simrs/shared';
import { Button, Field } from '@simrs/ui';
import { useId, useState, useTransition } from 'react';
import { kasirAction } from '@/app/(staf)/keuangan/kasir/actions';
import { CATEGORY_LABEL, digitsToRupiah, MANUAL_REASON_MIN, manualLineProblems } from '@/lib/keuangan';

/**
 * Item manual kasir (U03): pengecualian charge capture, jadi wajib alasan tertulis dan tercatat di audit. Tombol
 * ajukan tetap nonaktif (dengan alasan terlihat) sampai nama, harga, dan alasan terisi.
 */
export function ManualLineForm({
  invoiceId,
  disabledReason,
  onAdded,
}: {
  invoiceId: string;
  /** Alasan form tidak bisa dipakai (tagihan terkunci, pasien skenario); null = boleh. */
  disabledReason: string | null;
  onAdded: (line: ChargeItem, message: string) => void;
}) {
  const id = useId();
  const [open, setOpen] = useState(false);
  const [name, setName] = useState('');
  const [category, setCategory] = useState<ChargeCategory>('tindakan');
  const [qty, setQty] = useState('1');
  const [price, setPrice] = useState('');
  const [reason, setReason] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();
  const unitPrice = digitsToRupiah(price);
  const qtyNum = Number.parseInt(qty, 10);
  const problems = manualLineProblems({ name, qty: qtyNum, unitPrice, reason });

  const submit = () =>
    startTransition(async () => {
      const r = await kasirAction({
        type: 'manual',
        invoiceId,
        name: name.trim(),
        category,
        qty: qtyNum,
        unitPrice: unitPrice.toString(),
        reason: reason.trim(),
      });
      if (!r.ok) {
        setError(r.message);
        return;
      }
      onAdded(
        {
          id: `manual-${Date.now()}`,
          name: name.trim(),
          category,
          source: 'Kasir (manual)',
          when: r.at ?? '',
          qty: qtyNum,
          unitPrice: unitPrice.toString(),
          amount: (unitPrice * BigInt(qtyNum)).toString(),
          manual: true,
          reason: reason.trim(),
        },
        r.message,
      );
      setOpen(false);
      setName('');
      setPrice('');
      setReason('');
      setQty('1');
      setError(null);
    });

  if (!open) {
    return (
      <div className="flex flex-wrap items-center gap-2">
        <Button
          disabled={!!disabledReason}
          aria-describedby={disabledReason ? `${id}-alasan` : undefined}
          aria-expanded={false}
          onClick={() => setOpen(true)}
        >
          Tambah item manual
        </Button>
        {disabledReason && (
          <span id={`${id}-alasan`} className="text-caption font-medium text-warning">
            {disabledReason}
          </span>
        )}
      </div>
    );
  }

  return (
    <form
      aria-label="Tambah item manual"
      className="flex flex-col gap-3 rounded-card border border-warning-border bg-[#FFFAF2] p-4"
      onSubmit={(e) => {
        e.preventDefault();
        if (problems.length === 0) submit();
      }}
    >
      <span className="text-small text-ink-700">
        Item manual hanya untuk layanan yang belum tertangkap otomatis. Alasan tertulis wajib dan tercatat di
        jejak audit; koreksi tarif tetap diajukan ke unit asal.
      </span>
      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
        <Field
          label="Nama item"
          required
          value={name}
          maxLength={80}
          onChange={(e) => setName(e.target.value)}
        />
        <div className="flex flex-col gap-1.5">
          <label htmlFor={`${id}-kategori`} className="text-small font-semibold text-ink-700">
            Kategori
          </label>
          <select
            id={`${id}-kategori`}
            value={category}
            onChange={(e) => setCategory(e.target.value as ChargeCategory)}
            className="h-11 rounded-control border border-line-strong bg-white px-2 font-[inherit]"
          >
            {CHARGE_CATEGORIES.map((c) => (
              <option key={c} value={c}>
                {CATEGORY_LABEL[c]}
              </option>
            ))}
          </select>
        </div>
        <Field
          label="Kuantitas"
          type="number"
          min={1}
          max={99}
          value={qty}
          onChange={(e) => setQty(e.target.value)}
        />
        <Field
          label="Harga satuan (Rp)"
          required
          inputMode="numeric"
          autoComplete="off"
          value={unitPrice > 0n ? unitPrice.toString().replace(/\B(?=(\d{3})+(?!\d))/g, '.') : ''}
          onChange={(e) => setPrice(e.target.value)}
        />
      </div>
      <div className="flex flex-col gap-1.5">
        <label htmlFor={`${id}-alasan-isi`} className="text-small font-semibold text-ink-700">
          Alasan item manual (wajib, minimal {MANUAL_REASON_MIN} karakter)
        </label>
        <textarea
          id={`${id}-alasan-isi`}
          rows={2}
          maxLength={300}
          value={reason}
          onChange={(e) => setReason(e.target.value)}
          className="rounded-control border border-line-strong bg-white px-3 py-2 font-[inherit]"
        />
      </div>
      <div className="flex flex-wrap items-center gap-2">
        <Button
          type="submit"
          variant="primary"
          disabled={problems.length > 0 || pending}
          aria-describedby={`${id}-gerbang`}
        >
          Ajukan item manual
        </Button>
        <Button variant="ghost" onClick={() => setOpen(false)}>
          Batal
        </Button>
        <span id={`${id}-gerbang`} role="status" className="text-caption font-medium text-warning">
          {problems.length > 0 ? `Belum bisa diajukan: ${problems.join(', ')}.` : ''}
        </span>
      </div>
      {error && (
        <span role="alert" className="text-caption text-danger">
          {error}
        </span>
      )}
    </form>
  );
}
