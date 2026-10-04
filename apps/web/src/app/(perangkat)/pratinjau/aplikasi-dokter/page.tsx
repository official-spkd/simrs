import type { Metadata } from 'next';
import { DemoAccessDenied } from '@/components/demo-access-denied';
import { ScaleToFit } from '@/components/scale-to-fit';
import { getDoctorAppInbox } from '@/lib/server/data/manajemen';
import { requireDemoScreen } from '@/lib/server/demo-guard';
import { DoctorApp } from './doctor-app';

export const metadata: Metadata = { title: 'Aplikasi dokter (pratinjau)' };

/**
 * I08 · Pratinjau aplikasi dokter (mockup `AppDokter.dc.html`) di kanvas ponsel 390×844: nilai kritis kalium
 * Tn. Hartono mengikuti skenario IGD → rawat inap; "Read-back benar" menjalankan tugas skenario `readback` bila
 * sedang giliran, selain itu simulasi di layar ini. Data fiktif (ADR-0023).
 */
export default async function AplikasiDokterPage() {
  const { session, screen, allowed } = await requireDemoScreen('app-dokter');
  if (!allowed) {
    return (
      <div className="px-6 pt-16 pb-6">
        <DemoAccessDenied screen={screen} />
      </div>
    );
  }
  const { inbox, rev, labOrdered } = await getDoctorAppInbox(session);
  return (
    <ScaleToFit width={390} height={844} label="Pratinjau aplikasi dokter">
      <DoctorApp inbox={inbox} rev={rev} labOrdered={labOrdered} />
    </ScaleToFit>
  );
}
