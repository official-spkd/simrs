import { formatTanggalWaktu } from '@simrs/shared';
import type { Metadata } from 'next';
import { DemoAccessDenied } from '@/components/demo-access-denied';
import { BpjsView } from '@/components/integrasi/bpjs-view';
import { IntegrasiSubnav } from '@/components/integrasi/integrasi-subnav';
import { ScenarioBanner } from '@/components/scenario-banner';
import { getBpjsConnector } from '@/lib/server/data/integrasi-lanjut';
import { requireDemoScreen } from '@/lib/server/demo-guard';

export const metadata: Metadata = { title: 'Konektor BPJS' };

/**
 * I03 · Konektor BPJS: VClaim, Antrean (task ID), Aplicare, HFIS dengan volume, latensi, gangguan, dan mode downtime.
 * Mode presentasi: data dummy fiktif (ADR-0023).
 */
export default async function BpjsPage() {
  const { session, screen, allowed } = await requireDemoScreen('bpjs');
  if (!allowed) return <DemoAccessDenied screen={screen} />;
  const data = await getBpjsConnector();
  return (
    <div className="flex flex-col gap-4">
      <header className="flex flex-col gap-0.5">
        <span className="text-caption text-ink-500">
          Sistem / Integrasi / BPJS · I03 · {session.tenant.name} · data per {formatTanggalWaktu(data.asOf)}
        </span>
        <h1 className="m-0 text-h1 font-bold tracking-[-0.02em]">
          Konektor BPJS · VClaim, Antrean, Aplicare, HFIS
        </h1>
      </header>
      <IntegrasiSubnav current="/sistem/integrasi/bpjs" />
      <ScenarioBanner session={session} screen="bpjs" />
      <BpjsView data={data} userName={session.user.displayName} />
    </div>
  );
}
