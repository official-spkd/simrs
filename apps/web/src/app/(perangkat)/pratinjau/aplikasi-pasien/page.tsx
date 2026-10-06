import type { Metadata } from 'next';
import { DemoAccessDenied } from '@/components/demo-access-denied';
import { DemoPolling } from '@/components/front-office/demo-polling';
import { ScaleToFit } from '@/components/scale-to-fit';
import { getPatientAppHome } from '@/lib/server/data/manajemen';
import { requireDemoScreen } from '@/lib/server/demo-guard';
import { PatientApp } from './patient-app';

export const metadata: Metadata = { title: 'Aplikasi pasien (pratinjau)' };

/**
 * I07 · Pratinjau aplikasi pasien (mockup `AppPasien.dc.html`) di kanvas ponsel 390×844. Menampilkan Tn. Suryo
 * sesuai kemajuan skenario rawat jalan: kode booking → antrean A-031 → PD-027, hasil lab setelah validasi, obat
 * setelah serah terima farmasi, jadwal kontrol setelah pasca kunjungan. Posisi antrean poli hidup dari papan antrean
 * (diperbarui berkala); booking, gula darah, dan akses keluarga tersimpan di toko demo (domain `aplikasi-pasien`).
 * Data fiktif (ADR-0023/0085).
 */
export default async function AplikasiPasienPage() {
  const { session, screen, allowed } = await requireDemoScreen('app-pasien');
  if (!allowed) {
    return (
      <div className="px-6 pt-16 pb-6">
        <DemoAccessDenied screen={screen} />
      </div>
    );
  }
  const d = await getPatientAppHome(session);
  return (
    <ScaleToFit width={390} height={844} label="Pratinjau aplikasi pasien">
      <DemoPolling intervalMs={4000} />
      <PatientApp
        home={d.home}
        rsName={session.tenant.name}
        store={d.store.state}
        rev={d.store.rev}
        slots={d.slots}
        glucoseAt={d.glucoseAt}
      />
    </ScaleToFit>
  );
}
