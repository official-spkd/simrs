import type { Metadata } from 'next';
import { z } from 'zod';
import { ScreenAccessDenied } from '@/components/screen-gate';
import { requireScreen } from '@/lib/server/screen-guard';
import { ApiKonsultasi } from './api-konsultasi';
import { DemoKonsultasi } from './demo-konsultasi';

export const metadata: Metadata = { title: 'Konsultasi & rawat bersama' };

type SearchParams = Promise<Record<string, string | string[] | undefined>>;

/**
 * K10 · Konsultasi antar-DPJP dan rawat bersama. Layar hibrida (`requireScreen`): mode presentasi memakai rekam fiktif
 * + toko demo `rekam-medis` (`demo-konsultasi.tsx`, `?pasien=`); mode api untuk peran ber-izin `clinical.write`
 * (`api-konsultasi.tsx`, fase 3 · 3.8): kotak masuk konsultan, dan dengan `?kunjungan=<id>` konsul + tim perawatan
 * kunjungan itu.
 */
export default async function KonsultasiPage({ searchParams }: { searchParams: SearchParams }) {
  const access = await requireScreen('konsul');
  const sp = await searchParams;
  if (access.mode === 'demo') return <DemoKonsultasi access={access} pasien={sp.pasien} />;
  if (!access.allowed) return <ScreenAccessDenied screen={access.screen} />;
  const kunjungan = z.uuid().safeParse(sp.kunjungan);
  return <ApiKonsultasi session={access.session} encounterId={kunjungan.success ? kunjungan.data : null} />;
}
