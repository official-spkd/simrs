import type { Metadata } from 'next';
import { ScreenAccessDenied, ScreenNotConnected } from '@/components/screen-gate';
import { requireScreen } from '@/lib/server/screen-guard';
import { DemoPersetujuan } from './demo-persetujuan';

export const metadata: Metadata = { title: 'Persetujuan tindakan' };

type Params = Promise<{ id: string }>;

/**
 * K11 · Tablet persetujuan tindakan (mockup `Consent.dc.html`, kanvas 834×1194). Layar hibrida (`requireScreen`):
 * mode presentasi memakai data fiktif (`demo-persetujuan.tsx`, dibekukan); mode api dengan sesi staf di tablet
 * (keputusan fase 3 #20) untuk peran ber-izin `consent.write`, jalur API diisi layar W5a (sampai itu "Belum
 * tersambung").
 */
export default async function PersetujuanPage({ params }: { params: Params }) {
  const access = await requireScreen('consent');
  if (access.mode === 'demo') return <DemoPersetujuan access={access} id={(await params).id} />;
  if (!access.allowed) return <ScreenAccessDenied screen={access.screen} />;
  return <ScreenNotConnected screen={access.screen} role={access.session.role?.code ?? null} />;
}
