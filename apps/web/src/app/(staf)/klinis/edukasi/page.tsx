import type { Metadata } from 'next';
import { z } from 'zod';
import { ScreenAccessDenied } from '@/components/screen-gate';
import { requireScreen } from '@/lib/server/screen-guard';
import { ApiEdukasi } from './api-edukasi';
import { DemoEdukasi } from './demo-edukasi';

export const metadata: Metadata = { title: 'Edukasi pasien' };

type SearchParams = Promise<Record<string, string | string[] | undefined>>;

/**
 * K11 · Edukasi pasien dan keluarga terintegrasi, melengkapi persetujuan tindakan di tablet. Layar hibrida
 * (`requireScreen`): mode presentasi = rekam fiktif + toko demo (`demo-edukasi.tsx`, `?pasien=`); mode api untuk peran
 * ber-izin `clinical.write` (`api-edukasi.tsx`): formulir P07 `edukasi_terintegrasi` per kunjungan (`?kunjungan=`),
 * `?draf=` = draf persetujuan tablet yang menunggu edukasi (tautan kembali).
 */
export default async function EdukasiPage({ searchParams }: { searchParams: SearchParams }) {
  const access = await requireScreen('edukasi');
  const sp = await searchParams;
  if (access.mode === 'demo') return <DemoEdukasi access={access} pasien={sp.pasien} />;
  if (!access.allowed) return <ScreenAccessDenied screen={access.screen} />;
  const kunjungan = z.uuid().safeParse(sp.kunjungan);
  const draf = z.uuid().safeParse(sp.draf);
  return (
    <ApiEdukasi
      session={access.session}
      encounterId={kunjungan.success ? kunjungan.data : null}
      draftId={draf.success ? draf.data : null}
    />
  );
}
