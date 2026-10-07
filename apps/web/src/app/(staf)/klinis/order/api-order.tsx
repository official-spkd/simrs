import { Alert, Chip, Icon } from '@simrs/ui';
import Link from 'next/link';
import { ApiError } from '@/lib/server/api-core';
import { type CpoeApiEncounter, getCpoeEncountersApi } from '@/lib/server/data/klinis/cpoe';
import type { SessionView } from '@/lib/session-view';

const CLASS_LABEL = { AMB: 'Rawat jalan', EMER: 'IGD', IMP: 'Rawat inap' } as const;

/**
 * K09 · Pilih kunjungan untuk CPOE, mode api (layar W2): pasien tempat saya DPJP/rawat bersama + pasien di unit
 * penugasan, dari worklist K01. Kunjungan dengan order residen yang menunggu tinjauan saya tampil teratas.
 */
export async function ApiOrderIndex({ session }: { session: SessionView }) {
  let encounters: CpoeApiEncounter[];
  try {
    encounters = await getCpoeEncountersApi();
  } catch (err) {
    if (err instanceof ApiError && err.status === 403) {
      return (
        <div className="flex max-w-3xl flex-col gap-4">
          <h1 className="m-0 text-h1 font-bold tracking-[-0.02em]">Order &amp; resep (CPOE)</h1>
          <Alert level="warning" title="Akses ditolak">
            {err.message}
          </Alert>
        </div>
      );
    }
    throw err;
  }
  return (
    <div className="flex flex-col gap-4">
      <header className="flex flex-col gap-0.5">
        <span className="text-caption text-ink-500">Klinis / Order &amp; resep · {session.tenant.name}</span>
        <h1 className="m-0 text-h1 font-bold tracking-[-0.02em]">Order &amp; resep (CPOE)</h1>
      </header>
      <section
        aria-label="Kunjungan berjalan"
        className="overflow-hidden rounded-card border border-white/95 bg-white/90 shadow-card"
      >
        <h2 className="m-0 border-b border-line px-4 py-3 text-[15px] font-semibold">Kunjungan berjalan</h2>
        {encounters.length === 0 ? (
          <p className="m-0 px-4 py-4 text-small text-ink-500">
            Belum ada kunjungan berjalan di unit Anda atau pasien tempat Anda DPJP.
          </p>
        ) : (
          <ul className="m-0 list-none p-0">
            {encounters.map((e) => (
              <li key={e.encounterId} className="border-b border-line-soft last:border-b-0">
                <Link
                  href={`/klinis/order/${e.encounterId}`}
                  className="flex min-h-11 flex-wrap items-center justify-between gap-3 px-4 py-3 text-ink-900 no-underline hover:bg-brand-50/60"
                >
                  <span className="flex min-w-0 flex-col gap-0.5">
                    <span className="font-semibold">{e.name}</span>
                    <span className="text-caption text-ink-500">
                      RM <span className="font-mono">{e.mrn}</span> · {e.encounterNumber} ·{' '}
                      {CLASS_LABEL[e.class]} · {e.unitName}
                      {e.bed ? ` · ${e.bed}` : ''}
                    </span>
                  </span>
                  <span className="flex flex-wrap items-center gap-1.5">
                    {e.reviewTasks > 0 && (
                      <Chip tone="warning">{e.reviewTasks} order residen menunggu tinjauan</Chip>
                    )}
                    <Icon name="chevronRight" size={16} />
                  </span>
                </Link>
              </li>
            ))}
          </ul>
        )}
      </section>
    </div>
  );
}
