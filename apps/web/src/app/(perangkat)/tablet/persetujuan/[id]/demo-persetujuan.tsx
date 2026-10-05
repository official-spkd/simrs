import { notFound } from 'next/navigation';
import { DemoAccessDenied } from '@/components/demo-access-denied';
import { ScaleToFit } from '@/components/scale-to-fit';
import { patientById } from '@/lib/demo/fixtures/pasien';
import { consentTurn, getConsentDocument } from '@/lib/server/data/klinis/consent';
import type { DemoScreenAccess } from '@/lib/server/demo-guard';
import { ConsentTablet } from './consent-tablet';

/**
 * K11 · Tablet persetujuan tindakan mode presentasi (mockup `Consent.dc.html`, kanvas 834×1194, data fiktif,
 * ADR-0023; dibekukan, jalur api diisi layar W5a di `page.tsx`). Untuk Tn. Hartono, TTE dokter setelah tanda tangan
 * pasien + saksi menjalankan tugas `tata-laksana.consent` skenario IGD → rawat inap; di luar gilirannya (dan
 * persetujuan operasi Ny. Ratna, yang final bersama SEP) tablet menampilkan keadaan menunggu.
 */
export async function DemoPersetujuan({ access, id }: { access: DemoScreenAccess; id: string }) {
  const { session, screen, allowed } = access;
  if (!allowed) {
    return (
      <div className="mx-auto max-w-3xl p-16">
        <DemoAccessDenied screen={screen} />
      </div>
    );
  }
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
