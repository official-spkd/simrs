'use client';

import { formatJam, formatTanggalWaktu, MEDICATION_FREQUENCIES, type OrderGroup } from '@simrs/shared';
import { Button, Chip } from '@simrs/ui';
import { useId, useState, useTransition } from 'react';
import { cancelOrderAction, reviewOrderAction } from '@/app/(staf)/klinis/order/actions';
import { ORDER_STATUS_LABEL, TTE_STATUS_LABEL } from '@/lib/cpoe-api';

const STATUS_TONE = { aktif: 'success', dibatalkan: 'neutral', selesai: 'info' } as const;
const TTE_TONE = { pending: 'info', signed: 'success', failed: 'danger' } as const;

/** Kiriman masih memuat obat aktif (tinjauan menerbitkan resep ber-TTE peninjau). */
const hasActiveMedication = (g: OrderGroup) => g.medicationRequests.some((m) => m.status === 'aktif');

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
  /** Dipanggil saat form ditutup; berisi kabar bila order berhasil dibatalkan. */
  onDone: (message?: string) => void;
}) {
  const id = useId();
  const [reason, setReason] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [pending, start] = useTransition();
  const short = reason.trim().length < 10;
  return (
    <form
      className="flex flex-col gap-1.5 rounded-control border border-line bg-card-header p-2.5"
      onSubmit={(e) => {
        e.preventDefault();
        if (short) return;
        start(async () => {
          const r = await cancelOrderAction({ encounterId, orderId, reason: reason.trim() });
          if (!r.ok) return setError(r.message);
          onDone(`${name} dibatalkan.`);
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
        <Button type="submit" variant="danger" disabled={short || pending}>
          {pending ? 'Membatalkan…' : 'Batalkan order'}
        </Button>
        <Button onClick={() => onDone()} disabled={pending}>
          Tutup
        </Button>
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
  const [notice, setNotice] = useState<string | null>(null);
  const [pending, start] = useTransition();
  if (groups.length === 0) {
    return (
      <p className="m-0 rounded-card border border-dashed border-line-strong bg-white/80 p-4 text-small text-ink-500">
        Belum ada order terkirim untuk kunjungan ini.
      </p>
    );
  }
  return (
    <div className="flex flex-col gap-3">
      {notice && (
        <p
          role="status"
          className="m-0 rounded-card border border-zamrud-200 bg-alert-success px-4 py-3 text-small font-semibold text-success"
        >
          {notice}
        </p>
      )}
      {reviewError && (
        <p
          role="alert"
          className="m-0 rounded-control border border-koral-200 bg-alert-critical px-3 py-2 text-small text-danger"
        >
          {reviewError}
        </p>
      )}
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
            <li
              key={g.id}
              aria-label={`Kiriman ${formatTanggalWaktu(g.orderedAt)} oleh ${g.orderedBy.nama}`}
              className="overflow-hidden rounded-card border border-white/95 bg-white/90 shadow-card"
            >
              <div className="flex flex-wrap items-center justify-between gap-2 border-b border-line bg-card-header px-4 py-2.5">
                <span className="text-small">
                  <span className="font-semibold">{formatTanggalWaktu(g.orderedAt)}</span> ·{' '}
                  {g.orderedBy.nama}
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
                    <Button
                      variant="primary"
                      size="sm"
                      disabled={pending}
                      onClick={() =>
                        start(async () => {
                          setReviewError(null);
                          setNotice(null);
                          const r = await reviewOrderAction({ encounterId, groupId: g.id });
                          if (!r.ok) return setReviewError(r.message);
                          setNotice(r.message);
                        })
                      }
                    >
                      {hasActiveMedication(g) ? 'Tinjau dan tandatangani resep' : 'Tinjau order'}
                    </Button>
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
                          <Button size="sm" className="text-caption" onClick={() => setCancelling(l.id)}>
                            Batalkan
                          </Button>
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
                        onDone={(message) => {
                          setCancelling(null);
                          if (message) setNotice(message);
                        }}
                      />
                    )}
                  </li>
                ))}
              </ul>
              {overrides.length > 0 && (
                <ul className="m-0 list-none border-t border-line-soft bg-alert-warning px-4 py-2 text-caption text-warning">
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
      </ul>
    </div>
  );
}
