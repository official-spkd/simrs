import { formatJam } from '@simrs/shared';
import { KpiCard } from '@simrs/ui';
import type { Metadata } from 'next';
import { PageHead } from '@/components/backoffice/kit';
import { DemoAccessDenied } from '@/components/demo-access-denied';
import { PpiBoard } from '@/components/ppi/ppi-board';
import { DEMO_NOW } from '@/lib/demo/fixtures/waktu';
import { formatRate, HAI_DEFS, haiOnTarget, haiRate, hhCompliance } from '@/lib/ppi';
import { getPpi } from '@/lib/server/data/backoffice';
import { requireDemoScreen } from '@/lib/server/demo-guard';

export const metadata: Metadata = { title: 'PPI' };

/**
 * B07 · Pencegahan dan pengendalian infeksi (rencana fase 8 §8.5, tanpa mockup): surveilans HAIs, kebersihan
 * tangan (INM-01), bundle, isolasi. Mode presentasi: data dummy fiktif (ADR-0023).
 */
export default async function PpiPage() {
  const { screen, allowed } = await requireDemoScreen('ppi');
  if (!allowed) return <DemoAccessDenied screen={screen} />;
  const d = await getPpi();
  const over = HAI_DEFS.filter(
    (h) => !haiOnTarget(haiRate(d.month[h.id].cases, d.month[h.id].denominator, h.per), h.target),
  );
  const hh = hhCompliance(d.handHygiene);
  const ppe = hhCompliance(d.ppe.map((a) => ({ action: a.compliant ? 'handrub' : 'tidak' })));
  const free = d.rooms.filter((r) => !r.occupiedBy).length;

  return (
    <div className="flex flex-col gap-4">
      <PageHead
        crumb={`Back office / Pencegahan dan pengendalian infeksi · B07 · data per ${formatJam(DEMO_NOW)}`}
        title="Pencegahan dan pengendalian infeksi"
      />
      <div role="region" aria-label="Ringkasan PPI" className="grid grid-cols-2 gap-3.5 xl:grid-cols-4">
        <KpiCard
          label="Laju HAIs di atas sasaran"
          value={`${over.length} dari ${HAI_DEFS.length}`}
          hint={
            over
              .map(
                (h) =>
                  `${h.short} ${formatRate(haiRate(d.month[h.id].cases, d.month[h.id].denominator, h.per), h.unit)}`,
              )
              .join(' · ') || 'semua sesuai sasaran'
          }
          detail={`${d.suspects.length} kasus suspek menunggu verifikasi`}
          tone={over.length ? 'danger' : 'success'}
          tinted
        />
        <KpiCard
          label="Kebersihan tangan (INM-01)"
          value={`${hh.pct}%`}
          hint={(hh.pct ?? 0) >= 85 ? 'memenuhi sasaran ≥ 85%' : 'di bawah sasaran ≥ 85%'}
          detail={`${hh.done}/${hh.total} peluang bulan ini`}
          tone={(hh.pct ?? 0) >= 85 ? 'success' : 'danger'}
          tinted
        />
        <KpiCard
          label="Kepatuhan APD (INM-02)"
          value={`${ppe.pct}%`}
          hint="sasaran 100%"
          detail={`${ppe.done}/${ppe.total} pengamatan`}
          tone={(ppe.pct ?? 0) >= 100 ? 'success' : 'warning'}
          tinted
        />
        <KpiCard
          label="Ruang isolasi kosong"
          value={`${free} dari ${d.rooms.length}`}
          hint={`${d.isolationRequests.length} permintaan menunggu`}
          detail={`${d.rooms.filter((r) => r.negativePressure).length} ruang bertekanan negatif`}
          tone={d.isolationRequests.length > free ? 'danger' : 'warning'}
          tinted
        />
      </div>
      <PpiBoard data={d} />
    </div>
  );
}
