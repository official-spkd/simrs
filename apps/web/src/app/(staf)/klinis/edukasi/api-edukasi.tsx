import { type EncounterContext, formatTanggalLahir } from '@simrs/shared';
import { Alert, PatientBanner } from '@simrs/ui';
import { EducationApi } from '@/components/klinis/education-api';
import { ApiError } from '@/lib/server/api-core';
import { encounterEducation } from '@/lib/server/data/klinis/edukasi';
import { encounterContext } from '@/lib/server/data/klinis/konsul';
import { can, type SessionView } from '@/lib/session-view';

const SEX = { male: 'L', female: 'P', unknown: '–' } as const;

/**
 * K11 · Layar Edukasi mode api (fase 3 · 3.7, ADR-0058): banner pasien, status edukasi tindakan (syarat final
 * persetujuan), formulir P07 `edukasi_terintegrasi` lewat penyaji formulir, dan riwayat. Data + izin dari API.
 */
export async function ApiEdukasi({
  session,
  encounterId,
  draftId,
}: {
  session: SessionView;
  encounterId: string | null;
  draftId: string | null;
}) {
  const header = (
    <header className="flex flex-col gap-0.5">
      <span className="text-caption text-ink-500">Klinis / Edukasi pasien · {session.tenant.name}</span>
      <h1 className="m-0 text-h1 font-bold tracking-[-0.02em]">Edukasi pasien</h1>
    </header>
  );
  if (!encounterId) {
    return (
      <div className="flex flex-col gap-4">
        {header}
        <Alert level="info" title="Pilih kunjungan pasien">
          Buka Edukasi dari tablet persetujuan tindakan atau dari rekam pasien (Rawat inap), agar edukasi
          tercatat pada kunjungan yang benar.
        </Alert>
      </div>
    );
  }
  let context: EncounterContext;
  try {
    context = await encounterContext(encounterId);
  } catch (err) {
    if (err instanceof ApiError && (err.status === 404 || err.status === 403)) {
      return (
        <div className="flex flex-col gap-4">
          {header}
          <Alert
            level="warning"
            title={err.status === 404 ? 'Kunjungan tidak ditemukan' : 'Akses ke pasien ini ditolak'}
          >
            {err.status === 404 ? 'Kunjungan ini tidak ada di rumah sakit Anda.' : err.message}
          </Alert>
        </div>
      );
    }
    throw err;
  }
  const data = await encounterEducation(encounterId);
  const c = context;
  return (
    <div className="flex flex-col gap-4">
      {header}
      <PatientBanner
        name={c.patient.name}
        sex={SEX[c.patient.sex]}
        ageYears={c.patient.ageYears}
        birthDate={
          c.patient.birthDate ? formatTanggalLahir(c.patient.birthDate) : 'tgl lahir tidak diketahui'
        }
        mrn={c.patient.mrn}
        allergies={
          c.allergy.status === 'ada'
            ? c.allergy.labels
            : c.allergy.status === 'belum_dikaji'
              ? ['belum dikaji']
              : []
        }
        guarantor={c.coverage?.name ?? 'Penjamin belum tercatat'}
        attending={c.dpjp?.name}
      />
      <EducationApi
        data={data}
        canWrite={can(session, 'forms.response', 'write')}
        backHref={draftId ? `/tablet/persetujuan/${draftId}` : null}
      />
    </div>
  );
}
