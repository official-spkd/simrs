import { isoDateJakarta } from '@simrs/shared';
import type { Metadata } from 'next';
import { connection } from 'next/server';
import { DeviceScreen } from '@/components/device-screen';
import { ScaleToFit } from '@/components/scale-to-fit';
import { dateFull } from '@/lib/front-office';
import { requireDevice } from '@/lib/server/device';
import { requireScreen } from '@/lib/server/screen-guard';
import { webEnv } from '@/lib/server/web-env';
import { DemoKiosk } from './demo-kiosk';
import { LiveKioskClient } from './live-kiosk-client';

export const metadata: Metadata = { title: 'Anjungan mandiri' };

/**
 * F05 · Anjungan pendaftaran mandiri (mockup `Anjungan.dc.html`). Mode presentasi: data dummy di balik login staf
 * (`requireScreen`, `demo-kiosk.tsx`, dibekukan). Mode api: dibuka PERANGKAT anjungan terdaftar (ADR-0027, cookie
 * perangkat), bukan sesi staf; identifikasi, check-in, tiket, dan panggil petugas lewat `/api/v1/kiosk`
 * (`actions.ts`, fase 2 potongan 6).
 */
export default async function KioskPage() {
  await connection();
  if (webEnv().dataSource === 'demo') {
    const access = await requireScreen('kiosk');
    if (access.mode === 'demo') return <DemoKiosk access={access} />;
  }
  const { ok, device } = await requireDevice('kiosk');
  if (!ok) return <DeviceScreen kind="kiosk" device={device} />;
  const now = new Date();
  return (
    <ScaleToFit width={1080} height={1920} label="Anjungan pendaftaran mandiri">
      <LiveKioskClient
        tenantName={device.tenant.name}
        deviceName={device.name}
        unitName={device.unit.name}
        nowIso={now.toISOString()}
        dateLabel={dateFull(isoDateJakarta(now))}
      />
    </ScaleToFit>
  );
}
