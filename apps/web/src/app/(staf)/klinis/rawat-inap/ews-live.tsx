'use client';

import { type EwsEscalationSseEvent, formatJam } from '@simrs/shared';
import { Button, cx } from '@simrs/ui';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useEffect, useState } from 'react';
import { withBasePath } from '@/lib/base-path';
import { connectEwsStream, type EwsStreamStatus } from '@/lib/ews-sse';

const STATUS_LABEL: Record<EwsStreamStatus, string> = {
  menyambung: 'Menyambung pemantauan EWS…',
  tersambung: 'Pemantauan EWS langsung aktif',
  terputus: 'Pemantauan EWS terputus, menyambung ulang…',
};

/**
 * K12 · Eskalasi EWS langsung (SSE `ews`, ADR-0026) di layar Rawat inap mode api. Muatan aliran tanpa PHI: nama dan
 * bed pasien diambil dari daftar yang sudah lolos ABAC di server (`patients`); kunjungan di luar daftar tampil sebagai
 * "pasien di unit Anda". `encounterId` = hanya eskalasi pasien itu (halaman rekam satu pasien).
 */
export function EwsLive({
  patients,
  encounterId,
}: {
  patients: Record<string, string>;
  encounterId?: string;
}) {
  const router = useRouter();
  const [status, setStatus] = useState<EwsStreamStatus>('menyambung');
  const [alerts, setAlerts] = useState<EwsEscalationSseEvent[]>([]);

  useEffect(() => {
    const conn = connectEwsStream({
      url: withBasePath('/klinis/rawat-inap/events'),
      onStatus: setStatus,
      onEscalation: (ev) => {
        if (encounterId && ev.encounterId !== encounterId) return;
        setAlerts((cur) =>
          cur.some((a) => a.observationId === ev.observationId) ? cur : [ev, ...cur].slice(0, 5),
        );
      },
    });
    return () => conn.close();
  }, [encounterId]);

  return (
    <section aria-label="Eskalasi EWS langsung" className="flex flex-col gap-2">
      <span
        role="status"
        className={cx(
          'text-caption font-semibold',
          status === 'tersambung' ? 'text-success' : status === 'terputus' ? 'text-warning' : 'text-ink-500',
        )}
      >
        {STATUS_LABEL[status]}
      </span>
      {alerts.length > 0 && (
        <div role="alert" className="rounded-card border border-koral-200 bg-alert-critical px-4 py-3">
          <ul className="m-0 flex list-none flex-col gap-1.5 p-0">
            {alerts.map((a) => (
              <li key={a.observationId} className="flex flex-wrap items-center gap-2 text-small">
                <span className="font-semibold text-danger-strong">
                  Eskalasi EWS {formatJam(a.at)} · skor {a.score} (risiko {a.risk})
                </span>
                <span className="text-ink-700">
                  {patients[a.encounterId] ?? 'Pasien di unit Anda'} · tinjau segera dan hubungi DPJP/tim
                  respons cepat sesuai protokol.
                </span>
                {!encounterId && (
                  <Link
                    href={`/klinis/rawat-inap/${a.encounterId}?tab=obs`}
                    className="inline-flex min-h-11 items-center rounded-control border border-line-strong bg-white/90 px-3 text-small font-semibold text-ink-900 no-underline hover:bg-brand-50/60"
                  >
                    Buka rekam pasien
                  </Link>
                )}
              </li>
            ))}
          </ul>
          <Button size="sm" className="mt-2" onClick={() => router.refresh()}>
            Perbarui data
          </Button>
        </div>
      )}
    </section>
  );
}
