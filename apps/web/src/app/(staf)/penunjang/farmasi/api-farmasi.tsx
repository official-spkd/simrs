import type { DispenseView, PharmacyPrescriptionView, StockBalance } from '@simrs/shared';
import { Alert } from '@simrs/ui';
import { FarmasiApiWorkspace } from '@/components/penunjang/farmasi-api-workspace';
import { ApiError } from '@/lib/server/api-core';
import { getStockBalancesApi } from '@/lib/server/data/penunjang/depo';
import {
  getDispensesApi,
  getPharmacyIncomingApi,
  getPharmacyPrescriptionApi,
  getPharmacyQueueApi,
} from '@/lib/server/data/penunjang/farmasi';
import { can, type SessionView } from '@/lib/session-view';

/** Resep yang dibuka bila `?resep` kosong: urutan kerja apoteker. */
const OPEN_ORDER = ['telaah', 'ditahan', 'penyiapan', 'serah'] as const;

/**
 * S04/S05 · Farmasi mode api: kiriman CPOE masuk ke depo unit, antrean resep, telaah klinis (temuan CDS saat telaah,
 * intervensi ke dokter penulis, telaah tiga aspek) dari `/api/v1/pharmacy/*` (potongan 4.5), lalu penyiapan FEFO, cek
 * ganda, serah terima, dan retur dari `/api/v1/dispensing/*` (4.6b). Kolom stok depo dari API stok
 * (`/api/v1/stock/balances`, batch layak saja). `?resep=<id>` = resep yang dibuka.
 */
export async function ApiFarmasi({ session, resep }: { session: SessionView; resep: string | null }) {
  let data;
  try {
    const [incoming, queue] = await Promise.all([getPharmacyIncomingApi(), getPharmacyQueueApi()]);
    const pick =
      queue.find((r) => r.id === resep) ??
      OPEN_ORDER.map((s) => queue.find((r) => r.status === s)).find(Boolean) ??
      null;
    let detail: PharmacyPrescriptionView | null = null;
    let balances: StockBalance[] | null = null;
    let dispenses: DispenseView[] = [];
    if (pick) {
      [detail, dispenses] = await Promise.all([
        getPharmacyPrescriptionApi(pick.id),
        getDispensesApi(pick.id),
      ]);
      balances = can(session, 'stock', 'read') ? await getStockBalancesApi(detail.stockLocation.id) : null;
    }
    data = { incoming, queue, detail, balances, dispenses };
  } catch (err) {
    if (err instanceof ApiError && err.status === 403) {
      return (
        <div className="flex max-w-3xl flex-col gap-4">
          <h1 className="m-0 text-h1 font-bold tracking-[-0.02em]">Farmasi</h1>
          <Alert level="warning" title="Akses ditolak">
            {err.message}
          </Alert>
        </div>
      );
    }
    throw err;
  }

  return (
    <div className="flex flex-col gap-4">
      <header className="flex flex-col gap-0.5">
        <span className="text-caption text-ink-500">
          Penunjang / Farmasi / Telaah resep · S04 · {session.tenant.name}
        </span>
        <h1 className="m-0 text-h1 font-bold tracking-[-0.02em]">Farmasi</h1>
      </header>
      <FarmasiApiWorkspace
        key={data.detail?.id ?? 'kosong'}
        incoming={data.incoming}
        queue={data.queue}
        detail={data.detail}
        balances={data.balances}
        dispenses={data.dispenses}
        canWrite={can(session, 'pharmacy.review', 'write')}
        dispense={{
          prepare: can(session, 'pharmacy.dispense', 'prepare'),
          doubleCheck: can(session, 'pharmacy.dispense', 'double_check'),
          handover: can(session, 'pharmacy.dispense', 'handover'),
          return: can(session, 'pharmacy.dispense', 'return'),
        }}
      />
    </div>
  );
}
