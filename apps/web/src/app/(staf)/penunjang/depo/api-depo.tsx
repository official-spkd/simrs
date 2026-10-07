import { isoDateJakarta, type SupplierView } from '@simrs/shared';
import { Alert } from '@simrs/ui';
import Link from 'next/link';
import { DepoApiWorkspace } from '@/components/penunjang/depo-api-workspace';
import { ApiError } from '@/lib/server/api-core';
import {
  getStockBalancesApi,
  getStockLocationsApi,
  getStockMovementsApi,
  getStockTransfersApi,
  getSuppliersApi,
} from '@/lib/server/data/penunjang/depo';
import { can, type SessionView } from '@/lib/session-view';

/**
 * S05 · Depo dan stok farmasi mode api (potongan 4.6a): pilih depo/gudang dalam lingkup unit, saldo per batch dengan ED
 * (FEFO), penerimaan tanpa PO, mutasi dua langkah, penyesuaian beralasan, dan kartu stok, semuanya dari
 * `/api/v1/stock/*`. Pengeluaran ke pasien (dispensing) menyusul potongan 4.6b.
 */
export async function ApiDepo({ session, depo }: { session: SessionView; depo: string | null }) {
  let data;
  try {
    const [locations, destinations] = await Promise.all([
      getStockLocationsApi(),
      // Tujuan mutasi: semua depo aktif RS (hanya nama).
      can(session, 'stock', 'transfer') ? getStockLocationsApi('destination') : Promise.resolve([]),
    ]);
    const current = locations.find((l) => l.id === depo) ?? locations[0] ?? null;
    if (!current) {
      data = { locations, destinations, current: null } as const;
    } else {
      const [balances, movements, transfers, suppliers] = await Promise.all([
        getStockBalancesApi(current.id),
        getStockMovementsApi(current.id),
        getStockTransfersApi(),
        can(session, 'stock', 'receive') ? getSuppliersApi() : Promise.resolve([] as SupplierView[]),
      ]);
      data = { locations, destinations, current, balances, movements, transfers, suppliers } as const;
    }
  } catch (err) {
    if (err instanceof ApiError && err.status === 403) {
      return (
        <div className="flex max-w-3xl flex-col gap-4">
          <h1 className="m-0 text-h1 font-bold tracking-[-0.02em]">Depo &amp; stok farmasi</h1>
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
      <header className="flex flex-wrap items-center justify-between gap-3">
        <div className="flex flex-col gap-0.5">
          <span className="text-caption text-ink-500">
            Penunjang / Farmasi / Depo dan stok · S05 · {session.tenant.name}
          </span>
          <h1 className="m-0 text-h1 font-bold tracking-[-0.02em]">Depo &amp; stok farmasi</h1>
        </div>
      </header>
      {data.current ? (
        <>
          <nav aria-label="Pilih depo" className="flex flex-wrap gap-2">
            {data.locations.map((l) => (
              <Link
                key={l.id}
                href={`/penunjang/depo?depo=${l.id}`}
                aria-current={l.id === data.current.id ? 'page' : undefined}
                className={
                  l.id === data.current.id
                    ? 'inline-flex h-11 items-center rounded-full border border-transparent bg-nav-active px-3.5 text-small font-semibold text-white no-underline'
                    : 'inline-flex h-11 items-center rounded-full border border-line-strong bg-white/90 px-3.5 text-small text-ink-900 no-underline hover:bg-brand-50/60'
                }
              >
                {l.name}
              </Link>
            ))}
          </nav>
          <DepoApiWorkspace
            key={data.current.id}
            location={data.current}
            destinations={data.destinations.filter((d) => d.id !== data.current.id)}
            balances={data.balances}
            movements={data.movements}
            transfers={data.transfers}
            suppliers={data.suppliers}
            today={isoDateJakarta()}
            can={{
              receive: can(session, 'stock', 'receive'),
              transfer: can(session, 'stock', 'transfer'),
              adjust: can(session, 'stock', 'adjust'),
            }}
          />
        </>
      ) : (
        <Alert level="info" title="Belum ada depo">
          Tidak ada depo atau gudang di unit penugasan Anda. Masuk dengan posisi di unit farmasi untuk
          mengelola stok.
        </Alert>
      )}
    </div>
  );
}
