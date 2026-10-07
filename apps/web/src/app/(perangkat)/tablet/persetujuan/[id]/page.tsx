import type { Metadata } from 'next';
import { notFound } from 'next/navigation';
import { z } from 'zod';
import { ScreenAccessDenied } from '@/components/screen-gate';
import { requireScreen } from '@/lib/server/screen-guard';
import { ApiPersetujuan } from './api-persetujuan';
import { DemoPersetujuan } from './demo-persetujuan';

export const metadata: Metadata = { title: 'Persetujuan tindakan' };

type Params = Promise<{ id: string }>;

/**
 * K11 · Tablet persetujuan tindakan (mockup `Consent.dc.html`, kanvas 834×1194). Layar hibrida (`requireScreen`):
 * mode presentasi memakai data fiktif (`demo-persetujuan.tsx`, dibekukan); mode api (layar W5a) dengan sesi staf di
 * tablet (keputusan fase 3 #20) untuk peran ber-izin `consent.write`, `id` = draf persetujuan (`api-persetujuan.tsx`).
 */
export default async function PersetujuanPage({ params }: { params: Params }) {
  const access = await requireScreen('consent');
  if (access.mode === 'demo') return <DemoPersetujuan access={access} id={(await params).id} />;
  if (!access.allowed) return <ScreenAccessDenied screen={access.screen} />;
  const id = z.uuid().safeParse((await params).id);
  if (!id.success) notFound();
  return <ApiPersetujuan session={access.session} draftId={id.data} />;
}
