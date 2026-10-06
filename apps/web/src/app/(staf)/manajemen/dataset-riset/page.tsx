import { formatJam } from '@simrs/shared';
import { KpiCard } from '@simrs/ui';
import type { Metadata } from 'next';
import { PageHead } from '@/components/backoffice/kit';
import { DatasetBoard } from '@/components/dataset-riset/dataset-board';
import { DemoAccessDenied } from '@/components/demo-access-denied';
import { K_MIN } from '@/lib/dataset-riset';
import { DEMO_NOW, DEMO_TODAY } from '@/lib/demo/fixtures/waktu';
import { getResearchDataset } from '@/lib/server/data/backoffice';
import { requireDemoScreen } from '@/lib/server/demo-guard';

export const metadata: Metadata = { title: 'Dataset riset' };

/**
 * I11 · Dataset riset ter-de-identifikasi (tanpa mockup): etik → de-identifikasi + k-anonimitas → persetujuan
 * privasi → ekstrak berbatas waktu + jejak akses. Mode presentasi: kohort sintetis (ADR-0023).
 */
export default async function DatasetRisetPage() {
  const { screen, allowed } = await requireDemoScreen('dataset-riset');
  if (!allowed) return <DemoAccessDenied screen={screen} />;
  const d = await getResearchDataset();
  const ids = d.fields.filter((f) => f.kind === 'pengenal').length;

  return (
    <div className="flex flex-col gap-4">
      <PageHead
        crumb={`Manajemen / Dataset riset · I11 · data per ${formatJam(DEMO_NOW)}`}
        title="Dataset riset ter-de-identifikasi"
      />
      <div
        role="region"
        aria-label="Ringkasan dataset riset"
        className="grid grid-cols-2 gap-3.5 xl:grid-cols-4"
      >
        <KpiCard label="Permintaan aktif" value="1" detail={d.request.number} />
        <KpiCard label="Ukuran kohort" value={String(d.rows.length)} detail={d.request.period} />
        <KpiCard
          label="Pengenal langsung diminta"
          value={String(ids)}
          hint="wajib dihapus atau disamarkan"
          detail="nama, RM, NIK, telepon"
          tone="warning"
          tinted
        />
        <KpiCard
          label="Ambang k-anonimitas"
          value={`k ≥ ${K_MIN}`}
          detail="pada umur, jenis kelamin, wilayah"
        />
      </div>
      <DatasetBoard
        request={d.request}
        fields={d.fields}
        rows={d.rows}
        approvers={d.approvers}
        log={d.log}
        today={DEMO_TODAY}
      />
    </div>
  );
}
