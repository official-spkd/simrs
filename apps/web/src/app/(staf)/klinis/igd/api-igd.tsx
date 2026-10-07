import { Alert } from '@simrs/ui';
import { screenById } from '@/lib/screens';
import { ApiError } from '@/lib/server/api-core';
import { getEdBoardLive } from '@/lib/server/data/klinis/igd';
import { can, type SessionView } from '@/lib/session-view';
import { IgdLive, type IgdPermissions } from './igd-live';

/**
 * K03 · IGD mode api (layar W3): papan IGD dari API (unit penugasan; potret per pasien diaudit API), real-time lewat
 * SSE (`./events`; loket pendaftaran tanpa `clinical.read` memakai papan administratif tanpa triase dan
 * `./events/admisi`, ADR-0109). Aksi mengikuti izin sesi (pendaftaran IGD `encounter.write`, triase/status `triage.write`,
 * permintaan bed `bed.write`, SEP `coverage.write`); semuanya ditegakkan ulang API. `?pilih=` = pasien terpilih.
 */
export async function ApiIgd({ session, pilih }: { session: SessionView; pilih: string | null }) {
  let board;
  try {
    board = await getEdBoardLive(session);
  } catch (err) {
    if (err instanceof ApiError && (err.status === 403 || err.status === 404)) {
      return (
        <div className="flex max-w-3xl flex-col gap-4">
          <h1 className="m-0 text-h1 font-bold">Instalasi Gawat Darurat</h1>
          <Alert level="warning" title="Papan IGD hanya untuk petugas yang ditugaskan di IGD">
            Penugasan Anda saat ini bukan unit IGD. Pilih penugasan IGD lewat menu akun bila Anda juga
            bertugas di IGD.
          </Alert>
        </div>
      );
    }
    if (err instanceof ApiError) {
      return (
        <div className="flex max-w-3xl flex-col gap-4">
          <h1 className="m-0 text-h1 font-bold">Instalasi Gawat Darurat</h1>
          <Alert level="critical" title="Papan IGD belum bisa dimuat">
            {err.message}
          </Alert>
        </div>
      );
    }
    throw err;
  }
  const perms: IgdPermissions = {
    register: can(session, 'encounter', 'write') && can(session, 'patient', 'read'),
    triage: can(session, 'triage', 'write'),
    bed: can(session, 'bed', 'write'),
    sep: can(session, 'coverage', 'write'),
    claim: can(session, 'clinical', 'write') && can(session, 'clinical', 'sign'),
  };
  const bedScreen = screenById('bed');
  return (
    <IgdLive
      tenantName={session.tenant.name}
      board={board}
      initialSelected={board.items.find((i) => i.encounterId === pilih)?.encounterId ?? null}
      perms={perms}
      userId={session.user.id}
      bedHref={bedScreen && can(session, 'bed', 'read') ? bedScreen.route : null}
    />
  );
}
