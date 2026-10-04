import type { Metadata } from 'next';
import { notFound } from 'next/navigation';
import { DemoAccessDenied } from '@/components/demo-access-denied';
import { ScaleToFit } from '@/components/scale-to-fit';
import { patientById } from '@/lib/demo/fixtures/pasien';
import { consentTurn, getConsentDocument } from '@/lib/server/data/rawat-inap';
import { requireDemoScreen } from '@/lib/server/demo-guard';
import { ConsentTablet } from './consent-tablet';

export const metadata: Metadata = { title: 'Persetujuan tindakan' };

type Params = Promise<{ id: string }>;

/**
 * K11 · Tablet persetujuan tindakan (mockup `Consent.dc.html`, kanvas 834×1194). Untuk Tn. Hartono, TTE dokter
 * setelah tanda tangan pasien + saksi menjalankan tugas `tata-laksana.consent` skenario IGD → rawat inap; di luar
 * gilirannya (dan persetujuan operasi Ny. Ratna, yang final bersama SEP) tablet menampilkan keadaan menunggu.
 */
export default async function PersetujuanPage({ params }: { params: Params }) {
  const { session, screen, allowed } = await requireDemoScreen('consent');
  if (!allowed) {
    return (
      <div className="mx-auto max-w-3xl p-16">
        <DemoAccessDenied screen={screen} />
      </div>
    );
  }
  const { id } = await params;
  const doc = await getConsentDocument(session, id);
  if (!doc) notFound();
  const p = patientById(doc.patientId);
  if (!p) notFound();
  const turn = await consentTurn(session, doc);

  return (
    <ScaleToFit
      width={834}
      height={1194}
      label="Tablet persetujuan tindakan"
      className="overflow-hidden rounded-[24px] shadow-[0_12px_40px_rgba(20,33,43,0.18)]"
    >
      <ConsentTablet
        doc={doc}
        patient={`${p.nama} · RM ${p.rm}`}
        canSign={session.role?.code === 'dokter'}
        scenario={turn.step}
        wait={turn.wait}
      />
    </ScaleToFit>
  );
}
