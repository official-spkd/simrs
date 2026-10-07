import type { Metadata } from 'next';
import { notFound } from 'next/navigation';
import { z } from 'zod';
import { ScreenAccessDenied } from '@/components/screen-gate';
import { requireScreen } from '@/lib/server/screen-guard';
import { ApiCpoe } from './api-cpoe';
import { DemoCpoe } from './demo-cpoe';

export const metadata: Metadata = { title: 'Order & resep (CPOE)' };

/**
 * K09 · CPOE + CDS satu kunjungan (mockup `CPOE.dc.html`). Layar hibrida (`requireScreen`): mode presentasi memakai
 * data dummy (`demo-cpoe.tsx`, dibekukan); mode api (layar W2) untuk peran ber-izin `order.write` di `api-cpoe.tsx`
 * (katalog, order set, pratinjau CDS server, kirim ber-Idempotency-Key, batal, status TTE resep).
 */
export default async function CpoePage({ params }: { params: Promise<{ encounterId: string }> }) {
  const access = await requireScreen('order');
  const { encounterId } = await params;
  if (access.mode === 'demo') return <DemoCpoe access={access} encounterId={encounterId} />;
  if (!access.allowed) return <ScreenAccessDenied screen={access.screen} />;
  const id = z.uuid().safeParse(encounterId);
  if (!id.success) notFound();
  return <ApiCpoe session={access.session} encounterId={id.data} />;
}
