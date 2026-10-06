import type { Metadata } from 'next';
import { DemoAccessDenied } from '@/components/demo-access-denied';
import { ScreenHeader } from '@/components/platform/parts';
import { TerminologiBoard } from '@/components/platform/terminologi-board';
import { getTerminologyOverview } from '@/lib/server/data/platform';
import { requireDemoScreen } from '@/lib/server/demo-guard';

export const metadata: Metadata = { title: 'Data rujukan' };

/**
 * P06 · Data rujukan dan terminologi (tanpa mockup). Mode presentasi: kode contoh seed, data fiktif (ADR-0023); impor
 * yang lolos uji kering tersimpan di toko demo bersama (domain `terminologi`, ADR-0085).
 */
export default async function TerminologiPage() {
  const { screen, allowed } = await requireDemoScreen('terminologi');
  if (!allowed) return <DemoAccessDenied screen={screen} />;
  const d = await getTerminologyOverview();
  return (
    <div className="flex flex-col gap-4">
      <ScreenHeader
        trail="Sistem / Data rujukan · P06 · ICD-10, ICD-9-CM, LOINC, KFA"
        title="Data rujukan · kode baku dan impor versi"
      />
      <TerminologiBoard state={d.store.state} rev={d.store.rev} files={d.files} />
    </div>
  );
}
