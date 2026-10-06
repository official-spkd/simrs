import { formatTanggalWaktu } from '@simrs/shared';
import type { Metadata } from 'next';
import { DemoAccessDenied } from '@/components/demo-access-denied';
import { IntegrasiSubnav } from '@/components/integrasi/integrasi-subnav';
import { KemenkesView } from '@/components/integrasi/kemenkes-view';
import { ScenarioBanner } from '@/components/scenario-banner';
import { getKemenkesReports } from '@/lib/server/data/integrasi-lanjut';
import { requireDemoScreen } from '@/lib/server/demo-guard';

export const metadata: Metadata = { title: 'Kemenkes (SIRS)' };

/**
 * I04 · Konektor Kemenkes: RS Online (ketersediaan tempat tidur) dan laporan SIRS bulanan dengan validasi bentuk,
 * kirim berkonfirmasi, dan idempotensi per periode. Mode presentasi: data dummy fiktif (ADR-0023).
 */
export default async function KemenkesPage() {
  const { session, screen, allowed } = await requireDemoScreen('kemenkes');
  if (!allowed) return <DemoAccessDenied screen={screen} />;
  const data = await getKemenkesReports();
  return (
    <div className="flex flex-col gap-4">
      <header className="flex flex-col gap-0.5">
        <span className="text-caption text-ink-500">
          Sistem / Integrasi / Kemenkes · I04 · {session.tenant.name} · data per{' '}
          {formatTanggalWaktu(data.asOf)}
        </span>
        <h1 className="m-0 text-h1 font-semibold">Kemenkes · RS Online dan SIRS</h1>
      </header>
      <IntegrasiSubnav current="/sistem/integrasi/kemenkes" />
      <ScenarioBanner session={session} screen="kemenkes" />
      <KemenkesView rev={data.rev} reports={data.reports} />
    </div>
  );
}
