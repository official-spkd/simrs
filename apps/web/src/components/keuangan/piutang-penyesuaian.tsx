'use client';

import { formatJam, formatRupiah, formatTanggalWaktu } from '@simrs/shared';
import { Button, Chip, cx, Field } from '@simrs/ui';
import { useId, useState } from 'react';
import { digitsToRupiah } from '@/lib/keuangan';
import {
  adjustmentApprovalProblem,
  adjustmentJournal,
  adjustmentProblems,
  type JenisPenyesuaian,
  outstanding,
  type Penyesuaian,
  PENYESUAIAN_LABEL,
  type PiutangItem,
} from '@/lib/keuangan-piutang';
import type { StoredAdjustment } from '@/lib/keuangan-piutang-toko';
import { AlasanForm } from './alasan-form';
import { JurnalPasangan } from './jurnal-pasangan';

/**
 * Penyesuaian piutang beralasan (potongan kontrak, hapus buku): diajukan staf, disetujui manajemen (pembuat ≠
 * penyetuju), lalu jurnal diposting di periode berjalan. Piutang tidak dihapus; saldo berkurang lewat jurnal.
 */
export function PiutangPenyesuaian({
  items,
  adjustments,
  viewer,
  onSubmit,
  onDecide,
}: {
  items: readonly PiutangItem[];
  adjustments: readonly StoredAdjustment[];
  viewer: { id: string; name: string; role: string | null };
  onSubmit: (a: { itemId: string; kind: JenisPenyesuaian; amount: bigint; reason: string }) => void;
  /** Tolak wajib beralasan (`reason`). */
  onDecide: (a: Penyesuaian, approve: boolean, reason: string | null) => void;
}) {
  const id = useId();
  const [rejecting, setRejecting] = useState<string | null>(null);
  const open = items.filter((i) => outstanding(i) > 0n);
  const [itemId, setItemId] = useState('');
  const [kind, setKind] = useState<JenisPenyesuaian>('potongan');
  const [amountRaw, setAmountRaw] = useState('');
  const [reason, setReason] = useState('');
  const item = open.find((i) => i.id === itemId);
  const amount = digitsToRupiah(amountRaw);
  const problems = adjustmentProblems(item, amount, reason);

  return (
    <div className="flex flex-wrap items-start gap-4">
      <form
        aria-label="Ajukan penyesuaian piutang"
        className="flex min-w-0 flex-[1_1_320px] flex-col gap-3 rounded-card border border-line bg-white p-4 xl:max-w-[420px]"
        onSubmit={(e) => {
          e.preventDefault();
          if (problems.length || !item) return;
          onSubmit({ itemId: item.id, kind, amount, reason: reason.trim() });
          setItemId('');
          setAmountRaw('');
          setReason('');
        }}
      >
        <span className="font-semibold">Ajukan penyesuaian</span>
        <label className="flex flex-col gap-1 text-small font-semibold text-ink-700">
          Piutang
          <select
            aria-label="Piutang"
            value={itemId}
            onChange={(e) => setItemId(e.target.value)}
            className="h-11 rounded-control border border-line-strong bg-white px-2 font-[inherit] font-normal text-ink-900"
          >
            <option value="">Pilih piutang…</option>
            {open.map((i) => (
              <option key={i.id} value={i.id}>
                {i.invoiceNo} · {i.patient} · sisa {formatRupiah(outstanding(i))}
              </option>
            ))}
          </select>
        </label>
        <label className="flex flex-col gap-1 text-small font-semibold text-ink-700">
          Jenis penyesuaian
          <select
            aria-label="Jenis penyesuaian"
            value={kind}
            onChange={(e) => setKind(e.target.value as JenisPenyesuaian)}
            className="h-11 rounded-control border border-line-strong bg-white px-2 font-[inherit] font-normal text-ink-900"
          >
            {Object.entries(PENYESUAIAN_LABEL).map(([k, v]) => (
              <option key={k} value={k}>
                {v}
              </option>
            ))}
          </select>
        </label>
        <Field
          label="Nominal (Rp)"
          inputMode="numeric"
          value={amountRaw}
          onChange={(e) => setAmountRaw(e.target.value)}
          hint={item ? `maksimal ${formatRupiah(outstanding(item))}` : 'pilih piutang dulu'}
          hintTone="muted"
        />
        <label htmlFor={`${id}-alasan`} className="text-small font-semibold text-ink-700">
          Alasan (wajib, dibaca penyetuju dan auditor)
        </label>
        <textarea
          id={`${id}-alasan`}
          rows={3}
          maxLength={300}
          value={reason}
          onChange={(e) => setReason(e.target.value)}
          className="rounded-control border border-line-strong bg-white px-3 py-2 font-[inherit] text-small"
        />
        <span
          id={`${id}-pesan`}
          className={cx('text-caption', problems.length ? 'font-medium text-warning' : 'text-success')}
        >
          {problems.length ? `Belum bisa diajukan: ${problems.join('; ')}.` : 'Siap diajukan ke manajemen.'}
        </span>
        <Button
          type="submit"
          variant="primary"
          disabled={problems.length > 0}
          aria-describedby={`${id}-pesan`}
        >
          Ajukan penyesuaian
        </Button>
      </form>

      <ul
        aria-label="Penyesuaian piutang"
        className="m-0 flex min-w-0 flex-[999_1_420px] list-none flex-col gap-3 p-0"
      >
        {adjustments.map((a) => {
          const it = items.find((i) => i.id === a.itemId);
          const gate = adjustmentApprovalProblem(a, viewer, it);
          return (
            <li
              key={a.id}
              aria-label={a.number}
              className="flex flex-col gap-2 rounded-card border border-line bg-white p-4"
            >
              <span className="flex flex-wrap items-center justify-between gap-2">
                <span className="font-semibold">
                  <span className="font-mono">{a.number}</span> · {PENYESUAIAN_LABEL[a.kind]}
                </span>
                <Chip
                  tone={a.status === 'menunggu' ? 'warning' : a.status === 'disetujui' ? 'success' : 'danger'}
                >
                  {a.status === 'menunggu'
                    ? 'Menunggu persetujuan'
                    : a.status === 'disetujui'
                      ? 'Disetujui · terposting'
                      : 'Ditolak'}
                </Chip>
              </span>
              <span className="text-small text-ink-700">
                {it?.invoiceNo} · {it?.patient} · {it?.payerName} ·{' '}
                <span className="font-mono font-semibold">{formatRupiah(a.amount)}</span>
              </span>
              <span className="text-caption text-ink-500">
                Diajukan {a.maker} · {formatTanggalWaktu(a.createdAt)} · alasan: “{a.reason}”
              </span>
              {a.status === 'menunggu' ? (
                rejecting === a.id ? (
                  <AlasanForm
                    label={`Alasan menolak ${a.number} (wajib)`}
                    submitLabel="Tolak penyesuaian"
                    variant="danger"
                    min={10}
                    onCancel={() => setRejecting(null)}
                    onSubmit={(r) => {
                      setRejecting(null);
                      onDecide(a, false, r);
                    }}
                  />
                ) : (
                  <span className="flex flex-wrap items-center gap-2">
                    <Button variant="primary" disabled={!!gate} onClick={() => onDecide(a, true, null)}>
                      Setujui dan posting
                    </Button>
                    <Button disabled={!!gate} onClick={() => setRejecting(a.id)}>
                      Tolak…
                    </Button>
                    {gate && <span className="text-caption font-medium text-warning">{gate}</span>}
                  </span>
                )
              ) : (
                <span className={cx('text-small', a.status === 'disetujui' ? 'text-success' : 'text-danger')}>
                  {a.status === 'disetujui' ? '✓ Disetujui' : '✗ Ditolak'} {a.decidedBy} ·{' '}
                  {a.decidedAt ? formatJam(a.decidedAt) : ''}
                  {a.rejectReason ? ` · alasan: “${a.rejectReason}”` : ''}
                </span>
              )}
              {it && (
                <JurnalPasangan
                  jurnal={adjustmentJournal(a, it.payerGroup)}
                  status={
                    a.status === 'disetujui'
                      ? 'terposting · periode Oktober 2026'
                      : 'draf · diposting setelah disetujui'
                  }
                />
              )}
            </li>
          );
        })}
        {adjustments.length === 0 && <li className="text-small text-ink-500">Belum ada penyesuaian.</li>}
      </ul>
    </div>
  );
}
