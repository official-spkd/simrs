import { DemoAccessDenied } from '@/components/demo-access-denied';
import { weeklyScheduleSchema } from '@simrs/shared';
import { demoWeeklySchedule } from '@/lib/demo/fixtures/front-office';
import { dirtyQuotaSlots, unsyncedLeaves } from '@/lib/front-office-jadwal';
import { frontOfficeStore, scheduleOf } from '@/lib/server/data/front-office/toko';
import type { DemoScreenAccess } from '@/lib/server/demo-guard';
import { JadwalClient } from './jadwal-client';

/**
 * F01 · Jadwal dokter mode presentasi (mockup `Jadwal.dc.html`, data dummy fiktif, ADR-0023) di atas toko demo
 * bersama (ADR-0085, domain `jadwal` + booking dari `pendaftaran`). Jalur api diisi potongan 2 di `page.tsx` dan
 * tidak membaca toko.
 */
export async function DemoJadwal({ access, pilih }: { access: DemoScreenAccess; pilih: string | null }) {
  if (!access.allowed) return <DemoAccessDenied screen={access.screen} />;
  const fo = await frontOfficeStore(access.session);
  const st = fo.schedule.state;
  return (
    <JadwalClient
      schedule={weeklyScheduleSchema.parse(scheduleOf(fo))}
      initialSlot={pilih}
      store={{
        rev: fo.schedule.rev,
        dirty: dirtyQuotaSlots(demoWeeklySchedule(fo.progress), st),
        unsynced: unsyncedLeaves(st),
        syncJam: st.syncJam,
        transfers: { ...st.transfers },
      }}
    />
  );
}
