import { DemoAccessDenied } from '@/components/demo-access-denied';
import { getWeeklySchedule } from '@/lib/server/data/front-office/jadwal';
import type { DemoScreenAccess } from '@/lib/server/demo-guard';
import { JadwalClient } from './jadwal-client';

/**
 * F01 · Jadwal dokter mode presentasi (mockup `Jadwal.dc.html`, data dummy fiktif, ADR-0023). Jalur demo dibekukan
 * dan tetap diuji E2E demo (keputusan fase 2 #4); jalur api diisi potongan 2 di `page.tsx`.
 */
export async function DemoJadwal({ access, pilih }: { access: DemoScreenAccess; pilih: string | null }) {
  if (!access.allowed) return <DemoAccessDenied screen={access.screen} />;
  const schedule = await getWeeklySchedule(access.session);
  return <JadwalClient schedule={schedule} initialSlot={pilih} />;
}
