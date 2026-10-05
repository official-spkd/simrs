import type { Metadata } from 'next';
import { z } from 'zod';
import { ScreenAccessDenied } from '@/components/screen-gate';
import { requireScreen } from '@/lib/server/screen-guard';
import { ApiPendaftaran } from './api-pendaftaran';
import { DemoPendaftaran } from './demo-pendaftaran';

export const metadata: Metadata = { title: 'Pendaftaran' };

type SearchParams = Promise<Record<string, string | string[] | undefined>>;

/**
 * F03/F06 · Pendaftaran rawat jalan + SEP (mockup `Registrasi.dc.html`). Layar hibrida (`requireScreen`): mode
 * presentasi memakai data dummy (`demo-pendaftaran.tsx`, dibekukan); mode api untuk peran ber-izin `encounter.write`
 * (`api-pendaftaran.tsx`, fase 2 potongan 5b). `?kunjungan=<id>` = hasil pendaftaran (status SEP dan task 1–3).
 */
export default async function PendaftaranPage({ searchParams }: { searchParams: SearchParams }) {
  const access = await requireScreen('daftar');
  if (access.mode === 'demo') return <DemoPendaftaran access={access} />;
  if (!access.allowed) return <ScreenAccessDenied screen={access.screen} />;
  const sp = await searchParams;
  const kunjungan = z.uuid().safeParse(sp.kunjungan);
  return <ApiPendaftaran session={access.session} encounterId={kunjungan.success ? kunjungan.data : null} />;
}
