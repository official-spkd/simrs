import type { Metadata } from 'next';
import { connection } from 'next/server';
import { DeviceScreen } from '@/components/device-screen';
import { requireDevice } from '@/lib/server/device';
import { requireScreen } from '@/lib/server/screen-guard';
import { webEnv } from '@/lib/server/web-env';
import { DemoKiosk } from './demo-kiosk';

export const metadata: Metadata = { title: 'Anjungan mandiri' };

/**
 * F05 · Anjungan pendaftaran mandiri (mockup `Anjungan.dc.html`). Mode presentasi: data dummy di balik login staf
 * (`requireScreen`, `demo-kiosk.tsx`). Mode api: dibuka PERANGKAT anjungan terdaftar (ADR-0027, cookie perangkat),
 * bukan sesi staf; jalur API anjungan diisi fase 2 potongan 6.
 */
export default async function KioskPage() {
  await connection();
  if (webEnv().dataSource === 'demo') {
    const access = await requireScreen('kiosk');
    if (access.mode === 'demo') return <DemoKiosk access={access} />;
  }
  const { device } = await requireDevice('kiosk');
  return <DeviceScreen kind="kiosk" device={device} />;
}
