import type { Metadata } from 'next';
import { ScreenAccessDenied } from '@/components/screen-gate';
import { requireScreen } from '@/lib/server/screen-guard';
import { ApiKamarOperasi } from './api-kamar-operasi';
import { DemoKamarOperasi } from './demo-kamar-operasi';

export const metadata: Metadata = { title: 'Kamar operasi' };

type SearchParams = Promise<Record<string, string | string[] | undefined>>;

/**
 * S06 · Layar hibrida Kamar operasi (rencana fase 4 potongan 4.0c, pola 3.0d klinis): mode presentasi memakai data dummy
 * (`demo-kamar-operasi.tsx` + `actions-demo.ts`, dibekukan); mode api (potongan 4.7, `api-kamar-operasi.tsx`) untuk
 * pemegang `surgery.read`. `?tanggal=YYYY-MM-DD` = hari papan, `?pilih=<id kasus>` = kasus terpilih.
 */
export default async function KamarOperasiPage({ searchParams }: { searchParams: SearchParams }) {
  const access = await requireScreen('ok');
  if (access.mode === 'demo') return <DemoKamarOperasi access={access} searchParams={searchParams} />;
  if (!access.allowed) return <ScreenAccessDenied screen={access.screen} />;
  const sp = await searchParams;
  return (
    <ApiKamarOperasi
      session={access.session}
      tanggal={typeof sp.tanggal === 'string' ? sp.tanggal : null}
      pilih={typeof sp.pilih === 'string' ? sp.pilih : null}
    />
  );
}
