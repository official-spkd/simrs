import { formatJam, formatTanggal } from '@simrs/shared';
import { KpiCard } from '@simrs/ui';
import type { Metadata } from 'next';
import { AssetBoard } from '@/components/aset/asset-board';
import { PageHead } from '@/components/backoffice/kit';
import { DemoAccessDenied } from '@/components/demo-access-denied';
import { DEMO_NOW, DEMO_TODAY, shiftDate } from '@/lib/demo/fixtures/waktu';
import { bookValue, calibrationStatus, responseWithinSla } from '@/lib/aset';
import { formatRupiahShort } from '@/lib/manajemen';
import { getAssets } from '@/lib/server/data/backoffice';
import { requireDemoScreen } from '@/lib/server/demo-guard';

export const metadata: Metadata = { title: 'Aset & pemeliharaan' };

/**
 * B02 · Aset dan pemeliharaan (rencana fase 8 §8.3, tanpa mockup): register + nilai buku, kalibrasi alat medis,
 * tiket perbaikan ber-SLA. Mode presentasi: data dummy fiktif (ADR-0023).
 */
export default async function AsetPage() {
  const { screen, allowed } = await requireDemoScreen('aset');
  if (!allowed) return <DemoAccessDenied screen={screen} />;
  const d = await getAssets();
  const book = d.assets.reduce(
    (n, a) => n + bookValue(BigInt(a.cost), a.acquired, a.lifeYears, DEMO_TODAY),
    0n,
  );
  const st = d.assets.map((a) => calibrationStatus(a.nextCalibration, DEMO_TODAY).status);
  const overdue = st.filter((s) => s === 'lewat').length;
  const soon = st.filter((s) => s === 'segera').length;
  const pm = d.assets.filter((a) => a.nextMaintenance <= shiftDate(DEMO_TODAY, 6)).length;
  const late = d.tickets.filter(
    (t) => !responseWithinSla(t.reportedAt, t.respondedAt, DEMO_NOW, t.impact),
  ).length;

  return (
    <div className="flex flex-col gap-4">
      <PageHead
        crumb={`Back office / Aset dan pemeliharaan · B02 · data per ${formatJam(DEMO_NOW)}`}
        title="Aset dan pemeliharaan"
      />
      <div role="region" aria-label="Ringkasan aset" className="grid grid-cols-2 gap-3.5 xl:grid-cols-4">
        <KpiCard
          label="Nilai buku aset"
          value={formatRupiahShort(book)}
          detail={`${d.assets.length} aset tercatat · garis lurus`}
        />
        <KpiCard
          label="Kalibrasi lewat jatuh tempo"
          value={String(overdue)}
          hint={overdue ? 'tidak laik pakai sampai dikalibrasi' : 'tidak ada'}
          detail={`${soon} jatuh tempo ≤ 30 hari`}
          tone={overdue ? 'danger' : 'success'}
          tinted
        />
        <KpiCard
          label="Pemeliharaan preventif minggu ini"
          value={String(pm)}
          detail={`jadwal s.d. ${formatTanggal(shiftDate(DEMO_TODAY, 6))}`}
        />
        <KpiCard
          label="Tiket perbaikan terbuka"
          value={String(d.tickets.length)}
          hint={late ? `${late} respons lewat SLA` : 'semua respons dalam SLA'}
          detail="SLA respons kritis 2 jam"
          tone={late ? 'danger' : 'success'}
          tinted
        />
      </div>
      <AssetBoard data={d} today={DEMO_TODAY} now={DEMO_NOW} />
    </div>
  );
}
