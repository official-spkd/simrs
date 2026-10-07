import { CARE_SETTINGS, type CareSetting } from '@simrs/shared';
import type { Metadata } from 'next';
import { ScreenAccessDenied } from '@/components/screen-gate';
import { requireScreen } from '@/lib/server/screen-guard';
import { ApiPaket } from './api-paket';
import { DemoPaket } from './demo-paket';

export const metadata: Metadata = { title: 'Paket layanan khusus' };

type SearchParams = Promise<Record<string, string | string[] | undefined>>;

/**
 * K15 · Paket layanan. Layar hibrida (`requireScreen`): mode presentasi = paket layanan khusus fiktif (hemodialisis,
 * kemoterapi, antenatal; `demo-paket.tsx`, `?pasien=`); mode api untuk peran ber-izin `forms.definition.read`
 * (`api-paket.tsx`, fase 3 · 3.8): paket formulir per setting (`?setting=`), dikelola `forms.definition.write`.
 */
export default async function PaketPage({ searchParams }: { searchParams: SearchParams }) {
  const access = await requireScreen('paket');
  const sp = await searchParams;
  if (access.mode === 'demo') return <DemoPaket access={access} pasien={sp.pasien} />;
  if (!access.allowed) return <ScreenAccessDenied screen={access.screen} />;
  const setting = CARE_SETTINGS.find((x) => x === sp.setting) ?? ('rawat_inap' satisfies CareSetting);
  return <ApiPaket session={access.session} setting={setting} />;
}
