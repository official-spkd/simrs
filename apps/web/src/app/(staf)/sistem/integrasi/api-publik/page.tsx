import { formatTanggalWaktu } from '@simrs/shared';
import type { Metadata } from 'next';
import { DemoAccessDenied } from '@/components/demo-access-denied';
import { IntegrasiSubnav } from '@/components/integrasi/integrasi-subnav';
import { ApiPublicView } from '@/components/integrasi/api-publik-view';
import { ScenarioBanner } from '@/components/scenario-banner';
import { getApiClients } from '@/lib/server/data/integrasi-lanjut';
import { requireDemoScreen } from '@/lib/server/demo-guard';

export const metadata: Metadata = { title: 'API publik & FHIR' };

/**
 * I12 · API publik dan FHIR server baca-saja: klien terdaftar, cakupan, kunci dengan rotasi, penangguhan, log
 * akses. Mode presentasi: data dummy fiktif (ADR-0023).
 */
export default async function ApiPublikPage() {
  const { session, screen, allowed } = await requireDemoScreen('api-publik');
  if (!allowed) return <DemoAccessDenied screen={screen} />;
  const data = await getApiClients();
  return (
    <div className="flex flex-col gap-4">
      <header className="flex flex-col gap-0.5">
        <span className="text-caption text-ink-500">
          Sistem / Integrasi / API publik · I12 · {session.tenant.name} · data per{' '}
          {formatTanggalWaktu(data.asOf)}
        </span>
        <h1 className="m-0 text-h1 font-bold tracking-[-0.02em]">API publik & FHIR · klien mitra</h1>
      </header>
      <IntegrasiSubnav current="/sistem/integrasi/api-publik" />
      <ScenarioBanner session={session} screen="api-publik" />
      <ApiPublicView rev={data.rev} clients={data.clients} log={data.log} today={data.today} />
    </div>
  );
}
