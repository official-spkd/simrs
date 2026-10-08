import type { Metadata } from 'next';
import { ScreenAccessDenied } from '@/components/screen-gate';
import { requireScreen } from '@/lib/server/screen-guard';
import { ApiLab } from './api-lab';
import { DemoLab } from './demo-lab';

export const metadata: Metadata = { title: 'Laboratorium' };

type SearchParams = Promise<Record<string, string | string[] | undefined>>;

/**
 * S01/S09 · Layar hibrida Laboratorium (rencana fase 4 potongan 4.0c, pola 3.0d klinis): mode presentasi memakai data dummy
 * (`demo-lab.tsx` + `actions-demo.ts`, dibekukan); mode api (potongan 4.2, `api-lab.tsx` + `actions.ts`) untuk peran
 * ber-izin `lab.worklist.read`. `?view=aktif|selesai`, `?order=<id order lab>`, `?kiriman=<id kiriman CPOE baru>`.
 */
export default async function LabPage({ searchParams }: { searchParams: SearchParams }) {
  const access = await requireScreen('lab');
  if (access.mode === 'demo') return <DemoLab access={access} searchParams={searchParams} />;
  if (!access.allowed) return <ScreenAccessDenied screen={access.screen} />;
  const sp = await searchParams;
  const one = (v: string | string[] | undefined) => (typeof v === 'string' && v ? v : null);
  return (
    <ApiLab
      session={access.session}
      view={sp.view === 'selesai' ? 'selesai' : 'aktif'}
      order={one(sp.order)}
      kiriman={one(sp.kiriman)}
    />
  );
}
