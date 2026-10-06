import type { Metadata } from 'next';
import { DemoAccessDenied } from '@/components/demo-access-denied';
import { DemoPolling } from '@/components/front-office/demo-polling';
import { PublicPortal } from '@/components/info-publik/public-portal';
import { ScaleToFit } from '@/components/scale-to-fit';
import { getPublicInfo } from '@/lib/server/data/platform';
import { requireDemoScreen } from '@/lib/server/demo-guard';

export const metadata: Metadata = { title: 'Info publik (pratinjau)' };

/**
 * F08 · Pratinjau portal informasi publik di ponsel + aturan halaman publik. Data mengikuti kontrak gateway publik
 * (`schemas/public-info.ts`) dan jadwal/antrean demo yang sama dengan layar front office (ADR-0023), termasuk keadaan
 * toko demo bersama (cuti, kuota, kunjungan baru, panggilan; ADR-0085). Diperbarui berkala tanpa muat ulang.
 */
export default async function InfoPublikPage() {
  const { session, screen, allowed } = await requireDemoScreen('info-publik');
  if (!allowed) {
    return (
      <div className="px-6 pt-16 pb-6">
        <DemoAccessDenied screen={screen} />
      </div>
    );
  }
  const d = await getPublicInfo(session);
  return (
    <>
      <DemoPolling intervalMs={5000} />
      <ScaleToFit width={920} height={844} label="Pratinjau info publik">
        <PublicPortal
          rsName={session.tenant.name}
          schedule={d.schedule}
          queue={d.queue}
          bookings={d.bookings}
          hint={d.hint}
        />
      </ScaleToFit>
    </>
  );
}
