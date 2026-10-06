'use client';

import { formatRupiah, formatTanggalWaktu } from '@simrs/shared';
import { Button, Chip, type ChipTone } from '@simrs/ui';
import { useState } from 'react';
import { tanggalPendek } from '@/lib/keuangan-jurnal';
import {
  activeVersion,
  approvalProblem,
  changeLabel,
  type ItemTarif,
  KELAS_TARIF,
  type StatusUsulan,
  type UsulanTarif,
} from '@/lib/keuangan-tarif';
import { AlasanForm } from './alasan-form';

const STATUS: Record<StatusUsulan, { label: string; tone: ChipTone }> = {
  diajukan: { label: 'Menunggu persetujuan', tone: 'warning' },
  disetujui: { label: 'Disetujui · terjadwal', tone: 'success' },
  ditolak: { label: 'Ditolak', tone: 'danger' },
};

/**
 * Usulan perubahan tarif: perbandingan lama → baru per kelas, alasan, dan keputusan penyetuju (posisi manajemen,
 * pembuat ≠ penyetuju). Menolak wajib alasan. Keputusan tercatat dengan jam.
 */
export function TarifUsulan({
  proposals,
  items,
  today,
  viewer,
  onApprove,
  onReject,
}: {
  proposals: readonly UsulanTarif[];
  items: readonly ItemTarif[];
  today: string;
  viewer: { name: string; role: string | null };
  onApprove: (u: UsulanTarif) => void;
  onReject: (u: UsulanTarif, reason: string) => void;
}) {
  const [rejecting, setRejecting] = useState<string | null>(null);
  if (proposals.length === 0) {
    return <p className="m-0 text-small text-ink-500">Belum ada usulan perubahan tarif.</p>;
  }
  return (
    <ul aria-label="Usulan perubahan tarif" className="m-0 flex list-none flex-col gap-3 p-0">
      {proposals.map((u) => {
        const item = items.find((i) => i.code === u.itemCode);
        const base = item ? activeVersion(item, today) : undefined;
        const problem = approvalProblem(u, viewer, today);
        const st = STATUS[u.status];
        return (
          <li
            key={u.id}
            aria-label={`${u.number} ${item?.name ?? u.itemCode}`}
            className="flex flex-col gap-2.5 rounded-card border border-white/95 bg-white/90 shadow-card p-4"
          >
            <div className="flex flex-wrap items-start justify-between gap-2">
              <span className="flex min-w-0 flex-col">
                <span className="font-semibold">
                  <span className="font-mono text-ink-500">{u.number}</span> · {item?.name ?? u.itemCode}
                </span>
                <span className="text-caption text-ink-500">
                  Diajukan {u.maker} ({u.makerRole}) · {formatTanggalWaktu(u.createdAt)} · berlaku mulai{' '}
                  {tanggalPendek(u.validFrom)}
                </span>
              </span>
              <Chip tone={st.tone}>{st.label}</Chip>
            </div>
            <div className="overflow-x-auto">
              <table className="w-full min-w-[420px] border-collapse text-[12.5px]">
                <thead>
                  <tr className="text-left text-caption text-ink-500">
                    <th scope="col" className="py-1 font-semibold">
                      Kelas
                    </th>
                    <th scope="col" className="py-1 text-right font-semibold">
                      Berlaku
                    </th>
                    <th scope="col" className="py-1 text-right font-semibold">
                      Usulan
                    </th>
                    <th scope="col" className="py-1 text-right font-semibold">
                      Perubahan
                    </th>
                  </tr>
                </thead>
                <tbody>
                  {KELAS_TARIF.map((k) => {
                    const old = base?.prices[k.id] ?? 0n;
                    return (
                      <tr key={k.id} className="border-t border-line">
                        <th scope="row" className="py-1 text-left font-normal">
                          {k.label}
                        </th>
                        <td className="py-1 text-right font-mono">{formatRupiah(old)}</td>
                        <td className="py-1 text-right font-mono font-semibold">
                          {formatRupiah(u.prices[k.id])}
                        </td>
                        <td className="py-1 text-right">{changeLabel(old, u.prices[k.id])}</td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
            <span className="text-small text-ink-700">
              <span className="font-semibold">Alasan:</span> {u.reason}
            </span>
            {u.status !== 'diajukan' && u.decidedBy && u.decidedAt && (
              <span
                className={u.status === 'disetujui' ? 'text-small text-success' : 'text-small text-danger'}
              >
                {u.status === 'disetujui' ? '✓ Disetujui' : '✗ Ditolak'} {u.decidedBy} ·{' '}
                {formatTanggalWaktu(u.decidedAt)}
                {u.decisionNote ? ` · catatan: “${u.decisionNote}”` : ''}
              </span>
            )}
            {u.status === 'diajukan' &&
              (rejecting === u.id ? (
                <AlasanForm
                  label="Alasan penolakan (wajib, dibaca pembuat usulan)"
                  submitLabel="Tolak usulan"
                  variant="danger"
                  blocked={problem}
                  onCancel={() => setRejecting(null)}
                  onSubmit={(reason) => {
                    onReject(u, reason);
                    setRejecting(null);
                  }}
                />
              ) : (
                <span className="flex flex-wrap items-center gap-2">
                  <Button
                    variant="primary"
                    disabled={!!problem}
                    aria-describedby={problem ? `${u.id}-gate` : undefined}
                    onClick={() => onApprove(u)}
                  >
                    Setujui usulan
                  </Button>
                  <Button disabled={!!problem} onClick={() => setRejecting(u.id)}>
                    Tolak…
                  </Button>
                  {problem && (
                    <span id={`${u.id}-gate`} className="text-caption font-medium text-warning">
                      {problem}
                    </span>
                  )}
                </span>
              ))}
          </li>
        );
      })}
    </ul>
  );
}
