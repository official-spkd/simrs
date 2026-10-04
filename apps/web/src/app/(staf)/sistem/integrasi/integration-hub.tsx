'use client';

import { formatJam, type IntegrationOverview, type InterfaceId } from '@simrs/shared';
import { Button, Icon } from '@simrs/ui';
import { type ReactNode, useEffect, useMemo, useState } from 'react';
import { InterfaceCard } from '@/components/manajemen/interface-card';
import { demoNow } from '@/lib/demo/fixtures/waktu';
import { formatNumber } from '@/lib/manajemen';
import { DeadLetterQueue } from './dead-letter-queue';

type Counts = Partial<Record<InterfaceId, number>>;

/** Satu detak uji downtime (2 dtk): pesan antarmuka eksternal masuk antrean lokal secara bergiliran. */
function tick(cur: Counts, external: InterfaceId[], n: number): Counts {
  const next = { ...cur };
  const a = external[n % external.length];
  if (a) next[a] = (next[a] ?? 0) + 1;
  next.satusehat = (next.satusehat ?? 0) + 1;
  return next;
}

const sum = (c: Counts) => Object.values(c).reduce((a, b) => a + (b ?? 0), 0);

/**
 * I01–I06 · Pemantauan antarmuka (mockup Integrasi): uji mode downtime server edge, kartu status per antarmuka
 * (klik = saring dead-letter queue), dan dead-letter queue dengan kirim ulang terkonfirmasi.
 */
export function IntegrationHub({ data, aside }: { data: IntegrationOverview; aside: ReactNode }) {
  const [down, setDown] = useState<{ at: string } | null>(null);
  const [queued, setQueued] = useState<Counts>({});
  const [synced, setSynced] = useState<Counts>({});
  const [restored, setRestored] = useState<string | null>(null);
  const [dest, setDest] = useState<InterfaceId | null>(null);
  const [gone, setGone] = useState<Set<string>>(new Set());

  const external = useMemo(
    () => data.interfaces.filter((i) => i.external).map((i) => i.id),
    [data.interfaces],
  );
  const names = Object.fromEntries(data.interfaces.map((i) => [i.id, i.name])) as Record<InterfaceId, string>;

  useEffect(() => {
    if (!down) return;
    let n = 0;
    const timer = setInterval(() => {
      n += 1;
      const at = n;
      setQueued((q) => tick(q, external, at));
    }, 2000);
    return () => clearInterval(timer);
  }, [down, external]);

  const start = () => {
    setRestored(null);
    setQueued({});
    setDown({ at: formatJam(demoNow()) });
  };
  const restore = () => {
    const n = sum(queued);
    setSynced((s) => {
      const next = { ...s };
      for (const [id, v] of Object.entries(queued) as Array<[InterfaceId, number]>)
        next[id] = (next[id] ?? 0) + v;
      return next;
    });
    setQueued({});
    setDown(null);
    setRestored(
      `Koneksi pulih pukul ${formatJam(demoNow())} · ${formatNumber(n)} transaksi lokal disinkronkan ulang berurutan tanpa duplikasi. Server edge kembali online.`,
    );
  };

  const resentBy = (id: InterfaceId) =>
    data.deadLetters.filter((d) => d.target === id && gone.has(d.id)).length;
  const visible = data.deadLetters.filter((d) => !gone.has(d.id) && (!dest || d.target === dest));
  const holding = down !== null;

  return (
    <div className="flex flex-col gap-4">
      <div
        role="group"
        aria-label="Server edge"
        className="flex flex-wrap items-center gap-x-4 gap-y-2 rounded-card border border-line bg-white px-4 py-2.5"
      >
        <span className="flex-[1_1_280px] text-small text-ink-700">
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
        {!holding && <Button onClick={start}>Uji mode downtime</Button>}
      </div>

      {holding && down && (
        <div className="flex flex-wrap items-center gap-3.5 rounded-card border border-[#F1D3A8] bg-[linear-gradient(120deg,#FFF3E0,#FFFFFF_75%)] px-4 py-3">
          <span className="text-warning" aria-hidden="true">
            <Icon name="alert" size={22} />
          </span>
          <span className="flex flex-[1_1_380px] flex-col gap-0.5 text-small text-ink-700">
            {/* Hanya perubahan keadaan yang diumumkan; penghitung yang berdetak tiap 2 dtk di luar live region. */}
            <span role="status" className="flex flex-col gap-0.5">
              <span className="font-semibold text-warning">
                Mode downtime aktif sejak {down.at} · uji terkendali
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
          <Button variant="primary" onClick={restore}>
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
          onResent={(ids) => setGone((g) => new Set([...g, ...ids]))}
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
