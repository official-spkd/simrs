import type { Metadata } from 'next';
import { ScreenAccessDenied } from '@/components/screen-gate';
import { requireScreen } from '@/lib/server/screen-guard';
import { ApiOrderIndex } from './api-order';
import { DemoOrderIndex } from './demo-order';

export const metadata: Metadata = { title: 'Order & resep (CPOE)' };

/**
 * K09 · Pilih kunjungan untuk dibuka di CPOE. Layar hibrida (`requireScreen`): mode presentasi memakai data dummy
 * (`demo-order.tsx`, dibekukan); mode api (layar W2) untuk peran ber-izin `order.write` di `api-order.tsx` (kunjungan
 * dari worklist K01 + order residen yang menunggu tinjauan).
 */
export default async function CpoeIndexPage() {
  const access = await requireScreen('order');
  if (access.mode === 'demo') return <DemoOrderIndex access={access} />;
  if (!access.allowed) return <ScreenAccessDenied screen={access.screen} />;
  return <ApiOrderIndex session={access.session} />;
}
