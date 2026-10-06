import { formatTanggalWaktu } from '@simrs/shared';
import type { Metadata } from 'next';
import { DemoAccessDenied } from '@/components/demo-access-denied';
import { IntegrasiSubnav } from '@/components/integrasi/integrasi-subnav';
import { GatewayView } from '@/components/integrasi/perangkat-view';
import { ScenarioBanner } from '@/components/scenario-banner';
import { getDeviceGateway } from '@/lib/server/data/integrasi-lanjut';
import { requireDemoScreen } from '@/lib/server/demo-guard';

export const metadata: Metadata = { title: 'Perangkat medis' };

/**
 * I06 · Device gateway (simulasi): analyzer HL7 v2 → ACK → cocokkan nomor lab → hasil sebagai draf menunggu
 * validasi analis. Mode presentasi: data dummy fiktif (ADR-0023).
 */
export default async function PerangkatPage() {
  const { session, screen, allowed } = await requireDemoScreen('perangkat');
  if (!allowed) return <DemoAccessDenied screen={screen} />;
  const data = await getDeviceGateway();
  return (
    <div className="flex flex-col gap-4">
      <header className="flex flex-col gap-0.5">
        <span className="text-caption text-ink-500">
          Sistem / Integrasi / Perangkat medis · I06 · {session.tenant.name} · data per{' '}
          {formatTanggalWaktu(data.asOf)}
        </span>
        <h1 className="m-0 text-h1 font-semibold">Perangkat medis · device gateway HL7</h1>
      </header>
      <IntegrasiSubnav current="/sistem/integrasi/perangkat" />
      <ScenarioBanner session={session} screen="perangkat" />
      <GatewayView data={data} />
    </div>
  );
}
