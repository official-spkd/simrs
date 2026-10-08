import type { PharmacyPrescriptionView, StockBalance } from '@simrs/shared';
import { Alert } from '@simrs/ui';
import { FarmasiApiWorkspace } from '@/components/penunjang/farmasi-api-workspace';
import { ApiError } from '@/lib/server/api-core';
import { getStockBalancesApi } from '@/lib/server/data/penunjang/depo';
import {
  getPharmacyIncomingApi,
  getPharmacyPrescriptionApi,
  getPharmacyQueueApi,
} from '@/lib/server/data/penunjang/farmasi';
import { can, type SessionView } from '@/lib/session-view';

/**
 * S04 · Farmasi mode api (potongan 4.5): kiriman CPOE masuk ke depo unit, antrean resep, dan telaah klinis (temuan CDS
 * saat telaah, intervensi ke dokter penulis, telaah tiga aspek) dari `/api/v1/pharmacy/*`. Kolom stok depo dari API
 * stok (`/api/v1/stock/balances`, batch layak saja). Penyiapan dan serah terima menyusul 4.6b. `?resep=<id>` = resep
 * yang dibuka.
 */
export async function ApiFarmasi({ session, resep }: { session: SessionView; resep: string | null }) {
  let data;
  try {
    const [incoming, queue] = await Promise.all([getPharmacyIncomingApi(), getPharmacyQueueApi()]);
    const pick =
      queue.find((r) => r.id === resep) ??
      queue.find((r) => r.status === 'telaah' || r.status === 'ditahan') ??
      null;
    let detail: PharmacyPrescriptionView | null = null;
    let balances: StockBalance[] | null = null;
    if (pick) {
      detail = await getPharmacyPrescriptionApi(pick.id);
      balances = can(session, 'stock', 'read') ? await getStockBalancesApi(detail.stockLocation.id) : null;
    }
    data = { incoming, queue, detail, balances };
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
        canWrite={can(session, 'pharmacy.review', 'write')}
      />
    </div>
  );
}
