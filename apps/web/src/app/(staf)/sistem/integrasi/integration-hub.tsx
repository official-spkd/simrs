'use client';

import { formatJam, type IntegrationOverview, type InterfaceId } from '@simrs/shared';
import { Button, Icon } from '@simrs/ui';
import Link from 'next/link';
import { type ReactNode, useEffect, useState } from 'react';
import { InterfaceCard } from '@/components/manajemen/interface-card';
import { useStoreAction } from '@/lib/demo/store/client';
import type { IntegrationState } from '@/lib/integrasi-demo';
import { hubStateAction } from './actions';
import { formatNumber } from '@/lib/manajemen';
import { DeadLetterQueue } from './dead-letter-queue';

type Counts = Partial<Record<InterfaceId, number>>;

const sum = (c: Counts) => Object.values(c).reduce((a, b) => a + (b ?? 0), 0);

/**
 * I01–I06 · Pemantauan antarmuka (mockup Integrasi): uji mode downtime server edge, kartu status per antarmuka
 * (klik = saring dead-letter queue), dan dead-letter queue dengan kirim ulang terkonfirmasi.
 */
export function IntegrationHub({
  data,
  aside,
  heading,
  subnav,
  rev,
  stored,
}: {
  data: IntegrationOverview;
  rev: number;
  stored: IntegrationState['hub'];
  aside: ReactNode;
  /** Judul halaman; status server edge, Uji mode downtime, dan Log audit sebaris di kanannya (mockup). */
  heading: ReactNode;
  /** Navigasi sub-layar dan banner skenario di bawah kepala layar. */
  subnav?: ReactNode;
}) {
  const { down, queued, synced, restored } = stored;
  const gone = new Set(stored.gone);
  const [dest, setDest] = useState<InterfaceId | null>(null);
  const [error, setError] = useState<string | null>(null);
  const { run: save, pending } = useStoreAction(rev);
  const names = Object.fromEntries(data.interfaces.map((i) => [i.id, i.name])) as Record<InterfaceId, string>;
  useEffect(() => {
    if (!down) return;
    const timer = setInterval(
      () =>
        save(
          (rev) => hubStateAction('hub.detak', rev),
          (result) => {
            if (!result.ok && !result.stale) setError(result.message);
          },
        ),
      2000,
    );
    return () => clearInterval(timer);
  }, [down, save]);
  const act = (type: 'hub.mulai' | 'hub.pulih') =>
    save(
      (rev) => hubStateAction(type, rev),
      (result) => setError(result.ok ? null : result.message),
    );
  const start = () => act('hub.mulai');
  const restore = () => act('hub.pulih');

  const resentBy = (id: InterfaceId) =>
    data.deadLetters.filter((d) => d.target === id && gone.has(d.id)).length;
  const visible = data.deadLetters.filter((d) => !gone.has(d.id) && (!dest || d.target === dest));
  const holding = down !== null;

  return (
    <div className="flex flex-col gap-4">
      <header className="flex flex-wrap items-center justify-between gap-3">
        {heading}
        <div
          role="group"
          aria-label="Server edge"
          className="flex flex-wrap items-center justify-end gap-x-3 gap-y-2"
        >
          <span className="text-small text-ink-700">
            <span
              aria-hidden="true"
              className={`mr-1.5 inline-block size-2 rounded-full ${holding ? 'bg-warning' : 'bg-success'}`}
            />
            Server edge:{' '}
            {holding ? (
              <>
                <span className="font-semibold text-warning">mode downtime (uji)</span> · replikasi ke cloud
                dijeda
              </>
            ) : (
              <>
                <span className="font-semibold text-success">online</span> · replikasi ke cloud tertinggal{' '}
                {data.replicationLagSeconds} dtk
              </>
            )}
          </span>
          {!holding && (
            <Button disabled={pending} onClick={start}>
              Uji mode downtime
            </Button>
          )}
          <Link
            href="/sistem/audit"
            className="inline-flex h-11 items-center rounded-control border border-line-strong bg-white px-4 font-medium text-ink-900 no-underline"
          >
            Log audit
          </Link>
        </div>
      </header>
      {subnav}
      {error && (
        <p role="alert" className="m-0 text-small text-danger">
          {error}
        </p>
      )}

      {holding && down && (
        <div className="flex flex-wrap items-center gap-3.5 rounded-card border border-[#F1D3A8] bg-[linear-gradient(120deg,#FFF3E0,#FFFFFF_75%)] px-4 py-3">
          <span className="text-warning" aria-hidden="true">
            <Icon name="alert" size={22} />
          </span>
          <span className="flex flex-[1_1_380px] flex-col gap-0.5 text-small text-ink-700">
            {/* Hanya perubahan keadaan yang diumumkan; penghitung yang berdetak tiap 2 dtk di luar live region. */}
            <span role="status" className="flex flex-col gap-0.5">
              <span className="font-semibold text-warning">
                Mode downtime aktif sejak {formatJam(down.at)} · uji terkendali
              </span>
              <span>
                Layanan klinis dan kasir tetap berjalan. Setiap transaksi disimpan lokal di server edge dengan
                penanda waktu dan kunci idempotensi, lalu disinkronkan ulang ke cloud, SATUSEHAT, dan BPJS
                sesuai urutan kejadian saat koneksi pulih.
              </span>
            </span>
            <span>
              Transaksi tersimpan lokal selama uji:{' '}
              <span className="font-mono font-semibold text-ink-900">{formatNumber(sum(queued))}</span>
            </span>
          </span>
          <Button variant="primary" disabled={pending} onClick={restore}>
            Pulihkan
          </Button>
        </div>
      )}
      {!holding && restored && (
        <div
          role="status"
          className="rounded-card border border-[#BFE0C7] bg-[#EAF5EC] px-4 py-2.5 text-small font-medium text-success"
        >
          {restored}
        </div>
      )}

      <section
        aria-label="Status antarmuka"
        className="grid grid-cols-[repeat(auto-fill,minmax(280px,1fr))] gap-3.5"
      >
        {data.interfaces.map((card) => (
          <InterfaceCard
            key={card.id}
            card={card}
            failed={Math.max(0, card.failedToday - resentBy(card.id))}
            queued={queued[card.id] ?? 0}
            synced={synced[card.id] ?? 0}
            holding={holding && card.external}
            pressed={dest === card.id}
            onSelect={() => setDest((d) => (d === card.id ? null : card.id))}
          />
        ))}
      </section>

      <div className="flex flex-wrap items-start gap-4">
        <DeadLetterQueue
          messages={visible}
          names={names}
          filterName={dest ? names[dest] : null}
          onClearFilter={() => setDest(null)}
          holding={holding}
          rev={rev}
        />
        <aside
          aria-label="Kepatuhan dan keamanan"
          className="flex min-w-0 flex-[1_1_300px] flex-col gap-4 xl:max-w-[380px]"
        >
          {aside}
        </aside>
      </div>
    </div>
  );
}
