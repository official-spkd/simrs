import { Alert } from '@simrs/ui';
import type { Metadata } from 'next';
import { notFound } from 'next/navigation';
import { z } from 'zod';
import { ScreenAccessDenied } from '@/components/screen-gate';
import { getQueueServices, getQueueTickets } from '@/lib/server/data/front-office/antrean';
import { requireScreen } from '@/lib/server/screen-guard';
import { can } from '@/lib/session-view';
import { KendaliClient } from './kendali-client';

export const metadata: Metadata = { title: 'Kendali antrean' };

type SearchParams = Promise<Record<string, string | string[] | undefined>>;

/**
 * F04 · Kendali antrean (fase 2 potongan 4b, keputusan #5; tanpa mockup): petugas loket/poli memilih layanan dan
 * loketnya, lalu memanggil berikutnya, memanggil ulang, melewati, memulai, dan menyelesaikan layanan. Panggilan
 * langsung tampil di TV (SSE). Hanya mode api (`queue.read`; tombol aksi untuk `queue.call`).
 */
export default async function KendaliAntreanPage({ searchParams }: { searchParams: SearchParams }) {
  const access = await requireScreen('kendali');
  if (access.mode === 'demo') notFound();
  if (!access.allowed) return <ScreenAccessDenied screen={access.screen} />;
  const services = (await getQueueServices()).filter((s) => s.active);
  if (services.length === 0) {
    return (
      <div className="flex max-w-3xl flex-col gap-4">
        <h1 className="m-0 text-h1 font-bold tracking-[-0.02em]">Kendali antrean</h1>
        <Alert level="info" title="Belum ada layanan antrean">
          Layanan antrean (loket, poli, farmasi, kasir) untuk unit Anda belum dibuat. Hubungi admin SIM RS.
        </Alert>
      </div>
    );
  }
  const sp = await searchParams;
  const wanted = z.uuid().safeParse(sp.layanan);
  // Bawaan: loket pendaftaran (layanan yang paling sering dipanggil dari halaman ini), lalu layanan pertama.
  const selected =
    services.find((s) => wanted.success && s.id === wanted.data) ??
    services.find((s) => s.kind === 'loket') ??
    services[0];
  if (!selected) notFound();
  const tickets = await getQueueTickets(selected.id);
  return (
    <KendaliClient
      key={selected.id}
      services={services}
      selected={selected}
      tickets={tickets}
      canCall={can(access.session, 'queue', 'call')}
    />
  );
}
