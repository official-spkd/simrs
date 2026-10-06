import { formatTanggalWaktu } from '@simrs/shared';
import type { Metadata } from 'next';
import Link from 'next/link';
import { DemoAccessDenied } from '@/components/demo-access-denied';
import { DepoWorkspace } from '@/components/penunjang/depo-workspace';
import { ScenarioBanner } from '@/components/scenario-banner';
import { getDepoData } from '@/lib/server/data/penunjang-lanjut';
import { requireDemoScreen } from '@/lib/server/demo-guard';

export const metadata: Metadata = { title: 'Depo & stok farmasi' };

/**
 * S05 · Depo dan stok farmasi: stok per depo dengan batch/ED, FEFO, mutasi antar depo dua langkah, stok opname, dan
 * peringatan kedaluwarsa. Mode presentasi: data dummy fiktif (ADR-0023).
 */
export default async function DepoPage() {
  const { session, screen, allowed } = await requireDemoScreen('depo');
  if (!allowed) return <DemoAccessDenied screen={screen} />;
  const data = await getDepoData();
  return (
    <div className="flex flex-col gap-4">
      <header className="flex flex-wrap items-center justify-between gap-3">
        <div className="flex flex-col gap-0.5">
          <span className="text-caption text-ink-500">
            Penunjang / Farmasi / Depo dan stok · S05 · {session.tenant.name} · data per{' '}
            {formatTanggalWaktu(data.asOf)}
          </span>
          <h1 className="m-0 text-h1 font-semibold">Depo & stok farmasi</h1>
        </div>
        <Link
          href="/penunjang/farmasi"
          className="inline-flex h-11 items-center rounded-control border border-line-strong bg-white px-4 font-medium text-ink-900 no-underline"
        >
          Antrean resep
        </Link>
      </header>
      <ScenarioBanner session={session} screen="depo" />
      <DepoWorkspace userId={session.user.id} data={data} userName={session.user.displayName} />
    </div>
  );
}
