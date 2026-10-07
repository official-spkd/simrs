import type { Metadata } from 'next';
import { redirect } from 'next/navigation';
import { z } from 'zod';
import { ScreenAccessDenied } from '@/components/screen-gate';
import { requireScreen } from '@/lib/server/screen-guard';
import { ApiRawatInap } from './api-rawat-inap';
import { DemoRawatInap } from './demo-rawat-inap';

export const metadata: Metadata = { title: 'Rawat inap' };

type SearchParams = Promise<Record<string, string | string[] | undefined>>;

const uuid = z.uuid();

/**
 * K04 · Daftar pasien rawat inap. Layar hibrida (`requireScreen`): mode presentasi memakai data fiktif
 * (`demo-rawat-inap.tsx`, dibekukan; `?bangsal=<kode>` = filter ruang); mode api untuk peran ber-izin
 * `clinical.write` (`api-rawat-inap.tsx`, layar W4; `?unit=<id>` = filter unit). `?kunjungan=<id>` (tautan notifikasi
 * eskalasi EWS) membuka rekam pasien itu.
 */
export default async function RawatInapPage({ searchParams }: { searchParams: SearchParams }) {
  const access = await requireScreen('ranap');
  const sp = await searchParams;
  if (access.mode === 'demo') {
    return <DemoRawatInap access={access} bangsal={typeof sp.bangsal === 'string' ? sp.bangsal : null} />;
  }
  if (!access.allowed) return <ScreenAccessDenied screen={access.screen} />;
  const kunjungan = uuid.safeParse(sp.kunjungan);
  if (kunjungan.success) redirect(`/klinis/rawat-inap/${kunjungan.data}?tab=obs`);
  const unit = uuid.safeParse(sp.unit);
  return <ApiRawatInap session={access.session} unit={unit.success ? unit.data : null} />;
}
