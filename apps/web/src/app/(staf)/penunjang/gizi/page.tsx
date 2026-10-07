import type { Metadata } from 'next';
import { ScreenAccessDenied } from '@/components/screen-gate';
import { requireScreen } from '@/lib/server/screen-guard';
import { ApiGizi } from './api-gizi';
import { DemoGizi } from './demo-gizi';

export const metadata: Metadata = { title: 'Gizi' };

type SearchParams = Promise<Record<string, string | string[] | undefined>>;
const one = (v: string | string[] | undefined) => (typeof v === 'string' ? v : undefined);

/**
 * S07 · Layar hibrida Gizi (rencana fase 4 potongan 4.0c, pola 3.0d klinis): mode presentasi memakai data dummy
 * (`demo-gizi.tsx` + `actions-demo.ts`, dibekukan); mode api (potongan 4.9, ADR-0105) untuk peran ber-izin
 * `nutrition.read`: daftar makan per bangsal × jam makan, antar + sisa makanan, order diet per kunjungan.
 */
export default async function GiziPage({ searchParams }: { searchParams: SearchParams }) {
  const access = await requireScreen('gizi');
  if (access.mode === 'demo') return <DemoGizi access={access} />;
  if (!access.allowed) return <ScreenAccessDenied screen={access.screen} />;
  const sp = await searchParams;
  return (
    <ApiGizi
      session={access.session}
      query={{
        tanggal: one(sp.tanggal),
        jam: one(sp.jam),
        unit: one(sp.unit),
        kunjungan: one(sp.kunjungan),
        pilih: one(sp.pilih),
      }}
    />
  );
}
