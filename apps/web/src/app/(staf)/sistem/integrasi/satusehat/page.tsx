import { formatTanggalWaktu } from '@simrs/shared';
import type { Metadata } from 'next';
import { DemoAccessDenied } from '@/components/demo-access-denied';
import { IntegrasiSubnav } from '@/components/integrasi/integrasi-subnav';
import { SatusehatView } from '@/components/integrasi/satusehat-view';
import { ScenarioBanner } from '@/components/scenario-banner';
import { getSatusehatVisits } from '@/lib/server/data/integrasi-lanjut';
import { requireDemoScreen } from '@/lib/server/demo-guard';

export const metadata: Metadata = { title: 'SATUSEHAT' };

/**
 * I02 · Konektor SATUSEHAT: status per kunjungan (Encounter → anak berurutan), resource ditahan/terkirim/gagal,
 * DLQ dengan payload tersamar, perbaikan data → kirim ulang berkonfirmasi dan diaudit, lookup IHS. Mode presentasi:
 * data dummy fiktif (ADR-0023).
 */
export default async function SatusehatPage() {
  const { session, screen, allowed } = await requireDemoScreen('satusehat');
  if (!allowed) return <DemoAccessDenied screen={screen} />;
  const data = await getSatusehatVisits();
  return (
    <div className="flex flex-col gap-4">
      <header className="flex flex-col gap-0.5">
        <span className="text-caption text-ink-500">
          Sistem / Integrasi / SATUSEHAT · I02 · {session.tenant.name} · data per{' '}
          {formatTanggalWaktu(data.asOf)}
        </span>
        <h1 className="m-0 text-h1 font-bold tracking-[-0.02em]">SATUSEHAT · pengiriman per kunjungan</h1>
      </header>
      <IntegrasiSubnav current="/sistem/integrasi/satusehat" />
      <ScenarioBanner session={session} screen="satusehat" />
      <SatusehatView
        rev={data.rev}
        visits={data.visits}
        fixed={data.fixed}
        audit={data.audit}
        userName={session.user.displayName}
      />
    </div>
  );
}
