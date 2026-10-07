import type { Metadata } from 'next';
import { ScreenAccessDenied } from '@/components/screen-gate';
import { requireScreen } from '@/lib/server/screen-guard';
import { ApiIgd } from './api-igd';
import { DemoIgd } from './demo-igd';

export const metadata: Metadata = { title: 'IGD' };

type SearchParams = Promise<Record<string, string | string[] | undefined>>;

/**
 * K03 · IGD: papan pelacakan + triase 5 level (mockup `IGD.dc.html`). Layar hibrida (`requireScreen`): mode presentasi
 * memakai data fiktif (`demo-igd.tsx`, dibekukan); mode api (layar W3, `api-igd.tsx`) untuk peran ber-izin
 * `clinical.read` (termasuk petugas pendaftaran IGD). `?pilih=<id>` = pasien yang dibuka di panel triase.
 */
export default async function IgdPage({ searchParams }: { searchParams: SearchParams }) {
  const access = await requireScreen('igd');
  if (access.mode === 'demo') {
    const sp = await searchParams;
    return <DemoIgd access={access} pilih={typeof sp.pilih === 'string' ? sp.pilih : null} />;
  }
  if (!access.allowed) return <ScreenAccessDenied screen={access.screen} />;
  const sp = await searchParams;
  return <ApiIgd session={access.session} pilih={typeof sp.pilih === 'string' ? sp.pilih : null} />;
}
