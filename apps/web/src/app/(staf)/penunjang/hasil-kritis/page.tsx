import { formatTanggalWaktu } from '@simrs/shared';
import type { Metadata } from 'next';
import { DemoAccessDenied } from '@/components/demo-access-denied';
import { CriticalCenterView } from '@/components/penunjang/kritis-center';
import { ScenarioBanner } from '@/components/scenario-banner';
import { getCriticalCenter } from '@/lib/server/data/penunjang-lanjut';
import { requireDemoScreen } from '@/lib/server/demo-guard';
import { readDomain } from '@/lib/server/demo/state';

export const metadata: Metadata = { title: 'Pusat hasil kritis' };

type SearchParams = Promise<Record<string, string | string[] | undefined>>;

/**
 * S09 · Pusat hasil kritis: nilai kritis lintas unit dengan timer 30 menit, pelaporan berpenerima + read-back wajib,
 * eskalasi berjenjang, dan metrik kepatuhan durasi lapor. Mode presentasi: data dummy fiktif (ADR-0023).
 */
export default async function HasilKritisPage({ searchParams }: { searchParams: SearchParams }) {
  const { session, screen, allowed } = await requireDemoScreen('kritis');
  if (!allowed) return <DemoAccessDenied screen={screen} />;
  const sp = await searchParams;
  const data = await getCriticalCenter(session);
  const { rev } = await readDomain('hasil-kritis');
  const pilih = typeof sp.pilih === 'string' && data.items.some((i) => i.id === sp.pilih) ? sp.pilih : null;
  return (
    <div className="flex flex-col gap-4">
      <header className="flex flex-col gap-0.5">
        <span className="text-caption text-ink-500">
          Penunjang / Hasil kritis · S09 · {session.tenant.name} · data per {formatTanggalWaktu(data.asOf)}
        </span>
        <h1 className="m-0 text-h1 font-bold tracking-[-0.02em]">Pusat hasil kritis</h1>
      </header>
      <ScenarioBanner session={session} screen="kritis" />
      <CriticalCenterView data={data} initialSelected={pilih} rev={rev} />
    </div>
  );
}
