import { formatJam } from '@simrs/shared';
import { KpiCard } from '@simrs/ui';
import type { Metadata } from 'next';
import { DemoAccessDenied } from '@/components/demo-access-denied';
import { ScenarioBanner } from '@/components/scenario-banner';
import { DEMO_TODAY } from '@/lib/demo/fixtures/waktu';
import { formatNumber, formatRupiahShort } from '@/lib/manajemen';
import { getGoodsReceiptLines } from '@/lib/server/data/backoffice';
import { getLogisticsOverview } from '@/lib/server/data/manajemen';
import { requireDemoScreen } from '@/lib/server/demo-guard';
import { LogisticsBoard } from './logistics-board';

export const metadata: Metadata = { title: 'Logistik' };

const num = (v: number) => new Intl.NumberFormat('id-ID', { maximumFractionDigits: 1 }).format(v);
const tanggal = (iso: string) => {
  const [, m = 1, d = 1] = iso.split('-').map(Number);
  return `${d} ${['Jan', 'Feb', 'Mar', 'Apr', 'Mei', 'Jun', 'Jul', 'Agu', 'Sep', 'Okt', 'Nov', 'Des'][m - 1]}`;
};

/** B01 · Logistik farmasi dan BHP (mockup `Logistik.dc.html`). Mode presentasi: data dummy fiktif (ADR-0023). */
export default async function LogistikPage() {
  const { session, screen, allowed } = await requireDemoScreen('logistik');
  if (!allowed) return <DemoAccessDenied screen={screen} />;
  const d = await getLogisticsOverview();
  const receipt = await getGoodsReceiptLines();
  const k = d.kpi;

  return (
    <div className="@container flex flex-col gap-4">
      <LogisticsBoard
        heading={
          <div className="flex flex-col gap-0.5">
            <span className="text-caption text-ink-500">
              Manajemen / Logistik / Gudang farmasi dan BHP · data per {formatJam(d.asOf)}
            </span>
            <h1 className="m-0 text-h1 font-semibold">Rantai pasok · stok dan pengadaan</h1>
          </div>
        }
        banner={<ScenarioBanner session={session} screen="logistik" />}
        data={d}
        today={DEMO_TODAY}
        canApprove={session.role?.code === 'manajemen'}
        receiptLines={receipt.lines}
        suppliers={receipt.suppliers}
        openPo={receipt.openPo}
        kpis={
          <div
            role="region"
            aria-label="Indikator logistik"
            className="grid grid-cols-2 gap-3.5 @xl:grid-cols-3 @5xl:grid-cols-5"
          >
            <KpiCard
              label="Nilai persediaan"
              value={formatRupiahShort(BigInt(k.inventoryValue))}
              detail={`${formatNumber(k.activeSku)} SKU aktif`}
            />
            <KpiCard
              label="Perputaran"
              value={`${num(k.turnoverPerYear)}×/thn`}
              hint={k.turnoverPerYear >= k.turnoverTarget ? 'memenuhi target' : 'di bawah target'}
              detail={`target ≥ ${num(k.turnoverTarget)}`}
              tone={k.turnoverPerYear >= k.turnoverTarget ? 'success' : 'danger'}
              tinted
            />
            <KpiCard
              label="Stockout bulan ini"
              value={`${k.stockoutsThisMonth} item`}
              hint={`${k.stockoutsVital} item VEN-V`}
              detail="sasaran 0 item vital"
              tone={k.stockoutsVital > 0 ? 'danger' : 'success'}
              tinted
            />
            <KpiCard
              label="Akurasi opname"
              value={`${num(k.opnameAccuracy)}%`}
              hint="sasaran ≥ 98%"
              detail={`opname ${tanggal(k.opnameDate)}`}
              tone={k.opnameAccuracy >= 98 ? 'success' : 'warning'}
              tinted
            />
            <KpiCard
              label="Lead time rata-rata"
              value={`${num(k.leadTimeDays)} hari`}
              detail={`e-katalog ${num(k.leadTimeEkatalogDays)} hari`}
            />
          </div>
        }
      />
    </div>
  );
}
