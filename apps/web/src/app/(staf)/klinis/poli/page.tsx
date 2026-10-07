import type { Metadata } from 'next';
import { ScreenAccessDenied } from '@/components/screen-gate';
import { requireScreen } from '@/lib/server/screen-guard';
import { ApiPoli } from './api-poli';
import { DemoPoli } from './demo-poli';

export const metadata: Metadata = { title: 'Pemeriksaan poli' };

type SearchParams = Promise<Record<string, string | string[] | undefined>>;

/**
 * K01/K02 · Pemeriksaan poli + CPPT/SOAP (mockup `Main.dc.html`). Layar hibrida (`requireScreen`): mode presentasi
 * memakai data dummy (`demo-poli.tsx`, dibekukan); mode api (W1) untuk peran ber-izin `clinical.write` lewat API
 * (`api-poli.tsx`). `?pasien=<id>` = pasien yang dibuka di antrean hari ini; `?poli=<layanan>` = satu poli/sesi
 * (tanpa itu: gabungan poli unit + pasien yang DPJP-nya saya).
 */
export default async function PoliPage({ searchParams }: { searchParams: SearchParams }) {
  const access = await requireScreen('poli');
  const sp = await searchParams;
  const pasien = typeof sp.pasien === 'string' ? sp.pasien : null;
  if (access.mode === 'demo') return <DemoPoli access={access} pasien={pasien} />;
  if (!access.allowed) return <ScreenAccessDenied screen={access.screen} />;
  const poli = typeof sp.poli === 'string' && /^[0-9a-f-]{36}$/.test(sp.poli) ? sp.poli : null;
  return <ApiPoli session={access.session} pasien={pasien} poli={poli} />;
}
