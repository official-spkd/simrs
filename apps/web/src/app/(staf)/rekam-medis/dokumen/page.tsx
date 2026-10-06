import type { Metadata } from 'next';
import { DemoAccessDenied } from '@/components/demo-access-denied';
import { DokumenBoard } from '@/components/platform/dokumen-board';
import { ScreenHeader } from '@/components/platform/parts';
import { getDocumentsOverview } from '@/lib/server/data/platform';
import { requireDemoScreen } from '@/lib/server/demo-guard';

export const metadata: Metadata = { title: 'Dokumen & TTE' };

/** P08 · Dokumen pasien dan tanda tangan elektronik (tanpa mockup). Mode presentasi: data fiktif (ADR-0023). */
export default async function DokumenPage() {
  const { session, screen, allowed } = await requireDemoScreen('dokumen');
  if (!allowed) return <DemoAccessDenied screen={screen} />;
  const d = await getDocumentsOverview();
  return (
    <div className="flex flex-col gap-4">
      <ScreenHeader
        trail="Rekam medis / Dokumen & TTE · P08"
        title="Dokumen pasien dan tanda tangan elektronik"
      />
      <DokumenBoard patients={d.patients} initial={d.documents} tenantName={session.tenant.name} />
    </div>
  );
}
