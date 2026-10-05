import type { Metadata } from 'next';
import { connection } from 'next/server';
import { DeviceScreen } from '@/components/device-screen';
import { requireDevice } from '@/lib/server/device';
import { requireScreen } from '@/lib/server/screen-guard';
import { webEnv } from '@/lib/server/web-env';
import { DemoAntrean } from './demo-antrean';

export const metadata: Metadata = { title: 'Display antrean' };

/**
 * F04 · Display antrean ruang tunggu (mockup `DisplayAntrean.dc.html`). Mode presentasi: data dummy di balik login
 * staf (`requireScreen`, `demo-antrean.tsx`). Mode api: dibuka PERANGKAT display terdaftar (ADR-0027, cookie
 * perangkat), bukan sesi staf; papan langsung (SSE lewat BFF, ADR-0026) diisi fase 2 potongan 4b.
 */
export default async function DisplayAntreanPage() {
  await connection();
  if (webEnv().dataSource === 'demo') {
    const access = await requireScreen('antrean');
    if (access.mode === 'demo') return <DemoAntrean access={access} />;
  }
  const { device } = await requireDevice('display');
  return <DeviceScreen kind="display" device={device} />;
}
