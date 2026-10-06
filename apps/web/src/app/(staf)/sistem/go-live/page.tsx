import type { Metadata } from 'next';
import { DemoAccessDenied } from '@/components/demo-access-denied';
import { GoLiveBoard } from '@/components/operasional/golive-board';
import { ScreenHeader } from '@/components/platform/parts';
import { DECIDER_ROLE } from '@/lib/golive-toko';
import { getGoLiveReadiness } from '@/lib/server/data/platform';
import { requireDemoScreen } from '@/lib/server/demo-guard';

export const metadata: Metadata = { title: 'Kesiapan go-live' };

/**
 * Fase 10 · Kesiapan go-live: ceklis runbook + matriks 51 EP MRMIK (tanpa mockup). Mode presentasi (ADR-0023); ceklis
 * dan keputusan tersimpan di toko demo bersama (domain `golive`, ADR-0085), keputusan hanya oleh posisi Manajemen.
 */
export default async function GoLivePage() {
  const { session, screen, allowed } = await requireDemoScreen('golive');
  if (!allowed) return <DemoAccessDenied screen={screen} />;
  const d = await getGoLiveReadiness();
  return (
    <div className="flex flex-col gap-4">
      <ScreenHeader
        trail="Sistem / Kesiapan go-live · fase 10 · KMK 1596/2024 MRMIK"
        title="Kesiapan go-live · ceklis dan bukti MRMIK"
      />
      <GoLiveBoard
        eps={d.eps}
        areas={d.areas}
        owners={d.owners}
        director={d.director}
        state={d.store.state}
        canDecideRole={session.role?.code === DECIDER_ROLE}
        userName={session.user.displayName}
      />
    </div>
  );
}
