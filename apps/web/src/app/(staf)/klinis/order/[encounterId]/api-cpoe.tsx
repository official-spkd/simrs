import { Alert } from '@simrs/ui';
import Link from 'next/link';
import { EncounterBanner } from '@/components/klinis/encounter-banner';
import { CpoeApiWorkspace } from '@/components/klinis/cpoe-api-workspace';
import { ApiError } from '@/lib/server/api-core';
import {
  getEncounterContextApi,
  getEncounterOrdersApi,
  getOrderSetsApi,
} from '@/lib/server/data/klinis/cpoe';
import { can, type SessionView } from '@/lib/session-view';

/**
 * K09 · CPOE mode api (layar W2): banner kunjungan, order set RS, dan kiriman order kunjungan dari API. Katalog,
 * pratinjau CDS, kirim, batal, dan tinjauan DPJP lewat Server Action `actions.ts`. Izin + ABAC ditegakkan API; tombol
 * hanya tampil bagi peran yang memegang izinnya.
 */
export async function ApiCpoe({ session, encounterId }: { session: SessionView; encounterId: string }) {
  let data;
  try {
    data = await Promise.all([
      getEncounterContextApi(encounterId),
      getOrderSetsApi(),
      getEncounterOrdersApi(encounterId),
    ]);
  } catch (err) {
    if (err instanceof ApiError && (err.status === 403 || err.status === 404)) {
      return (
        <div className="flex max-w-3xl flex-col gap-4">
          <h1 className="m-0 text-h1 font-bold tracking-[-0.02em]">Order &amp; resep (CPOE)</h1>
          <Alert level="warning" title={err.status === 404 ? 'Kunjungan tidak ditemukan' : 'Akses ditolak'}>
            {err.status === 404
              ? 'Periksa tautan kunjungan, lalu buka CPOE dari daftar kunjungan.'
              : err.message}
          </Alert>
          <Link
            href="/klinis/order"
            className="inline-flex min-h-11 w-fit items-center rounded-control border border-line-strong bg-white/90 px-3.5 text-small font-semibold text-ink-900 no-underline hover:bg-brand-50/60"
          >
            Kembali ke daftar kunjungan
          </Link>
        </div>
      );
    }
    throw err;
  }
  const [ctx, orderSets, groups] = data;
  return (
    <div className="flex flex-col gap-4">
      <header className="flex flex-col gap-0.5">
        <span className="text-caption text-ink-500">
          Klinis / {ctx.encounter.unit.name} / Order · {session.tenant.name}
        </span>
        <h1 className="m-0 text-h1 font-bold tracking-[-0.02em]">Order &amp; resep (CPOE)</h1>
      </header>
      <EncounterBanner ctx={ctx} />
      <CpoeApiWorkspace
        encounterId={encounterId}
        orderSets={orderSets}
        groups={groups}
        canWrite={can(session, 'order', 'write')}
        canCancel={can(session, 'order', 'cancel')}
        canReview={can(session, 'clinical', 'sign')}
        active={ctx.encounter.status === 'arrived' || ctx.encounter.status === 'in_progress'}
      />
    </div>
  );
}
