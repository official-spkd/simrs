import type { Metadata } from 'next';
import { z } from 'zod';
import { ScreenAccessDenied } from '@/components/screen-gate';
import { requireScreen } from '@/lib/server/screen-guard';
import { ApiPersetujuanIndex } from './api-persetujuan-list';
import { DemoPersetujuanList } from './demo-persetujuan-list';

export const metadata: Metadata = { title: 'Persetujuan tindakan' };

/**
 * K11 · Pintu tablet persetujuan tindakan. Layar hibrida (`requireScreen`): mode presentasi memakai data fiktif
 * (`demo-persetujuan-list.tsx`, dibekukan); mode api (layar W5a) dengan sesi staf di tablet (keputusan fase 3 #20,
 * tanpa prinsipal perangkat) untuk peran ber-izin `consent.write`: pilih kunjungan, lalu `?kunjungan=<id>` memuat draf,
 * persetujuan tercatat, dan draf baru (`api-persetujuan-list.tsx`).
 */
export default async function PersetujuanIndexPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const access = await requireScreen('consent');
  if (access.mode === 'demo') return <DemoPersetujuanList access={access} />;
  if (!access.allowed) return <ScreenAccessDenied screen={access.screen} />;
  const { kunjungan } = await searchParams;
  const encounterId = z.uuid().safeParse(kunjungan);
  return (
    <ApiPersetujuanIndex
      session={access.session}
      encounterId={encounterId.success ? encounterId.data : null}
    />
  );
}
