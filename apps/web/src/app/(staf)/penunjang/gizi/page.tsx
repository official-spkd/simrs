import { formatTanggalWaktu } from '@simrs/shared';
import type { Metadata } from 'next';
import { DemoAccessDenied } from '@/components/demo-access-denied';
import { NutritionWorkspace } from '@/components/penunjang/gizi-workspace';
import { ScenarioBanner } from '@/components/scenario-banner';
import { getNutrition } from '@/lib/server/data/penunjang-lanjut';
import { requireDemoScreen } from '@/lib/server/demo-guard';

export const metadata: Metadata = { title: 'Gizi' };

/**
 * S07 · Gizi: order diet dari DPJP, skrining gizi, dan distribusi makan per bangsal dengan alergi makanan dan puasa
 * sebagai gerbang. Mode presentasi: data dummy fiktif (ADR-0023). Peran ahli gizi (`nutrisionis`, keputusan fase 4
 * #21) belum ada di katalog peran; sementara dibuka untuk perawat dan dokter.
 */
export default async function GiziPage() {
  const { session, screen, allowed } = await requireDemoScreen('gizi');
  if (!allowed) return <DemoAccessDenied screen={screen} />;
  const data = await getNutrition();
  return (
    <div className="flex flex-col gap-4">
      <header className="flex flex-col gap-0.5">
        <span className="text-caption text-ink-500">
          Penunjang / Instalasi gizi · S07 · {session.tenant.name} · data per {formatTanggalWaktu(data.asOf)}
        </span>
        <h1 className="m-0 text-h1 font-bold tracking-[-0.02em]">Gizi · diet dan distribusi makan</h1>
      </header>
      <ScenarioBanner session={session} screen="gizi" />
      <NutritionWorkspace data={data} userName={session.user.displayName} />
    </div>
  );
}
