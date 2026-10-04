import { formatTanggalLahir, type KlinisPatient } from '@simrs/shared';
import { Chip, PatientBanner } from '@simrs/ui';
import type { ReactNode } from 'react';

/**
 * Banner pasien klinis (CLAUDE.md §6: nama, umur, RM, alergi, penjamin) + baris identitas tambahan: NIK tersamar,
 * risiko jatuh, SEP. `actions` = tombol kontekstual layar (Panggil, Buka CPOE, …).
 */
export function KlinisPatientHeader({
  patient,
  attending,
  actions,
}: {
  patient: KlinisPatient;
  attending?: string;
  actions?: ReactNode;
}) {
  const guarantor = patient.sep ? `${patient.payerLabel} · SEP aktif` : patient.payerLabel;
  return (
    <div className="flex flex-col gap-2">
      <PatientBanner
        name={patient.name}
        sex={patient.sex}
        ageYears={patient.ageYears}
        birthDate={formatTanggalLahir(patient.birthDate)}
        mrn={patient.rm}
        allergies={patient.allergies}
        guarantor={guarantor}
        attending={attending}
      />
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div className="flex flex-wrap gap-1.5">
          <Chip tone="neutral">
            NIK <span className="font-mono">{patient.nikMasked}</span>
          </Chip>
          <Chip tone={/tinggi|sedang/i.test(patient.fallRisk) ? 'warning' : 'neutral'}>
            {patient.fallRisk}
          </Chip>
          {patient.sep && (
            <Chip tone="neutral">
              SEP <span className="font-mono">{patient.sep}</span>
            </Chip>
          )}
          <Chip tone="neutral">{patient.history}</Chip>
        </div>
        {actions && <div className="flex flex-wrap gap-2">{actions}</div>}
      </div>
    </div>
  );
}
