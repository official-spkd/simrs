import type { Metadata } from 'next';
import { ScreenAccessDenied, ScreenNotConnected } from '@/components/screen-gate';
import { requireScreen } from '@/lib/server/screen-guard';
import { DemoPersetujuanList } from './demo-persetujuan-list';

export const metadata: Metadata = { title: 'Persetujuan tindakan' };

/**
 * K11 · Pintu tablet persetujuan tindakan. Layar hibrida (`requireScreen`): mode presentasi memakai data fiktif
 * (`demo-persetujuan-list.tsx`, dibekukan); mode api dengan sesi staf di tablet (keputusan fase 3 #20, tanpa
 * prinsipal perangkat) untuk peran ber-izin `consent.write`, jalur API diisi layar W5a (sampai itu "Belum
 * tersambung").
 */
export default async function PersetujuanIndexPage() {
  const access = await requireScreen('consent');
  if (access.mode === 'demo') return <DemoPersetujuanList access={access} />;
  if (!access.allowed) return <ScreenAccessDenied screen={access.screen} />;
  return <ScreenNotConnected screen={access.screen} role={access.session.role?.code ?? null} />;
}
