import type { Metadata } from 'next';
import { ScreenAccessDenied, ScreenNotConnected } from '@/components/screen-gate';
import { requireScreen } from '@/lib/server/screen-guard';
import { DemoPendaftaran } from './demo-pendaftaran';

export const metadata: Metadata = { title: 'Pendaftaran' };

/**
 * F03/F06 · Pendaftaran rawat jalan + SEP (mockup `Registrasi.dc.html`). Layar hibrida (`requireScreen`): mode
 * presentasi memakai data dummy (`demo-pendaftaran.tsx`); mode api untuk peran ber-izin `encounter.write`, jalur API
 * diisi fase 2 potongan 5b.
 */
export default async function PendaftaranPage() {
  const access = await requireScreen('daftar');
  if (access.mode === 'demo') return <DemoPendaftaran access={access} />;
  if (!access.allowed) return <ScreenAccessDenied screen={access.screen} />;
  return <ScreenNotConnected screen={access.screen} role={access.session.role?.code ?? null} />;
}
