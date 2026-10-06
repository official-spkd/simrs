import type { Metadata } from 'next';
import { DemoAccessDenied } from '@/components/demo-access-denied';
import { DemoPolling } from '@/components/front-office/demo-polling';
import { ScaleToFit } from '@/components/scale-to-fit';
import { getDoctorAppInbox } from '@/lib/server/data/manajemen';
import { requireDemoScreen } from '@/lib/server/demo-guard';
import { DoctorApp } from './doctor-app';

export const metadata: Metadata = { title: 'Aplikasi dokter (pratinjau)' };

/**
 * I08 · Pratinjau aplikasi dokter (mockup `AppDokter.dc.html`) di kanvas ponsel 390×844: nilai kritis kalium
 * Tn. Hartono mengikuti skenario IGD → rawat inap; "Read-back benar" menjalankan tugas skenario `readback` bila
 * sedang giliran. Nilai kritis pasien lain dibacakan ulang dan dicatat ke Pusat hasil kritis (domain `hasil-kritis`);
 * co-sign CPPT residen tersimpan (domain `aplikasi-dokter`). Data fiktif (ADR-0023/0085).
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
  const d = await getDoctorAppInbox(session);
  return (
    <ScaleToFit width={390} height={844} label="Pratinjau aplikasi dokter">
      <DemoPolling intervalMs={5000} />
      <DoctorApp
        inbox={d.inbox}
        rev={d.rev}
        labOrdered={d.labOrdered}
        orderHref={d.orderHref}
        criticals={d.criticals}
        criticalRev={d.criticalRev}
        app={d.app}
      />
    </ScaleToFit>
  );
}
