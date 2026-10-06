'use client';

import { formatRupiah, type PaymentTransaction, type TrailState } from '@simrs/shared';
import { Button, Chip, cx } from '@simrs/ui';
import Link from 'next/link';
import type { ReactNode } from 'react';
import {
  CHANNEL_LABEL,
  canSimulatePay,
  creditedAmount,
  formatWhen,
  STATUS_LABEL,
  STATUS_TONE,
  TRAIL_MARK,
  webhookDelivered,
} from '@/lib/btn';

const DOT: Record<TrailState, string> = {
  selesai: 'border-brand-600 bg-brand-600 text-white',
  menunggu: 'border-line-strong bg-white text-ink-500',
  gagal: 'border-danger bg-danger text-white',
  peringatan: 'border-warning bg-warning-bg text-warning',
  info: 'border-info bg-white text-info',
  lewati: 'border-line bg-muted text-ink-500',
};

/** Payload webhook ringkas (contoh kontrak docs/07 §2; tanda tangan hanya tampil tersamar). */
function payload(tx: PaymentTransaction): string {
  if (tx.channel === 'EDC') {
    // Terminal dari jejak status ("terminal kasir IGD-01"), bukan nilai tetap.
    const terminal = /terminal (?:kasir )?([A-Z]+-\d+)/.exec(tx.trail[0]?.note ?? '')?.[1] ?? '—';
    return [
      `EDC BTN · terminal ${terminal} · ${tx.status === 'gagal' ? 'response 51 (limit tidak cukup)' : 'response 00 (approved)'}`,
      `trace ${tx.externalRef ?? '—'} · ${tx.reference ?? '—'}`,
      `{ "invoice": "${tx.invoiceNo}", "amount": ${tx.amount},`,
      `  "settlement": "batch harian ke BTN ${tx.account}" }`,
      'EDC tidak melalui TPDI; dicocokkan langsung dengan mutasi BTN.',
    ].join('\n');
  }
  const last = tx.webhooks.filter((w) => !w.duplicate).at(-1);
  if (!last) return 'Belum ada webhook dari TPDI untuk tagihan ini.';
  const delivered = webhookDelivered(last);
  // Dana sudah mengendap di BTN hanya bila dibayar; tagihan menunggu/kedaluwarsa menyebut batas berlakunya.
  const settled =
    tx.status === 'lunas' || tx.status === 'dikembalikan' || tx.status === 'selisih' || !!tx.paidAt;
  const tail =
    settled && last.event !== 'payment.expired'
      ? `  "settled_to": "BTN ${tx.account}", "paid_at": "${tx.paidAt ?? last.receivedAt}" }`
      : `  "expires_at": "${tx.expiresAt ?? '—'}" }`;
  const lines = [
    `POST /api/v1/webhooks/tpdi/RSFA ${delivered ? '←' : '→'} ${last.response}`,
    `X-TPDI-Event-Id: ${last.id}`,
    delivered
      ? `X-TPDI-Signature: sha256=••••${last.id.slice(-4)} (${last.signatureValid ? 'valid' : 'tidak valid'})`
      : 'X-TPDI-Signature: belum diverifikasi (webhook belum sampai SIM RS)',
    `{ "event": "${last.event}", "merchant_id": "TPDI-RS-00127",`,
    `  "channel": "${tx.channel === 'VA' ? 'VA_BTN' : 'QRIS_BTN'}", "invoice_id": "${tx.invoiceNo}",`,
    `  "external_ref": "${tx.externalRef ?? ''}", "${tx.channel === 'VA' ? 'va_number' : 'qr_ref'}": "${tx.reference ?? ''}",`,
    `  "amount": ${last.amount},`,
    tail,
  ];
  for (const d of tx.webhooks.filter((w) => w.duplicate)) {
    lines.push(`${formatWhen(d.receivedAt)} callback ulang · event id sama → 200 OK, diabaikan (idempoten)`);
  }
  return lines.join('\n');
}

/** Panel detail transaksi: info, jejak status, webhook (signature + idempotensi), payload, dan aksi. */
export function TransaksiDetail({
  tx,
  busy,
  onSimulatePay,
  kasirHref,
  scenarioControls,
}: {
  tx: PaymentTransaction;
  busy: boolean;
  onSimulatePay: () => void;
  kasirHref: string | null;
  scenarioControls: ReactNode;
}) {
  const info: Array<[string, string, boolean]> = [
    ['ID transaksi', tx.externalRef ?? 'belum dibuat', true],
    [
      'Kanal',
      `${CHANNEL_LABEL[tx.channel]}${tx.channel === 'EDC' ? ' · langsung BTN' : ' · via TPDI'}`,
      false,
    ],
    ['Referensi', tx.reference ?? '—', true],
    ['Rekening tujuan', `BTN ${tx.account} · operasional`, false],
    ['Keterangan', tx.purpose, false],
  ];
  const credited = creditedAmount(tx.webhooks);
  return (
    <aside
      aria-label="Detail transaksi"
      aria-live="polite"
      className="flex min-w-0 flex-[1_1_340px] flex-col gap-3 rounded-card border border-white/95 bg-white/90 shadow-card p-4 lg:max-w-[440px]"
    >
      <span className="flex flex-wrap items-start justify-between gap-2">
        <span className="flex min-w-0 flex-col">
          <span className="font-semibold">{tx.patient.name}</span>
          <span className="font-mono text-caption text-ink-500">
            {tx.invoiceNo} · {formatRupiah(BigInt(tx.amount))}
          </span>
        </span>
        <Chip tone={STATUS_TONE[tx.status]}>{STATUS_LABEL[tx.status]}</Chip>
      </span>
      <dl className="m-0 grid grid-cols-[auto_minmax(0,1fr)] gap-x-3 gap-y-1 text-small">
        {info.map(([k, v, mono]) => (
          <div key={k} className="contents">
            <dt className="text-ink-500">{k}</dt>
            <dd className={cx('m-0 break-words', mono && 'font-mono')}>{v}</dd>
          </div>
        ))}
      </dl>
      <div className="flex flex-col gap-1.5">
        <span className="text-small font-semibold">Jejak status</span>
        <ol className="m-0 flex list-none flex-col gap-2 p-0">
          {tx.trail.map((s, i) => (
            <li key={`${s.label}-${i}`} className="flex gap-2.5 text-small">
              <span
                aria-hidden="true"
                className={cx(
                  'mt-0.5 flex size-5 flex-none items-center justify-center rounded-full border text-[11px] font-bold',
                  DOT[s.state],
                )}
              >
                {TRAIL_MARK[s.state]}
              </span>
              <span className="flex min-w-0 flex-1 flex-col">
                <span className="flex flex-wrap justify-between gap-x-2">
                  <span className={cx('font-medium', s.state === 'gagal' && 'text-danger')}>
                    <span className="sr-only">{s.state}: </span>
                    {s.label}
                  </span>
                  {s.at && <span className="font-mono text-caption text-ink-500">{formatWhen(s.at)}</span>}
                </span>
                {s.note && <span className="text-caption text-ink-700">{s.note}</span>}
              </span>
            </li>
          ))}
        </ol>
      </div>
      {tx.webhooks.length > 0 && (
        <div className="flex flex-col gap-1.5">
          <span className="text-small font-semibold">Webhook TPDI</span>
          <ul className="m-0 flex list-none flex-col gap-1 p-0 text-caption">
            {tx.webhooks.map((w, i) => (
              <li key={`${w.id}-${i}`} className="flex flex-wrap items-center gap-1.5">
                <span className="font-mono">{formatWhen(w.receivedAt)}</span>
                <span className="font-mono">{w.event}</span>
                {webhookDelivered(w) ? (
                  <Chip tone={w.signatureValid ? 'success' : 'danger'}>
                    {w.signatureValid ? '✓ HMAC valid' : '✕ HMAC tidak valid'}
                  </Chip>
                ) : (
                  <Chip tone="warning">! belum sampai · {w.response}</Chip>
                )}
                {w.duplicate && <Chip tone="warning">duplikat · diabaikan</Chip>}
              </li>
            ))}
          </ul>
          <span className="text-caption text-ink-700">
            {tx.webhooks.some((w) => !webhookDelivered(w)) && credited === 0n
              ? 'Webhook belum sampai ke SIM RS: belum ada yang dikreditkan lewat webhook.'
              : `Dikreditkan sekali per event id: ${formatRupiah(credited)}`}
          </span>
        </div>
      )}
      <div className="flex flex-col gap-1">
        <span className="text-small font-semibold">
          {tx.channel === 'EDC' ? 'Respons EDC (ringkas)' : 'Payload webhook TPDI (ringkas)'}
        </span>
        <pre className="m-0 overflow-x-auto whitespace-pre-wrap break-all rounded-control bg-batu-100 p-2.5 font-mono text-[11.5px] leading-relaxed text-ink-700">
          {payload(tx)}
        </pre>
      </div>
      {scenarioControls}
      {canSimulatePay(tx) && (
        <Button
          disabled={busy}
          onClick={onSimulatePay}
          className="border-dashed border-brand-700 font-semibold text-brand-700"
        >
          Simulasikan pembayaran (webhook TPDI)
        </Button>
      )}
      {tx.openInCashier && kasirHref && (
        <Link
          href={kasirHref}
          className="inline-flex min-h-11 items-center justify-center rounded-control border border-line-strong px-4 font-medium text-ink-900 no-underline"
        >
          Buka tagihan di Kasir
        </Link>
      )}
    </aside>
  );
}
