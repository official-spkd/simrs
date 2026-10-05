import type { Metadata } from 'next';
import { connection } from 'next/server';
import { DeviceScreen } from '@/components/device-screen';
import { ScaleToFit } from '@/components/scale-to-fit';
import { ApiError } from '@/lib/server/api-core';
import { getDisplayBoard } from '@/lib/server/data/front-office/antrean';
import { requireDevice } from '@/lib/server/device';
import { requireScreen } from '@/lib/server/screen-guard';
import { webEnv } from '@/lib/server/web-env';
import { DemoAntrean } from './demo-antrean';
import { LiveAntreanClient } from './live-antrean-client';

export const metadata: Metadata = { title: 'Display antrean' };

/**
 * F04 · Display antrean ruang tunggu (mockup `DisplayAntrean.dc.html`). Mode presentasi: data dummy di balik login
 * staf (`requireScreen`, `demo-antrean.tsx`, dibekukan). Mode api: dibuka PERANGKAT display terdaftar (ADR-0027,
 * cookie perangkat), bukan sesi staf; potret papan dari API lalu panggilan langsung lewat SSE (BFF `./events`).
 */
export default async function DisplayAntreanPage() {
  await connection();
  if (webEnv().dataSource === 'demo') {
    const access = await requireScreen('antrean');
    if (access.mode === 'demo') return <DemoAntrean access={access} />;
  }
  const { ok, device } = await requireDevice('queue_display');
  if (!ok || !device.queueDisplay) return <DeviceScreen kind="queue_display" device={device} />;
  let board;
  try {
    board = await getDisplayBoard(device.queueDisplay.id);
  } catch (err) {
    // Papan belum punya layanan poli aktif (409) atau ikatan display berubah (403/404): petugas melihat sebabnya.
    if (err instanceof ApiError && [403, 404, 409].includes(err.status)) {
      return <DeviceScreen kind="queue_display" device={device} problem={err.message} />;
    }
    throw err;
  }
  return (
    <ScaleToFit width={1920} height={1080} label="Display antrean ruang tunggu">
      <LiveAntreanClient tenantName={device.tenant.name} nowIso={new Date().toISOString()} initial={board} />
    </ScaleToFit>
  );
}
