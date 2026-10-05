'use client';

import { formatJam, formatTanggalWaktu, MEDICATION_FREQUENCIES, type OrderGroup } from '@simrs/shared';
import { Chip } from '@simrs/ui';
import { useId, useState, useTransition } from 'react';
import { cancelOrderAction, reviewOrderAction } from '@/app/(staf)/klinis/order/actions';
import { ORDER_STATUS_LABEL, TTE_STATUS_LABEL } from '@/lib/cpoe-api';

const STATUS_TONE = { aktif: 'success', dibatalkan: 'neutral', selesai: 'info' } as const;
const TTE_TONE = { pending: 'info', signed: 'success', failed: 'danger' } as const;

/** Form batal beralasan satu order (alasan ≥ 10 karakter, tercatat). */
function CancelForm({
  encounterId,
  orderId,
  name,
  onDone,
}: {
  encounterId: string;
  orderId: string;
  name: string;
  onDone: () => void;
}) {
  const id = useId();
  const [reason, setReason] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [pending, start] = useTransition();
  const short = reason.trim().length < 10;
  return (
    <form
      className="flex flex-col gap-1.5 rounded-control border border-line bg-subtle p-2.5"
      onSubmit={(e) => {
        e.preventDefault();
        if (short) return;
        start(async () => {
          const r = await cancelOrderAction({ encounterId, orderId, reason: reason.trim() });
          if (!r.ok) return setError(r.message);
          onDone();
        });
      }}
    >
      <label htmlFor={`${id}-alasan`} className="text-small font-semibold">
        Alasan membatalkan {name} (wajib, minimal 10 karakter)
      </label>
      <textarea
        id={`${id}-alasan`}
        rows={2}
        maxLength={500}
        value={reason}
        onChange={(e) => setReason(e.target.value)}
        className="rounded-control border border-line-strong bg-white px-3 py-2 font-[inherit]"
      />
      {error && (
        <span role="alert" className="text-small text-danger">
          {error}
        </span>
      )}
      <span className="flex flex-wrap gap-2">
        <button
          type="submit"
          disabled={short || pending}
          className="min-h-11 cursor-pointer rounded-control border border-ink-700 bg-ink-900 px-4 font-[inherit] font-semibold text-white disabled:cursor-not-allowed disabled:opacity-50"
        >
          Batalkan order
        </button>
        <button
          type="button"
          onClick={onDone}
          className="min-h-11 cursor-pointer rounded-control border border-line-strong bg-white px-4 font-[inherit]"
        >
          Tutup
        </button>
      </span>
    </form>
  );
}

/**
 * Order kunjungan ini (mode api): setiap kiriman dengan penulis, waktu, isi beku, status terkini, override CDS
 * tercatat, status TTE resep, dan tinjauan DPJP atas order residen. Batal beralasan untuk order aktif.
 */
export function CpoeApiOrders({
  encounterId,
  groups,
  canCancel,
  canReview,
}: {
  encounterId: string;
  groups: readonly OrderGroup[];
  canCancel: boolean;
  canReview: boolean;
}) {
  const [cancelling, setCancelling] = useState<string | null>(null);
  const [reviewError, setReviewError] = useState<string | null>(null);
  const [pending, start] = useTransition();
  if (groups.length === 0) {
    return (
      <p className="m-0 rounded-card border border-dashed border-line-strong bg-white p-4 text-small text-ink-500">
        Belum ada order terkirim untuk kunjungan ini.
      </p>
    );
  }
  return (
    <ul className="m-0 flex list-none flex-col gap-3 p-0">
      {groups.map((g) => {
        const lines = [
          ...g.serviceRequests.map((r) => ({ ...r, detail: r.priority === 'cito' ? 'Cito' : 'Rutin' })),
          ...g.medicationRequests.map((m) => ({
            ...m,
            detail: [m.dose, m.route, MEDICATION_FREQUENCIES[m.frequency].label, m.instructions]
              .filter(Boolean)
              .join(' · '),
          })),
        ];
        const overrides = g.cdsAlerts.filter((a) => a.decision === 'override');
        return (
          <li key={g.id} className="overflow-hidden rounded-card border border-line bg-white shadow-card">
            <div className="flex flex-wrap items-center justify-between gap-2 border-b border-line bg-subtle px-4 py-2.5">
              <span className="text-small">
                <span className="font-semibold">{formatTanggalWaktu(g.orderedAt)}</span> · {g.orderedBy.nama}
              </span>
              <span className="flex flex-wrap items-center gap-1.5">
                {g.needsReview && <Chip tone="warning">Menunggu tinjauan DPJP</Chip>}
                {g.review && (
                  <Chip tone="success">
                    Ditinjau {g.review.by.nama} · {formatJam(g.review.at)}
                  </Chip>
                )}
                {g.prescription?.signatureStatus && (
                  <Chip tone={TTE_TONE[g.prescription.signatureStatus]}>
                    {TTE_STATUS_LABEL[g.prescription.signatureStatus]}
                  </Chip>
                )}
                {g.needsReview && canReview && (
                  <button
                    type="button"
                    disabled={pending}
                    onClick={() =>
                      start(async () => {
                        setReviewError(null);
                        const r = await reviewOrderAction({ encounterId, groupId: g.id });
                        if (!r.ok) setReviewError(r.message);
                      })
                    }
                    className="min-h-11 cursor-pointer rounded-control border border-brand-800 bg-white px-3 font-[inherit] text-small font-semibold text-brand-700 disabled:opacity-60"
                  >
                    Tinjau dan tandatangani resep
                  </button>
                )}
              </span>
            </div>
            <ul className="m-0 list-none p-0">
              {lines.map((l) => (
                <li
                  key={l.id}
                  className="flex flex-col gap-1.5 border-b border-line-soft px-4 py-2.5 last:border-b-0"
                >
                  <span className="flex flex-wrap items-center justify-between gap-2">
                    <span>
                      <span className="font-semibold">{l.name}</span>{' '}
                      <span className="text-caption text-ink-500">{l.detail}</span>
                    </span>
                    <span className="flex flex-wrap items-center gap-1.5">
                      <Chip tone={STATUS_TONE[l.status]}>{ORDER_STATUS_LABEL[l.status]}</Chip>
                      {canCancel && l.status === 'aktif' && cancelling !== l.id && (
                        <button
                          type="button"
                          onClick={() => setCancelling(l.id)}
                          className="min-h-11 cursor-pointer rounded-control border border-line-strong bg-white px-3 font-[inherit] text-caption font-semibold text-ink-700"
                        >
                          Batalkan
                        </button>
                      )}
                    </span>
                  </span>
                  {l.status === 'dibatalkan' && l.statusReason && (
                    <span className="text-caption text-ink-500">Alasan batal: {l.statusReason}</span>
                  )}
                  {cancelling === l.id && (
                    <CancelForm
                      encounterId={encounterId}
                      orderId={l.id}
                      name={l.name}
                      onDone={() => setCancelling(null)}
                    />
                  )}
                </li>
              ))}
            </ul>
            {overrides.length > 0 && (
              <ul className="m-0 list-none border-t border-line-soft bg-[#FFFAF2] px-4 py-2 text-caption text-warning">
                {overrides.map((a) => (
                  <li key={a.id}>
                    Override CDS oleh {a.decidedBy.nama}: {a.message} Alasan: {a.overrideReason}
                  </li>
                ))}
              </ul>
            )}
          </li>
        );
      })}
      {reviewError && (
        <li role="alert" className="text-small text-danger">
          {reviewError}
        </li>
      )}
    </ul>
  );
}
