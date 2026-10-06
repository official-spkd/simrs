import type { Metadata } from 'next';
import { DemoAccessDenied } from '@/components/demo-access-denied';
import { PublicPortal } from '@/components/info-publik/public-portal';
import { ScaleToFit } from '@/components/scale-to-fit';
import { getPublicInfo } from '@/lib/server/data/platform';
import { requireDemoScreen } from '@/lib/server/demo-guard';

export const metadata: Metadata = { title: 'Info publik (pratinjau)' };

/**
 * F08 · Pratinjau portal informasi publik di ponsel + aturan halaman publik. Data mengikuti kontrak gateway publik
 * (`schemas/public-info.ts`) dan jadwal/antrean demo yang sama dengan layar front office (ADR-0023).
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
  const d = await getPublicInfo();
  return (
    <ScaleToFit width={920} height={844} label="Pratinjau info publik">
      <PublicPortal
        rsName={session.tenant.name}
        schedule={d.schedule}
        queue={d.queue}
        bookings={d.bookings}
        hint={d.hint}
      />
    </ScaleToFit>
  );
}
