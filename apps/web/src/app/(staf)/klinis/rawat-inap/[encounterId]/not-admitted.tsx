import { formatTanggalLahir } from '@simrs/shared';
import { Alert, PatientBanner } from '@simrs/ui';
import Link from 'next/link';
import type { DemoPatient } from '@/lib/demo/fixtures/pasien';

/** Pasien skenario yang belum masuk ruang rawat: jelaskan posisinya dan arahkan ke layar yang sedang dipakai. */
export function NotAdmitted({
  patient,
  links,
}: {
  patient: DemoPatient;
  links: Array<{ href: string; label: string }>;
}) {
  return (
    <>
      <PatientBanner
        name={patient.nama}
        sex={patient.jk}
        ageYears={patient.umur}
        birthDate={formatTanggalLahir(patient.tanggalLahir)}
        mrn={patient.rm}
        allergies={[...patient.alergi]}
        guarantor={`${patient.penjamin}${patient.kelas ? ` ${patient.kelas}` : ''}`}
      />
      <Alert level="info" title={`${patient.nama} belum dirawat inap`}>
        Rekam rawat inap (CPPT, eMAR, EWS) terbentuk setelah pasien diterima di ruang rawat: serah terima dari
        IGD atau SEP rawat inap elektif di langkah Bed &amp; admisi Simulasi.
      </Alert>
      {links.length > 0 && (
        <div className="flex flex-wrap gap-2">
          {links.map((l) => (
            <Link
              key={l.href}
              href={l.href}
              className="inline-flex min-h-11 items-center rounded-control border border-line-strong bg-white/90 px-3.5 text-small font-semibold text-ink-900 no-underline hover:bg-brand-50/60"
            >
              {l.label}
            </Link>
          ))}
        </div>
      )}
    </>
  );
}
