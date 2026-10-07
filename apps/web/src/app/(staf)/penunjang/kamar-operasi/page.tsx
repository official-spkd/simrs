import type { Metadata } from 'next';
import { ScreenAccessDenied, ScreenNotConnected } from '@/components/screen-gate';
import { requireScreen } from '@/lib/server/screen-guard';
import { DemoKamarOperasi } from './demo-kamar-operasi';

export const metadata: Metadata = { title: 'Kamar operasi' };

type SearchParams = Promise<Record<string, string | string[] | undefined>>;

/**
 * S06 · Layar hibrida Kamar operasi (rencana fase 4 potongan 4.0c, pola 3.0d klinis): mode presentasi memakai data dummy
 * (`demo-kamar-operasi.tsx` + `actions-demo.ts`, dibekukan); mode api untuk peran yang memegang izin layar, jalur API diisi
 * potongan 4.7 (sampai itu "Belum tersambung").
 */
export default async function KamarOperasiPage({ searchParams }: { searchParams: SearchParams }) {
  const access = await requireScreen('ok');
  if (access.mode === 'demo') return <DemoKamarOperasi access={access} searchParams={searchParams} />;
  if (!access.allowed) return <ScreenAccessDenied screen={access.screen} />;
  return <ScreenNotConnected screen={access.screen} role={access.session.role?.code ?? null} />;
}
