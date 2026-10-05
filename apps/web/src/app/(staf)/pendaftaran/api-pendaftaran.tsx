import { formatJam, isoDateJakarta } from '@simrs/shared';
import { Alert } from '@simrs/ui';
import { patientDetailSchema } from '@/lib/registration-api';
import { api } from '@/lib/server/api';
import { ApiError } from '@/lib/server/api-core';
import {
  getBpjsTasksApi,
  getCounterServiceApi,
  getRegistrationDeskApi,
  getRegistrationResultApi,
} from '@/lib/server/data/front-office/pendaftaran';
import { can, type SessionView } from '@/lib/session-view';
import { PendaftaranApiClient } from './pendaftaran-api-client';
import { RegistrationDone } from './registration-done';

function LoadError({ title, err }: { title: string; err: unknown }) {
  if (err instanceof ApiError && err.status !== 401) {
    return (
      <Alert level="critical" title={title}>
        {err.message}
      </Alert>
    );
  }
  throw err;
}

/**
 * F03/F06 · Pendaftaran rawat jalan mode api (fase 2 potongan 5b, mockup `Registrasi.dc.html`). Tanpa `kunjungan`:
 * meja pendaftaran (panggil loket, cari/daftarkan pasien, penjamin + SEP, tujuan + kuota, persetujuan umum). Dengan
 * `kunjungan`: hasil pendaftaran yang diperbarui sampai SEP dan task 1–3 selesai dikirim worker. Izin ditegakkan ulang
 * API; tombol hanya ditampilkan untuk izin yang dimiliki peran.
 */
export async function ApiPendaftaran({
  session,
  encounterId,
}: {
  session: SessionView;
  encounterId: string | null;
}) {
  if (encounterId) {
    let result;
    try {
      result = await getRegistrationResultApi(encounterId);
    } catch (err) {
      return <LoadError title="Hasil pendaftaran tidak bisa dimuat" err={err} />;
    }
    const bpjs = result.coverage?.payerKind === 'bpjs';
    const [tasks, patient, desk] = await Promise.all([
      bpjs && result.appointment && can(session, 'queue', 'read')
        ? getBpjsTasksApi(result.appointment.id).catch(() => null)
        : Promise.resolve(null),
      can(session, 'patient', 'read')
        ? api(`/api/v1/patients/${result.encounter.patientId}`, { schema: patientDetailSchema }).catch(
            () => null,
          )
        : Promise.resolve(null),
      getRegistrationDeskApi().catch(() => null),
    ]);
    const quota =
      desk?.quotas.find(
        (q) => q.doctorId === result.encounter.practitionerId && q.poliCode === result.encounter.poliCode,
      ) ?? null;
    return (
      <RegistrationDone
        result={result}
        tasks={tasks}
        patient={patient ? { name: patient.name, mrn: patient.mrn } : null}
        visit={
          quota
            ? {
                poliName: quota.poliName,
                doctorName: quota.doctorName,
                room: quota.room,
                eta: result.queueTicket?.estimatedCallAt
                  ? formatJam(result.queueTicket.estimatedCallAt)
                  : null,
              }
            : null
        }
        canRetry={can(session, 'coverage', 'write')}
        canPrint={can(session, 'documents', 'print')}
      />
    );
  }

  let desk;
  try {
    desk = await getRegistrationDeskApi();
  } catch (err) {
    return <LoadError title="Meja pendaftaran tidak bisa dimuat" err={err} />;
  }
  const canCall = can(session, 'queue', 'call') && can(session, 'queue', 'read');
  const counterService = canCall ? await getCounterServiceApi().catch(() => null) : null;
  return (
    <PendaftaranApiClient
      desk={desk}
      counterService={counterService ? { id: counterService.id, name: counterService.name } : null}
      today={isoDateJakarta(new Date())}
      canCreatePatient={can(session, 'patient', 'write')}
      canCheckCoverage={can(session, 'coverage', 'read')}
    />
  );
}
